"""Graph RAG: validation, extraction, passages, evidence-backed relationships, the
ingestion job, hybrid retrieval, the bounded graph, deletion and persistence.

Standard-library unittest, so it runs with `python -m unittest` and under pytest.
"""

from __future__ import annotations

import base64
import hashlib
import importlib.util
import json
import sys
import tempfile
import threading
import unittest
from http.server import BaseHTTPRequestHandler, HTTPServer
from pathlib import Path

REPO = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(REPO / "src"))

from hvac_agent.core.errors import ServiceError  # noqa: E402
from hvac_agent.integrations.embeddings import EmbeddingError, OpenAICompatibleEmbeddings  # noqa: E402
from hvac_agent.integrations.knowledge_store import KnowledgeStore  # noqa: E402
from hvac_agent.knowledge import pipeline, vocabulary  # noqa: E402
from hvac_agent.knowledge.service import KnowledgeService  # noqa: E402

CORPUS = REPO / "apps/dashboard/src/fixtures/knowledge"
GUIDE = b"""# Chiller 2 maintenance guide

Intro text. <script>alert('x')</script><iframe src="http://example.com"></iframe> See [ASHRAE 90.1](http://example.com).

## Condenser tube cleaning procedure

This procedure removes condenser tube fouling.
Condenser tube fouling raises the condenser approach and causes low chiller COP.
The compressor of Chiller 2 works harder when the tubes are fouled.

1. Isolate Chiller 2 and close its isolation valve.
2. CW pump 2 feeds Chiller 2; stop it first.

## Symptoms

High head pressure indicates non-condensable gases.
Bearing wear and high vibration were both noted on the same day.
"""


def b64(data: bytes) -> str:
    return base64.b64encode(data).decode()


_open: list[KnowledgeStore] = []


def tearDownModule():
    for store in _open:
        store.close()


def service(store: KnowledgeStore | None = None, **kw) -> KnowledgeService:
    if store is None:
        store = KnowledgeStore(":memory:")
        _open.append(store)
    return KnowledgeService(store, **kw)


def ingest(svc: KnowledgeService, data: bytes, name: str = "guide.md", **meta) -> dict:
    doc = svc.ingest({"name": name, "contentBase64": b64(data), **meta})
    while svc.process_pending():
        pass
    return svc.get_document(doc["id"])


def load_corpus(svc: KnowledgeService) -> None:
    spec = importlib.util.spec_from_file_location("export_demo", REPO / "scripts/export_knowledge_demo.py")
    export = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(export)
    for name, meta in export.CORPUS:
        svc.ingest({"name": name, "contentBase64": b64((CORPUS / name).read_bytes().replace(b"\r\n", b"\n")), **meta})
    while svc.process_pending():
        pass


class Validation(unittest.TestCase):
    def check(self, name: str, data: bytes, code: str, pdf=(False, "needs pypdf")) -> ServiceError:
        with self.assertRaises(ServiceError) as ctx:
            pipeline.validate_upload(name, data, pdf)
        self.assertEqual(ctx.exception.code, code)
        return ctx.exception

    def test_rejects_unsupported_empty_binary_and_mislabelled_files(self):
        self.check("tool.exe", b"MZ\x90", "UNSUPPORTED")
        self.check("notes", b"text", "UNSUPPORTED")
        self.check("empty.md", b"", "INVALID_REQUEST")
        self.check("blob.txt", b"abc\x00def", "UNSUPPORTED")
        self.check("latin.txt", "caf\xe9".encode("latin-1"), "UNSUPPORTED")
        self.check("fake.pdf", b"not a pdf", "INVALID_REQUEST", pdf=(True, None))

    def test_pdf_without_the_optional_parser_says_how_to_enable_it(self):
        err = self.check("manual.pdf", b"%PDF-1.7", "UNSUPPORTED", pdf=(False, "install the optional pypdf package"))
        self.assertIn("pypdf", err.message)

    def test_size_limit(self):
        original = pipeline.MAX_DOCUMENT_BYTES
        pipeline.MAX_DOCUMENT_BYTES = 10
        try:
            self.check("big.md", b"x" * 11, "TOO_LARGE")
        finally:
            pipeline.MAX_DOCUMENT_BYTES = original

    def test_names_are_reduced_to_a_safe_base_name(self):
        self.assertEqual(pipeline.validate_upload("..\\..\\etc/notes.md", b"# x", (False, None)), ("text/markdown", "notes.md"))


class Extraction(unittest.TestCase):
    def setUp(self):
        self.doc = pipeline.extract("text/markdown", GUIDE, "fallback")

    def test_markup_and_scripts_are_stripped_not_kept(self):
        self.assertNotIn("alert", self.doc.text)
        self.assertNotIn("<", self.doc.text)
        self.assertNotIn("http://", self.doc.text)
        self.assertIn("See ASHRAE 90.1.", self.doc.text)

    def test_sections_follow_the_heading_hierarchy(self):
        s = self.doc.sections
        self.assertEqual([x.heading for x in s], ["Chiller 2 maintenance guide", "Condenser tube cleaning procedure", "Symptoms"])
        self.assertEqual([x.parent for x in s], [None, 0, 0])
        self.assertEqual([x.procedure for x in s], [False, True, False])

    def test_plain_text_headings(self):
        data = (CORPUS / "demo-plant-sequence-note.txt").read_bytes().replace(b"\r\n", b"\n")
        doc = pipeline.extract("text/plain", data, "note")
        self.assertEqual([s.heading for s in doc.sections][1:], ["1.1 Normal operation", "1.2 Staging", "1.3 Free cooling"])
        self.assertEqual({s.parent for s in doc.sections[1:]}, {0})

    def test_text_without_any_content_fails_extraction(self):
        with self.assertRaises(pipeline.PipelineError) as ctx:
            pipeline.extract("text/markdown", b"<div><img src='a.png'></div>", "x")
        self.assertEqual(ctx.exception.stage, "extract")

    def test_passages_stay_inside_sections_and_overlap_by_whole_sentences(self):
        long = b"# Long\n\n" + b" ".join(b"Sentence %d mentions the chiller." % i for i in range(200))
        doc = pipeline.extract("text/markdown", long, "x")
        chunks = pipeline.chunk(doc)
        self.assertGreater(len(chunks), 3)
        for a, b in zip(chunks, chunks[1:]):
            self.assertLessEqual(b.start, a.end)  # contiguous or overlapping
            self.assertLessEqual(a.end - b.start, pipeline.OVERLAP)
            self.assertTrue(doc.text[b.start].isupper())  # starts at a sentence
        for c in chunks:
            s = doc.sections[c.section]
            self.assertTrue(s.start <= c.start and c.end <= s.end)
            self.assertLessEqual(c.end - c.start, pipeline.CHUNK_MAX)

    def test_list_numbers_do_not_split_sentences(self):
        doc = pipeline.extract("text/markdown", b"# Steps procedure\n\n1. Close the valve.\n2. Stop the pump.", "x")
        units = [doc.text[a:b] for a, b in pipeline.section_units(doc, doc.sections[0])]
        self.assertEqual(units, ["Steps procedure", "1. Close the valve.", "2. Stop the pump."])


class Relationships(unittest.TestCase):
    def setUp(self):
        self.doc = pipeline.extract("text/markdown", GUIDE, "Chiller 2 maintenance guide")
        self.analysis = pipeline.analyse(self.doc, "Chiller 2 maintenance guide", ["cooling_water_pump_2"])

    def rel(self, type_: str, source: str, target: str):
        return self.analysis.relations.get((type_, source, target))

    def test_each_relationship_has_evidence_that_contains_both_ends(self):
        self.assertTrue(self.analysis.relations)
        for (type_, source, target), evidence in self.analysis.relations.items():
            self.assertTrue(evidence, (type_, source, target))
            for start, end, rule in evidence:
                if rule in ("cause-wording", "part-in-sentence", "connection-wording"):
                    sentence = self.doc.text[start:end].lower()
                    for ref in (source, target):
                        names = [m.surface.lower() for m, _s in self.analysis.mentions if m.entity_id == ref]
                        self.assertTrue(any(n in sentence for n in names), (type_, ref, sentence))

    def test_expected_relationships(self):
        self.assertTrue(self.rel("ASSOCIATED_WITH", "ent_fault_condenser_fouling", "ent_symptom_low_cop"))
        self.assertTrue(self.rel("PART_OF", "ent_component_compressor", "ent_equipment_chiller_plant_2"))
        self.assertTrue(self.rel("CONNECTED_TO", "ent_equipment_cooling_water_pump_2", "ent_equipment_chiller_plant_2"))
        self.assertTrue(self.rel("ADDRESSES", "proc:1", "ent_fault_condenser_fouling"))
        self.assertTrue(self.rel("REFERENCES", "sec:0", "ent_standard_ashrae_90_1"))
        self.assertTrue(self.rel("DOCUMENTS", "doc", "ent_equipment_chiller_plant_2"))  # from the title
        self.assertEqual(self.rel("DOCUMENTS", "doc", "ent_equipment_cooling_water_pump_2"), [(None, None, "metadata")])

    def test_co_mention_without_cause_wording_is_not_a_relationship(self):
        # "Bearing wear and high vibration were both noted on the same day."
        self.assertIsNone(self.rel("ASSOCIATED_WITH", "ent_fault_bearing_wear", "ent_symptom_vibration"))

    def test_a_procedure_addresses_only_what_its_opening_names(self):
        procs = {s for (t, s, _d) in self.analysis.relations if t == "ADDRESSES"}
        self.assertEqual(procs, {"proc:1"})
        self.assertIsNone(self.rel("ADDRESSES", "proc:1", "ent_symptom_low_cop"))  # second sentence

    def test_vocabulary_resolves_overlaps_to_the_longest_term(self):
        found = vocabulary.find_mentions("A low chilled water delta-T on CW pump 4, not chiller 7 °C or Chiller 123.")
        self.assertEqual([(m.type, m.key) for m in found], [("symptom", "low_delta_t"), ("equipment", "cooling_water_pump_4"), ("equipment", "chiller"), ("equipment", "chiller")])


class Ingestion(unittest.TestCase):
    def test_a_document_moves_from_queued_to_ready_through_every_stage(self):
        svc = service()
        doc = svc.ingest({"name": "guide.md", "contentBase64": b64(GUIDE), "kind": "manual"})
        self.assertEqual(doc["status"], "queued")
        self.assertEqual([s["status"] for s in doc["stages"]], ["done"] + ["pending"] * 7)
        self.assertEqual(doc["id"], "doc_" + hashlib.sha256(GUIDE).hexdigest()[:12])
        self.assertTrue(svc.process_pending())
        self.assertFalse(svc.process_pending())
        doc = svc.get_document(doc["id"])
        self.assertEqual(doc["status"], "ready")
        self.assertEqual(doc["title"], "Chiller 2 maintenance guide")  # from the first heading
        self.assertEqual({s["name"]: s["status"] for s in doc["stages"]}["embed"], "skipped")
        self.assertTrue(all(s["status"] in ("done", "skipped") for s in doc["stages"]))
        self.assertEqual(doc["chunkCount"], 3)
        self.assertEqual([o["heading"] for o in doc["outline"]][1], "Condenser tube cleaning procedure")

    def test_a_failed_extraction_is_kept_with_its_stage_and_message(self):
        svc = service()
        doc = ingest(svc, b"<div><img src='a.png'></div>", "drawings.md")
        self.assertEqual(doc["status"], "failed")
        self.assertIn("no text", doc["error"])
        failed = [s for s in doc["stages"] if s["status"] == "failed"]
        self.assertEqual([s["name"] for s in failed], ["extract"])
        self.assertEqual(doc["chunkCount"], 0)

    def test_duplicates_are_refused_with_the_existing_document(self):
        svc = service()
        first = ingest(svc, GUIDE)
        with self.assertRaises(ServiceError) as ctx:
            svc.ingest({"name": "copy.md", "contentBase64": b64(GUIDE)})
        self.assertEqual(ctx.exception.code, "CONFLICT")
        self.assertEqual(ctx.exception.details["existingDocumentId"], first["id"])

    def test_payload_validation(self):
        svc = service()
        for payload, code in [
            ({"name": "a.md"}, "INVALID_REQUEST"),
            ({"name": "a.md", "contentBase64": "@@@"}, "INVALID_REQUEST"),
            ({"name": "a.md", "contentBase64": b64(b"# a"), "kind": "novel"}, "INVALID_REQUEST"),
            ({"name": "a.md", "contentBase64": b64(b"# a"), "equipment": ["Chiller 2"]}, "INVALID_REQUEST"),
            ({"name": "a.md", "contentBase64": b64(b"# a"), "title": "x" * 201}, "INVALID_REQUEST"),
        ]:
            with self.assertRaises(ServiceError) as ctx:
                svc.ingest(payload)
            self.assertEqual(ctx.exception.code, code, payload)

    def test_reindex_keeps_ids_and_refuses_while_queued(self):
        svc = service()
        doc = ingest(svc, GUIDE)
        before = {c for c in svc.store.chunk_ids()}
        svc.reindex(doc["id"])
        with self.assertRaises(ServiceError) as ctx:
            svc.reindex(doc["id"])
        self.assertEqual(ctx.exception.code, "CONFLICT")
        while svc.process_pending():
            pass
        self.assertEqual(svc.get_document(doc["id"])["status"], "ready")
        self.assertEqual(set(svc.store.chunk_ids()), before)

    def test_a_job_interrupted_by_a_restart_runs_again(self):
        with tempfile.TemporaryDirectory() as tmp:
            store = KnowledgeStore(Path(tmp) / "k.sqlite3")
            svc = service(store)
            doc = svc.ingest({"name": "guide.md", "contentBase64": b64(GUIDE)})
            store.claim_next("2026-10-08T00:00:00Z")  # a job that never finished
            store.close()
            store = KnowledgeStore(Path(tmp) / "k.sqlite3")
            self.assertEqual(store.requeue_interrupted("2026-10-08T00:01:00Z"), 1)
            svc = service(store)
            while svc.process_pending():
                pass
            self.assertEqual(svc.get_document(doc["id"])["status"], "ready")
            store.close()

    def test_pdf_pages_through_the_adapter(self):
        class FakePdf:
            @staticmethod
            def available():
                return True, None

            @staticmethod
            def pages(data):
                return ["2.1 Chiller checks\nChiller 2 shows a high condenser approach.", "2.2 Tower checks\nFill fouling causes high condenser water temperature."]

        svc = service(pdf=FakePdf())
        doc = ingest(svc, b"%PDF-1.7 fake", "manual.pdf")
        self.assertEqual(doc["status"], "ready")
        self.assertIn("2 pages", doc["stages"][1]["detail"])
        self.assertEqual([o["page"] for o in doc["outline"]], [1, 2])
        result = svc.search({"query": "fill fouling"})
        self.assertEqual(result["results"][0]["page"], 2)


class FakeEmbedder:
    model = "fake-hash-64"

    def __init__(self, fail: bool = False):
        self.fail = fail

    def embed(self, texts):
        if self.fail:
            raise EmbeddingError("The embedding service could not be reached.")
        vectors = []
        for t in texts:
            v = [0.0] * 64
            for w in t.lower().split():
                v[int(hashlib.md5(w.strip(".,;:").encode()).hexdigest(), 16) % 64] += 1.0
            vectors.append(v)
        return vectors


class Retrieval(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.svc = service()
        load_corpus(cls.svc)

    def search(self, query: str, **kw) -> dict:
        return self.svc.search({"query": query, **kw})

    def test_causes_of_low_chiller_cop_come_from_the_causes_passage_via_the_graph(self):
        r = self.search("What are the common causes of low chiller COP?")
        top = r["results"][0]
        self.assertEqual(top["sectionPath"], "Demo chiller maintenance guide › Common causes of low COP")
        self.assertEqual({m["method"] for m in top["methods"]}, {"keyword", "graph"})
        seeds = [s["id"] for s in r["methods"]["graph"]["seeds"]]
        self.assertIn("ent_symptom_low_cop", seeds)
        paths = next(m for m in top["methods"] if m["method"] == "graph")["paths"]
        self.assertIn("ASSOCIATED_WITH", {p["relation"] for p in paths})

    def test_documents_about_cooling_tower_performance(self):
        r = self.search("Which documents discuss cooling tower performance?")
        self.assertEqual(r["documents"][0]["title"], "Demo cooling tower performance notes")

    def test_maintenance_procedures_for_chiller_2(self):
        r = self.search("What maintenance procedures relate to Chiller 2?")
        top = r["results"][0]
        self.assertEqual(top["documentTitle"], "Demo site procedure: Chiller 2 condenser tube cleaning")
        self.assertTrue(top["procedure"])
        self.assertIn("ent_equipment_chiller_plant_2", [s["id"] for s in r["methods"]["graph"]["seeds"]])

    def test_every_result_is_a_stored_passage_and_no_answer_is_generated(self):
        r = self.search("condenser approach")
        self.assertFalse(r["answer"]["available"])
        self.assertIn("not probabilities", r["fusion"]["note"])
        for res in r["results"]:
            stored = self.svc.chunk(res["chunkId"])
            self.assertEqual(res["text"], stored["text"])
            for a, b in res["highlights"]:
                self.assertTrue(0 <= a < b <= len(res["text"]))
        self.assertEqual([x["rank"] for x in r["results"]], list(range(1, len(r["results"]) + 1)))

    def test_no_matches_and_empty_queries(self):
        self.assertEqual(self.search("zeppelin")["results"], [])
        with self.assertRaises(ServiceError):
            self.search("the of and")
        self.assertEqual(self.search("Chiller 9 problems")["methods"]["graph"]["unknownTerms"], ["Chiller 9"])

    def test_vector_retrieval_joins_the_fusion_when_configured(self):
        svc = service(embedder=FakeEmbedder())
        load_corpus(svc)
        r = svc.search({"query": "fill fouling raises the approach"})
        self.assertTrue(r["methods"]["vector"]["used"])
        self.assertIn("vector", {m["method"] for res in r["results"] for m in res["methods"]})
        self.assertEqual(svc.status()["vectorModels"][0]["model"], "fake-hash-64")

    def test_failed_embeddings_leave_a_searchable_partial_document(self):
        svc = service(embedder=FakeEmbedder(fail=True))
        doc = ingest(svc, GUIDE)
        self.assertEqual(doc["status"], "partial")
        self.assertIn("could not be reached", doc["error"])
        self.assertTrue(svc.search({"query": "condenser"})["results"])


class Graph(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.svc = service()
        load_corpus(cls.svc)

    def test_edges_join_returned_nodes_and_carry_evidence(self):
        g = self.svc.graph({})
        ids = {n["id"] for n in g["nodes"]}
        self.assertTrue(g["edges"])
        for e in g["edges"]:
            self.assertIn(e["source"], ids)
            self.assertIn(e["target"], ids)
            self.assertGreater(e["evidence"], 0)
        self.assertEqual({n["type"] for n in g["nodes"]}, set(vocabulary.ENTITY_TYPES) | {"document", "section"})

    def test_the_graph_is_bounded(self):
        g = self.svc.graph({"limit": 10})
        self.assertEqual(len(g["nodes"]), 10)
        self.assertTrue(g["truncated"])
        self.assertGreater(g["total"], 10)
        with self.assertRaises(ServiceError):
            self.svc.graph({"limit": 5000})
        n = self.svc.node("ent_equipment_chiller_plant_2", {"limit": 3})
        self.assertEqual(len(n["neighbours"]["edges"]), 3)
        self.assertTrue(n["neighbours"]["hasMore"])

    def test_filters_by_node_and_edge_type(self):
        g = self.svc.graph({"types": "fault,symptom", "edgeTypes": "ASSOCIATED_WITH"})
        self.assertEqual({n["type"] for n in g["nodes"]}, {"fault", "symptom"})
        self.assertEqual({e["type"] for e in g["edges"]}, {"ASSOCIATED_WITH"})

    def test_relationship_evidence_quotes_the_source_text(self):
        g = self.svc.graph({"edgeTypes": "ASSOCIATED_WITH"})
        for e in g["edges"]:
            detail = self.svc.edge(e["id"])
            for item in detail["evidence"]["items"]:
                snip = item["snippet"]
                a, b = snip["highlight"]
                quoted = snip["text"][a:b]
                self.assertIn(quoted, self.svc.chunk(item["chunkId"])["text"])
                self.assertEqual(item["rule"], "cause-wording")

    def test_node_inspection_points_to_its_source(self):
        n = self.svc.node("ent_fault_condenser_fouling", {})
        self.assertGreaterEqual(n["mentions"]["total"], 3)
        for item in n["mentions"]["items"]:
            a, b = item["snippet"]["highlight"]
            self.assertIn("fouling", item["snippet"]["text"][a:b].lower())
        with self.assertRaises(ServiceError) as ctx:
            self.svc.node("ent_fault_nothing", {})
        self.assertEqual(ctx.exception.code, "NOT_FOUND")


class Deletion(unittest.TestCase):
    def test_deleting_a_document_removes_its_index_and_only_its_graph(self):
        svc = service()
        load_corpus(svc)
        guide = next(d for d in svc.list_documents()["documents"] if d["title"] == "Demo chiller maintenance guide")
        procedure = next(d for d in svc.list_documents()["documents"] if d["title"].startswith("Demo site procedure"))
        self.assertTrue(any(r["documentId"] == guide["id"] for r in svc.search({"query": "low COP"})["results"]))
        removed = svc.delete(guide["id"])["removed"]
        self.assertEqual(removed["documents"], 1)
        self.assertEqual(removed["chunks"], removed["keywordRows"])
        self.assertFalse(any(r["documentId"] == guide["id"] for r in svc.search({"query": "low COP"})["results"]))
        totals = svc.store.totals()
        self.assertEqual(totals["chunks"], totals["keywordRows"])
        # An entity only the guide mentioned is gone; one the procedure also mentions stays.
        self.assertNotIn("ent_fault_non_condensables", svc.store.entities(["ent_fault_non_condensables"]))
        self.assertIn("ent_fault_condenser_fouling", svc.store.entities(["ent_fault_condenser_fouling"]))
        # No edge is left pointing at the removed document, its sections or anything missing.
        g = svc.graph({"limit": 300})
        ids = {n["id"] for n in g["nodes"]}
        self.assertFalse(any(guide["id"][4:] in i for i in ids))
        for e in svc.store.edges_among(sorted(ids)):
            self.assertGreater(e["evidence"], 0)
        self.assertEqual(svc.get_document(procedure["id"])["status"], "ready")
        with self.assertRaises(ServiceError):
            svc.delete(guide["id"])


class Persistence(unittest.TestCase):
    def test_library_survives_reopening_the_store(self):
        with tempfile.TemporaryDirectory() as tmp:
            path = Path(tmp) / "knowledge.sqlite3"
            store = KnowledgeStore(path)
            doc = ingest(service(store), GUIDE)
            store.close()
            store = KnowledgeStore(path)
            svc = service(store)
            self.assertEqual(svc.get_document(doc["id"])["status"], "ready")
            self.assertTrue(svc.search({"query": "condenser tube fouling"})["results"])
            store.close()

    def test_the_knowledge_file_holds_no_memory_tables(self):
        with tempfile.TemporaryDirectory() as tmp:
            store = KnowledgeStore(Path(tmp) / "knowledge.sqlite3")
            tables = {r[0] for r in store.db.execute("SELECT name FROM sqlite_master WHERE type = 'table'")}
            store.close()
            self.assertFalse({"memories", "links", "memory_equipment"} & tables)


class DemoSnapshot(unittest.TestCase):
    def test_the_dashboard_demo_snapshot_is_what_the_pipeline_produces(self):
        spec = importlib.util.spec_from_file_location("export_demo", REPO / "scripts/export_knowledge_demo.py")
        export = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(export)
        committed = json.loads(export.SNAPSHOT.read_text(encoding="utf-8"))
        self.assertEqual(committed, export.snapshot(), "run python scripts/export_knowledge_demo.py")
        memory = json.loads(export.MEMORY_SNAPSHOT.read_text(encoding="utf-8"))
        self.assertEqual(memory, export.memory_snapshot(), "run python scripts/export_knowledge_demo.py")
        self.assertEqual({r["provenance"] for r in memory["records"]}, {"demo", "simulation"})
        self.assertFalse(memory["status"]["storage"]["persistent"])
        refused = {p["id"] for p in memory["status"]["provenance"] if not p["allowed"]}
        self.assertEqual(refused, {"demo", "verified_operational_source"})  # the persistent rules


class EmbeddingAdapter(unittest.TestCase):
    def serve(self, reply):
        class Handler(BaseHTTPRequestHandler):
            def do_POST(self):
                body = json.loads(self.rfile.read(int(self.headers["Content-Length"])))
                status, payload = reply(body)
                data = json.dumps(payload).encode() if not isinstance(payload, bytes) else payload
                self.send_response(status)
                self.send_header("Content-Type", "application/json")
                self.send_header("Content-Length", str(len(data)))
                self.end_headers()
                self.wfile.write(data)

            def log_message(self, *a):
                pass

        server = HTTPServer(("127.0.0.1", 0), Handler)
        threading.Thread(target=server.serve_forever, daemon=True).start()
        self.addCleanup(server.server_close)
        self.addCleanup(server.shutdown)
        return OpenAICompatibleEmbeddings(f"http://127.0.0.1:{server.server_port}/v1", "m", timeout=5)

    def test_vectors_in_order_and_errors_with_reasons(self):
        ok = self.serve(lambda b: (200, {"data": [{"index": i, "embedding": [float(i), 1.0]} for i in range(len(b["input"]))]}))
        self.assertEqual(ok.embed(["a", "b"]), [[0.0, 1.0], [1.0, 1.0]])
        for reply, message in [
            (lambda b: (500, {"error": "boom"}), "answered 500"),
            (lambda b: (200, b"not json"), "not JSON"),
            (lambda b: (200, {"data": []}), "wrong number"),
        ]:
            with self.assertRaises(EmbeddingError) as ctx:
                self.serve(reply).embed(["a"])
            self.assertIn(message, str(ctx.exception))
        with self.assertRaises(EmbeddingError):
            OpenAICompatibleEmbeddings("http://127.0.0.1:9/v1", "m", timeout=2).embed(["a"])


if __name__ == "__main__":
    unittest.main()
