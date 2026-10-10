"""KnowledgeService: the Graph RAG contract.

Document library and ingestion jobs, hybrid retrieval (keyword BM25, graph traversal
from the entities a question names, and vectors when an embedding service is
configured, fused by reciprocal rank), the knowledge graph and the evidence behind every
relationship. Answers are never generated here: no language model is configured, so
search returns the retrieved passages themselves.

Retrieved text is untrusted data. It is returned as text for display and citation, and
nothing in it is treated as an instruction.
"""

from __future__ import annotations

import base64
import binascii
import hashlib
import logging
import math
import re
import sqlite3
from array import array
from datetime import datetime, timezone
from typing import Any, Callable

from ..core.errors import ServiceError
from . import pipeline, vocabulary

log = logging.getLogger(__name__)

NODE_TYPES = ("document", "section", "equipment", "component", "fault", "symptom", "procedure", "standard", "concept")
EDGE_TYPES = ("DOCUMENTS", "PART_OF", "CONNECTED_TO", "ASSOCIATED_WITH", "DESCRIBED_BY", "REFERENCES", "ADDRESSES")
STAGES = ("validate", "extract", "chunk", "embed", "entities", "relations", "graph", "search")
GRAPH_LIMIT = 300
SEARCH_LIMIT = 20
CANDIDATES = 30
RRF_K = 60
SEMANTIC = ("ASSOCIATED_WITH", "PART_OF", "CONNECTED_TO", "ADDRESSES")
STOPWORDS = frozenset(
    "a an and are as at be by can do does for from has have how i in into is it its of on or that the their this to"
    " was what when where which who why will with about should could would there these those any all".split()
)
EQUIPMENT_ID = re.compile(r"^[a-z][a-z0-9_]{0,63}$")


def utcnow() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="seconds").replace("+00:00", "Z")


def _text(value: Any, field: str, *, required: bool = False, max_len: int = 200) -> str | None:
    if value is None or value == "":
        if required:
            raise ServiceError("INVALID_REQUEST", f"{field} is required.")
        return None
    if not isinstance(value, str):
        raise ServiceError("INVALID_REQUEST", f"{field} must be text.")
    value = re.sub(r"[\x00-\x1f\x7f]", " ", value).strip()
    if required and not value:
        raise ServiceError("INVALID_REQUEST", f"{field} is required.")
    if len(value) > max_len:
        raise ServiceError("INVALID_REQUEST", f"{field} is longer than {max_len} characters.")
    return value or None


def _int(value: Any, field: str, default: int, lo: int, hi: int) -> int:
    if value is None or value == "":
        return default
    try:
        n = int(value)
    except (TypeError, ValueError):
        raise ServiceError("INVALID_REQUEST", f"{field} must be a whole number.") from None
    if not lo <= n <= hi:
        raise ServiceError("INVALID_REQUEST", f"{field} must be between {lo} and {hi}.")
    return n


def _choices(value: Any, field: str, allowed: tuple[str, ...]) -> list[str] | None:
    if value is None or value == "" or value == []:
        return None
    items = value.split(",") if isinstance(value, str) else value
    if not isinstance(items, list) or not all(isinstance(i, str) for i in items):
        raise ServiceError("INVALID_REQUEST", f"{field} must be a list.")
    unknown = [i for i in items if i not in allowed]
    if unknown:
        raise ServiceError("INVALID_REQUEST", f"Unknown {field}: {', '.join(unknown[:5])}.")
    return list(dict.fromkeys(items))


def _relation_id(type_: str, source: str, target: str) -> str:
    return "rel_" + hashlib.sha1(f"{type_}|{source}|{target}".encode()).hexdigest()[:16]


def snippet(text: str | None, chunk_start: int | None, start: int | None, end: int | None, context: int = 110) -> dict[str, Any] | None:
    """The evidence span inside its passage, with some context on each side."""
    if text is None or chunk_start is None or start is None or end is None:
        return None
    a, b = max(0, start - chunk_start), min(len(text), end - chunk_start)
    lo, hi = max(0, a - context), min(len(text), b + context)
    if lo > 0:
        lo = text.find(" ", lo, a) + 1 or lo
    if hi < len(text):  # end at a word, not inside one
        cut = text.rfind(" ", b, hi)
        hi = cut if cut >= b else hi
    return {"text": text[lo:hi], "highlight": [a - lo, b - lo], "before": lo > 0, "after": hi < len(text)}


class KnowledgeService:
    def __init__(self, store: Any, *, embedder: Any = None, pdf: Any = None, clock: Callable[[], str] = utcnow):
        self.store = store
        self.embedder = embedder
        self.pdf = pdf
        self.clock = clock

    # --- Capabilities ------------------------------------------------------------------

    def _pdf(self) -> tuple[bool, str | None]:
        return self.pdf.available() if self.pdf else (False, "PDF text extraction is not configured on this service.")

    def status(self) -> dict[str, Any]:
        pdf_ok, pdf_reason = self._pdf()
        totals = self.store.totals()
        models = self.store.vector_models()
        return {
            "service": "knowledge",
            "storage": {"engine": "sqlite", "persistent": True, "namespace": "knowledge"},
            "pipeline": pipeline.PIPELINE_VERSION,
            "formats": [
                {"mediaType": "text/markdown", "extensions": [".md", ".markdown"], "available": True},
                {"mediaType": "text/plain", "extensions": [".txt"], "available": True},
                {"mediaType": "application/pdf", "extensions": [".pdf"], "available": pdf_ok, **({"reason": pdf_reason} if pdf_reason else {})},
            ],
            "maxBytes": pipeline.MAX_DOCUMENT_BYTES,
            "kinds": list(pipeline.KINDS),
            "extraction": {
                "method": "rule-based",
                "vocabulary": vocabulary.VERSION,
                "entityTypes": list(vocabulary.ENTITY_TYPES),
                "model": {"available": False, "reason": "No language model is configured for entity extraction; the rule-based HVAC vocabulary is used."},
            },
            "embeddings": {"available": True, "model": self.embedder.model}
            if self.embedder
            else {"available": False, "reason": "No embedding service is configured (HVAC_EMBEDDINGS_BASE_URL and HVAC_EMBEDDINGS_MODEL)."},
            "vectorModels": models,
            "answers": {"available": False, "reason": "No language model is configured for answer generation; search shows the retrieved passages."},
            "totals": totals,
        }

    # --- Documents ---------------------------------------------------------------------

    @staticmethod
    def _summary(row: dict[str, Any]) -> dict[str, Any]:
        return {
            "id": row["id"],
            "name": row["name"],
            "title": row["title"],
            "mediaType": row["media_type"],
            "sizeBytes": row["size_bytes"],
            "kind": row["kind"],
            "metadata": row["metadata"],
            "sha256": row["sha256"],
            "revision": row["revision"],
            "status": row["status"],
            "error": row["error"],
            "createdAt": row["created_at"],
            "updatedAt": row["updated_at"],
            "indexedAt": row["indexed_at"],
            "pipeline": row["pipeline"],
            "sectionCount": row["section_count"],
            "chunkCount": row["chunk_count"],
            "stages": row["stages"],
        }

    def _stages(self, detail: str) -> list[dict[str, Any]]:
        now = self.clock()
        return [
            {"name": "validate", "status": "done", "detail": detail, "at": now},
            *({"name": n, "status": "pending", "detail": None, "at": None} for n in STAGES[1:]),
        ]

    def ingest(self, payload: dict[str, Any]) -> dict[str, Any]:
        if not isinstance(payload, dict):
            raise ServiceError("INVALID_REQUEST", "Send the document as a JSON object.")
        name = _text(payload.get("name"), "name", required=True)
        encoded = payload.get("contentBase64")
        if not isinstance(encoded, str) or not encoded:
            raise ServiceError("INVALID_REQUEST", "contentBase64 is required.")
        if len(encoded) > (pipeline.MAX_DOCUMENT_BYTES * 4) // 3 + 8:
            raise ServiceError("TOO_LARGE", f"The file is larger than {pipeline.MAX_DOCUMENT_BYTES // 1048576} MB.")
        try:
            data = base64.b64decode(encoded, validate=True)
        except (binascii.Error, ValueError):
            raise ServiceError("INVALID_REQUEST", "contentBase64 is not valid base64.") from None
        media, safe_name = pipeline.validate_upload(name or "", data, self._pdf())
        kind = payload.get("kind") or "reference"
        if kind not in pipeline.KINDS:
            raise ServiceError("INVALID_REQUEST", f"kind must be one of {', '.join(pipeline.KINDS)}.")
        title = _text(payload.get("title"), "title")
        equipment = payload.get("equipment") or []
        if not isinstance(equipment, list) or len(equipment) > 20 or not all(isinstance(e, str) and EQUIPMENT_ID.match(e) for e in equipment):
            raise ServiceError("INVALID_REQUEST", "equipment must be up to 20 equipment IDs such as chiller_plant_2.")
        metadata = {
            "equipment": list(dict.fromkeys(equipment)),
            "publisher": _text(payload.get("publisher"), "publisher", max_len=120),
            "revisionLabel": _text(payload.get("revisionLabel"), "revisionLabel", max_len=60),
            "titleSource": "user" if title else "file",
        }
        sha = hashlib.sha256(data).hexdigest()
        existing = self.store.document_by_sha(sha)
        if existing:
            raise ServiceError(
                "CONFLICT",
                f'This file is already in the library as "{existing["title"]}".',
                details={"existingDocumentId": existing["id"], "existingTitle": existing["title"]},
            )
        now = self.clock()
        doc_id = f"doc_{sha[:12]}"
        kb = len(data) / 1024
        row = {
            "id": doc_id,
            "sha256": sha,
            "name": safe_name,
            "title": title or re.sub(r"\.[A-Za-z0-9]+$", "", safe_name),
            "media_type": media,
            "size_bytes": len(data),
            "kind": kind,
            "metadata": metadata,
            "revision": 1,
            "generation": 0,
            "status": "queued",
            "stages": self._stages(f"Accepted as {media}, {kb:,.1f} KB"),
            "created_at": now,
            "updated_at": now,
            "content": data,
        }
        try:
            self.store.insert_document(row)
        except sqlite3.IntegrityError:
            raise ServiceError("CONFLICT", "This file is already in the library.") from None
        return self.get_document(doc_id)

    def list_documents(self, params: dict[str, Any] | None = None) -> dict[str, Any]:
        limit = _int((params or {}).get("limit"), "limit", 500, 1, 1000)
        docs = [self._summary(r) for r in self.store.list_documents(limit)]
        return {"documents": docs, "totals": self.store.totals()}

    def get_document(self, document_id: str) -> dict[str, Any]:
        row = self.store.get_document(document_id)
        if not row:
            raise ServiceError("NOT_FOUND", "No document with this ID is in the library; it may have been removed.")
        doc = self._summary(row)
        doc["outline"] = [
            {
                "id": s["id"],
                "heading": s["heading"],
                "level": s["level"],
                "parentId": s["parent_id"],
                "path": s["path"],
                "page": s["page"],
                "procedure": bool(s["procedure"]),
                "chunkCount": s["chunk_count"],
                "firstChunk": s["first_chunk"],
            }
            for s in self.store.outline(document_id)
        ]
        doc["firstChunk"] = self.store.neighbour_chunk(document_id, 0)
        return doc

    def reindex(self, document_id: str) -> dict[str, Any]:
        row = self.store.get_document(document_id)
        if not row:
            raise ServiceError("NOT_FOUND", "No document with this ID is in the library.")
        if not self.store.queue(document_id, self._stages("Reindex requested; the stored original file is processed again"), self.clock()):
            raise ServiceError("CONFLICT", "This document is already queued or being processed.", retryable=True)
        return self.get_document(document_id)

    def delete(self, document_id: str) -> dict[str, Any]:
        removed = self.store.delete_document(document_id)
        if removed is None:
            raise ServiceError("NOT_FOUND", "No document with this ID is in the library.")
        return {"deleted": document_id, "removed": removed}

    # --- Ingestion job ------------------------------------------------------------------

    def process_pending(self) -> bool:
        """Run the oldest queued ingestion job to its end. False when nothing is queued."""
        doc = self.store.claim_next(self.clock())
        if not doc:
            return False
        doc_id, gen = doc["id"], doc["generation"]
        stages = {s["name"]: s for s in doc["stages"]}
        for name in STAGES[1:]:
            stages[name] = {"name": name, "status": "pending", "detail": None, "at": None}
        current = "extract"

        def mark(name: str, status: str, detail: str | None = None) -> None:
            stages[name] = {"name": name, "status": status, "detail": detail, "at": self.clock()}
            self.store.set_state(doc_id, gen, stages=[stages[n] for n in STAGES], updated_at=self.clock())

        try:
            mark("extract", "running")
            pdf_pages = self.pdf.pages if self.pdf and self._pdf()[0] else None
            extracted = pipeline.extract(doc["media_type"], doc["content"], doc["title"], pdf_pages)
            title = doc["title"]
            first = extracted.sections[0] if extracted.sections else None
            if doc["metadata"].get("titleSource") == "file" and first and first.level == 1 and first.heading_end > first.start:
                title = first.heading
            pages = f", {extracted.pages} pages" if extracted.pages else ""
            mark("extract", "done", f"{len(extracted.text):,} characters{pages}, {len(extracted.sections)} sections")

            current = "chunk"
            chunks = pipeline.chunk(extracted)
            mark("chunk", "done", f"{len(chunks)} passages of about {pipeline.CHUNK_TARGET:,} characters, about 15% overlap")

            current = "embed"
            vectors: list[bytes | None] = [None] * len(chunks)
            partial = None
            if self.embedder:
                mark("embed", "running")
                try:
                    raw = self.embedder.embed([extracted.text[c.start : c.end] for c in chunks])
                    vectors = [array("f", v).tobytes() for v in raw]
                    mark("embed", "done", f"{len(raw)} vectors from {self.embedder.model} ({len(raw[0]) if raw else 0} dimensions)")
                except Exception as e:  # the embedding adapter's errors carry a readable message
                    partial = f"Embeddings failed: {e}"[:300]
                    mark("embed", "failed", f"{e}"[:300])
            else:
                mark("embed", "skipped", "No embedding service is configured; keyword and graph retrieval only")

            current = "entities"
            analysis = pipeline.analyse(extracted, title, doc["metadata"].get("equipment", []))
            entity_count = sum(1 for t, _n in analysis.entities.values() if t != "document")
            mark("entities", "done", f"{len(analysis.mentions)} mentions of {entity_count} entities (rule-based vocabulary {vocabulary.VERSION})")
            current = "relations"
            mark("relations", "done", f"{len(analysis.relations)} relationships, each with its source evidence")

            index = self._rows(doc_id, extracted, chunks, vectors, self.embedder.model if self.embedder else None, analysis)
            now = self.clock()
            stages["graph"] = {"name": "graph", "status": "done", "detail": f"{len(index['entities'])} entities and {len(index['relations'])} relationships written", "at": now}
            stages["search"] = {"name": "search", "status": "done", "detail": f"{len(chunks)} passages in the keyword index", "at": now}
            state = {
                "status": "partial" if partial else "ready",
                "error": partial,
                "title": title,
                "stages": [stages[n] for n in STAGES],
                "updated_at": now,
                "indexed_at": now,
                "pipeline": f"{pipeline.PIPELINE_VERSION}+{vocabulary.VERSION}",
            }
            current = "graph"
            if not self.store.write_index(doc_id, gen, index, state):
                log.info("document %s changed while it was processed; result discarded", doc_id)
        except pipeline.PipelineError as e:
            self._fail(doc_id, gen, stages, e.stage, e.message)
        except Exception:
            log.exception("ingestion of %s failed during %s", doc_id, current)
            self._fail(doc_id, gen, stages, current, f"Unexpected error during {current}; see the service log.")
        return True

    def _fail(self, doc_id: str, gen: int, stages: dict[str, Any], stage: str, message: str) -> None:
        stages[stage] = {"name": stage, "status": "failed", "detail": message, "at": self.clock()}
        self.store.set_state(doc_id, gen, status="failed", error=message, stages=[stages[n] for n in STAGES], updated_at=self.clock())

    @staticmethod
    def _rows(
        doc_id: str, doc: pipeline.Extracted, chunks: list[pipeline.Chunk], vectors: list[bytes | None], model: str | None, analysis: pipeline.Analysis
    ) -> dict[str, list[tuple]]:
        d12 = doc_id[4:]
        sec = lambda o: f"sec_{d12}_{o:03d}"  # noqa: E731
        chk = lambda o: f"chk_{d12}_{o:04d}"  # noqa: E731

        def ref(r: str) -> str:
            if r == "doc":
                return doc_id
            if r.startswith("sec:"):
                return sec(int(r[4:]))
            if r.startswith("proc:"):
                return f"ent_procedure_{d12}_{int(r[5:]):03d}"
            return r

        paths: dict[int, str] = {}
        for s in doc.sections:
            paths[s.ordinal] = f"{paths[s.parent]} › {s.heading}" if s.parent is not None else s.heading
        sections = [
            (sec(s.ordinal), doc_id, s.ordinal, s.heading, s.level, sec(s.parent) if s.parent is not None else None, paths[s.ordinal], s.page, s.start, s.end, int(s.procedure))
            for s in doc.sections
        ]
        rows_chunks = [
            (chk(c.ordinal), doc_id, sec(c.section), c.ordinal, c.start, c.end, c.page, doc.text[c.start : c.end], vectors[c.ordinal], model if vectors[c.ordinal] else None)
            for c in chunks
        ]
        entities = [(ref(r), t, n) for r, (t, n) in analysis.entities.items() if t != "document"]
        mentions = []
        for m, section in analysis.mentions:
            c = pipeline.chunk_at(chunks, m.start)
            mentions.append((m.entity_id, doc_id, sec(section), chk(c.ordinal) if c else None, m.start, m.end, m.surface[:200]))
        relations, evidence = [], []
        for (type_, source, target), items in analysis.relations.items():
            rid = _relation_id(type_, ref(source), ref(target))
            relations.append((rid, type_, ref(source), ref(target)))
            for start, end, rule in items:
                c = pipeline.chunk_at(chunks, start)
                evidence.append((rid, doc_id, chk(c.ordinal) if c else None, start, end, rule))
        return {"sections": sections, "chunks": rows_chunks, "entities": entities, "mentions": mentions, "relations": relations, "evidence": evidence}

    # --- Retrieval ---------------------------------------------------------------------

    def search(self, payload: dict[str, Any]) -> dict[str, Any]:
        if not isinstance(payload, dict):
            raise ServiceError("INVALID_REQUEST", "Send the search as a JSON object.")
        query = _text(payload.get("query"), "query", required=True, max_len=500) or ""
        limit = _int(payload.get("limit"), "limit", 8, 1, SEARCH_LIMIT)
        terms = [t for t in re.findall(r"[^\W_]+", query.lower()) if t not in STOPWORDS][:32]
        seeds_found = [m for m in vocabulary.find_mentions(query)]
        if not terms and not seeds_found:
            raise ServiceError("INVALID_REQUEST", "Type a few words to search for.")

        ranked: dict[str, list[str]] = {}
        detail: dict[str, dict[str, dict[str, Any]]] = {"keyword": {}, "graph": {}, "vector": {}}
        methods: dict[str, dict[str, Any]] = {}

        # Keyword: BM25 over every indexed passage.
        if terms:
            match = " OR ".join('"' + t.replace('"', '""') + '"' for t in terms)
            hits = self.store.keyword(match, CANDIDATES)
            ranked["keyword"] = [h["chunk_id"] for h in hits]
            detail["keyword"] = {h["chunk_id"]: {"bm25": round(-h["score"], 4)} for h in hits}
        methods["keyword"] = {"available": True, "used": bool(terms), "candidates": len(ranked.get("keyword", []))}

        # Graph: passages that describe the entities the question names, and passages that
        # are the evidence for those entities' relationships.
        seed_ids = list(dict.fromkeys(m.entity_id for m in seeds_found))
        known = self.store.entities(seed_ids)
        seed_ids = [s for s in seed_ids if s in known]
        graph_score: dict[str, float] = {}
        paths: dict[str, list[dict[str, Any]]] = {}
        procedure_intent = bool(vocabulary.PROCEDURE_HEADING.search(query))
        for row in self.store.mentioning(seed_ids, 400):
            graph_score[row["chunk_id"]] = graph_score.get(row["chunk_id"], 0) + 2 + min(row["n"], 3) * 0.1
            paths.setdefault(row["chunk_id"], []).append({"start": row["entity_id"], "relation": "DESCRIBED_BY", "end": None})
        related = self.store.related_evidence(seed_ids, SEMANTIC, 400)
        neighbour_ids = set()
        for row in related:
            seed, other = (row["source_id"], row["target_id"]) if row["source_id"] in known else (row["target_id"], row["source_id"])
            neighbour_ids.add(other)
            graph_score[row["chunk_id"]] = graph_score.get(row["chunk_id"], 0) + 1
            paths.setdefault(row["chunk_id"], []).append(
                {"start": seed, "relation": row["type"], "end": other, "relationId": row["id"], "direction": "out" if row["source_id"] == seed else "in"}
            )
        passages_graph = self.store.passages(list(graph_score))
        if procedure_intent:
            for cid, p in passages_graph.items():
                if p["procedure"]:
                    graph_score[cid] += 1.5
        for cid, items in paths.items():  # a DESCRIBED_BY path ends at the passage's section
            unique: dict[tuple[str, str, str | None], dict[str, Any]] = {}
            for item in items:
                if item["end"] is None and cid in passages_graph:
                    item["end"] = passages_graph[cid]["section_id"]
                unique.setdefault((item["start"], item["relation"], item["end"]), item)
            paths[cid] = list(unique.values())[:6]
        ranked["graph"] = sorted(graph_score, key=lambda c: (-graph_score[c], c))[:CANDIDATES]
        detail["graph"] = {c: {"paths": paths.get(c, [])} for c in ranked["graph"]}
        methods["graph"] = {
            "available": True,
            "used": bool(seed_ids),
            "candidates": len(ranked["graph"]),
            "seeds": [{"id": s, "type": known[s]["type"], "name": known[s]["name"]} for s in seed_ids],
            "unknownTerms": [m.name for m in seeds_found if m.entity_id not in known][:10],
        }

        # Vector: cosine similarity, only against vectors from the same model.
        if self.embedder:
            try:
                stored = self.store.vectors(self.embedder.model)
                if stored:
                    q = self.embedder.embed([query])[0]
                    qn = math.sqrt(sum(x * x for x in q)) or 1.0
                    scored = []
                    for row in stored:  # ponytail: brute force; a vector index past ~50k passages
                        v = array("f")
                        v.frombytes(row["embedding"])
                        if len(v) == len(q):
                            vn = math.sqrt(sum(x * x for x in v)) or 1.0
                            scored.append((sum(a * b for a, b in zip(q, v)) / (qn * vn), row["chunk_id"]))
                    scored.sort(key=lambda s: (-s[0], s[1]))
                    ranked["vector"] = [c for _s, c in scored[:CANDIDATES]]
                    detail["vector"] = {c: {"similarity": round(s, 4)} for s, c in scored[:CANDIDATES]}
                    methods["vector"] = {"available": True, "used": True, "model": self.embedder.model, "candidates": len(ranked["vector"])}
                else:
                    methods["vector"] = {"available": True, "used": False, "model": self.embedder.model, "reason": "No passages have vectors from this model yet; reindex documents."}
            except Exception as e:
                methods["vector"] = {"available": True, "used": False, "model": self.embedder.model, "reason": f"Vector search failed: {e}"[:300]}
        else:
            methods["vector"] = {"available": False, "used": False, "reason": "No embedding service is configured."}

        # Reciprocal rank fusion: a passage high in several lists rises.
        fused: dict[str, float] = {}
        for method, ids in ranked.items():
            for rank, cid in enumerate(ids, 1):
                fused[cid] = fused.get(cid, 0.0) + 1.0 / (RRF_K + rank)
        top = sorted(fused, key=lambda c: (-fused[c], c))[:limit]
        rows = self.store.passages(top)
        mentions: dict[str, list[dict[str, Any]]] = {}
        for m in self.store.chunk_entities(top):
            mentions.setdefault(m["chunk_id"], []).append(m)
        names = self.store.entities(list(set(seed_ids) | neighbour_ids))
        for p in rows.values():
            names.setdefault(p["section_id"], {"id": p["section_id"], "type": "section", "name": p["section_heading"]})

        results = []
        for rank, cid in enumerate(top, 1):
            p = rows.get(cid)
            if not p:
                continue
            seen_entities: dict[str, dict[str, Any]] = {}
            for m in mentions.get(cid, []):
                seen_entities.setdefault(m["entity_id"], {"id": m["entity_id"], "type": m["type"], "name": m["name"]})
            highlights = self._highlights(p["text"], p["span_start"], terms, [m for m in mentions.get(cid, []) if m["entity_id"] in known])
            results.append(
                {
                    "rank": rank,
                    "chunkId": cid,
                    "documentId": p["document_id"],
                    "documentTitle": p["document_title"],
                    "documentName": p["document_name"],
                    "revision": p["revision"],
                    "sectionId": p["section_id"],
                    "sectionPath": p["section_path"],
                    "page": p["page"],
                    "procedure": bool(p["procedure"]),
                    "text": p["text"],
                    "highlights": highlights,
                    "fusionScore": round(fused[cid], 5),
                    "methods": [
                        {"method": m, "rank": ranked[m].index(cid) + 1, **detail[m].get(cid, {})} for m in ("keyword", "graph", "vector") if cid in ranked.get(m, [])
                    ],
                    "entities": list(seen_entities.values())[:12],
                    "provenance": {
                        "source": p["document_name"],
                        "mediaType": p["media_type"],
                        "kind": p["kind"],
                        "indexedAt": p["indexed_at"],
                        "pipeline": p["pipeline"],
                        "extraction": "rule-based vocabulary",
                    },
                }
            )
        documents: dict[str, dict[str, Any]] = {}
        for r in results:
            d = documents.setdefault(r["documentId"], {"id": r["documentId"], "title": r["documentTitle"], "passages": 0})
            d["passages"] += 1
        return {
            "query": query,
            "results": results,
            "documents": list(documents.values()),
            "methods": methods,
            "names": {k: {"id": k, "type": v["type"], "name": v["name"]} for k, v in names.items()},
            "fusion": {"method": "reciprocal rank fusion", "k": RRF_K, "note": "Scores order results; they are not probabilities."},
            "answer": {"available": False, "reason": "No language model is configured for answer generation; these are the retrieved passages."},
        }

    @staticmethod
    def _highlights(text: str, chunk_start: int, terms: list[str], mentions: list[dict[str, Any]]) -> list[list[int]]:
        spans = []
        for t in set(terms):
            if len(t) > 2:
                spans += [[m.start(), m.end()] for m in re.finditer(rf"(?<!\w){re.escape(t)}(?:e?s)?(?!\w)", text, re.I)]
        spans += [[m["span_start"] - chunk_start, m["span_end"] - chunk_start] for m in mentions]
        spans = sorted(s for s in spans if 0 <= s[0] < s[1] <= len(text))
        merged: list[list[int]] = []
        for s in spans:
            if merged and s[0] <= merged[-1][1]:
                merged[-1][1] = max(merged[-1][1], s[1])
            else:
                merged.append(s)
        return merged[:40]

    # --- Graph -------------------------------------------------------------------------

    @staticmethod
    def _node(row: dict[str, Any]) -> dict[str, Any]:
        return {"id": row["id"], "type": row["type"], "label": row["label"], "degree": row["degree"], "documentId": row["document_id"]}

    @staticmethod
    def _edge(row: dict[str, Any]) -> dict[str, Any]:
        return {"id": row["id"], "type": row["type"], "source": row["source_id"], "target": row["target_id"], "evidence": row["evidence"]}

    def graph(self, params: dict[str, Any]) -> dict[str, Any]:
        types = _choices(params.get("types"), "types", NODE_TYPES) or list(NODE_TYPES)
        edge_types = _choices(params.get("edgeTypes"), "edgeTypes", EDGE_TYPES)
        limit = _int(params.get("limit"), "limit", 150, 1, GRAPH_LIMIT)
        document = _text(params.get("document"), "document", max_len=80)
        rows, total = self.store.overview(types, limit, document)
        ids = [r["id"] for r in rows]
        edges = [e for e in self.store.edges_among(ids) if not edge_types or e["type"] in edge_types]
        return {
            "nodes": [self._node(r) for r in rows],
            "edges": [self._edge(e) for e in edges],
            "total": total,
            "truncated": total > len(rows),
            "limit": limit,
        }

    def node(self, node_id: str, params: dict[str, Any]) -> dict[str, Any]:
        """One node, its neighbours (bounded) and, for an entity, where it is mentioned."""
        limit = _int(params.get("limit"), "limit", 40, 1, 100)
        edge_types = _choices(params.get("edgeTypes"), "edgeTypes", EDGE_TYPES)
        found = self.store.nodes([node_id])
        if node_id not in found:
            raise ServiceError("NOT_FOUND", "This node is not in the knowledge graph; its document may have been removed or reindexed.")
        edges = self.store.edges_of(node_id, edge_types, limit + 1)
        more = len(edges) > limit
        edges = edges[:limit]
        others = self.store.nodes(list({e["source_id"] for e in edges} | {e["target_id"] for e in edges} - {node_id}))
        result: dict[str, Any] = {
            "node": self._node(found[node_id]),
            "neighbours": {"nodes": [self._node(n) for n in others.values()], "edges": [self._edge(e) for e in edges], "hasMore": more},
        }
        kind = found[node_id]["type"]
        if kind == "section":
            s = self.store.section(node_id)
            result["section"] = {"documentId": s["document_id"], "documentTitle": s["document_title"], "path": s["path"], "page": s["page"], "procedure": bool(s["procedure"]), "firstChunk": s["first_chunk"]}
        elif kind == "document":
            result["document"] = self._summary(self.store.get_document(node_id))
        else:
            rows, total = self.store.entity_mentions(node_id, 12)
            result["mentions"] = {"total": total, "items": [self._evidence_item(r, "mention") for r in rows]}
        return result

    @staticmethod
    def _evidence_item(r: dict[str, Any], rule: str | None = None) -> dict[str, Any]:
        return {
            "documentId": r["document_id"],
            "documentTitle": r["document_title"],
            "revision": r["revision"],
            "chunkId": r["chunk_id"],
            "sectionPath": r["section_path"],
            "page": r["page"],
            "rule": r.get("rule") or rule,
            "snippet": snippet(r["text"], r["chunk_start"], r["span_start"], r["span_end"]),
        }

    def edge(self, edge_id: str) -> dict[str, Any]:
        rel = self.store.relation(edge_id)
        if not rel:
            raise ServiceError("NOT_FOUND", "This relationship is no longer in the graph; the evidence behind it was removed or reindexed.")
        rows, total = self.store.evidence(edge_id, 25)
        ends = self.store.nodes([rel["source_id"], rel["target_id"]])
        return {
            "edge": {"id": rel["id"], "type": rel["type"], "source": rel["source_id"], "target": rel["target_id"], "evidence": total},
            "source": self._node(ends[rel["source_id"]]) if rel["source_id"] in ends else None,
            "target": self._node(ends[rel["target_id"]]) if rel["target_id"] in ends else None,
            "evidence": {"total": total, "items": [self._evidence_item(r) for r in rows]},
        }

    def chunk(self, chunk_id: str) -> dict[str, Any]:
        p = self.store.passages([chunk_id]).get(chunk_id)
        if not p:
            raise ServiceError("NOT_FOUND", "This passage is no longer in the library; its document was removed or reindexed.")
        found = self.store.chunk_entities([chunk_id])
        entities: dict[str, dict[str, Any]] = {}
        for m in found:
            entities.setdefault(m["entity_id"], {"id": m["entity_id"], "type": m["type"], "name": m["name"]})
        return {
            "chunkId": chunk_id,
            "documentId": p["document_id"],
            "documentTitle": p["document_title"],
            "documentName": p["document_name"],
            "revision": p["revision"],
            "sectionId": p["section_id"],
            "sectionPath": p["section_path"],
            "page": p["page"],
            "ordinal": p["ordinal"],
            "text": p["text"],
            "mentions": [{"entityId": m["entity_id"], "start": m["span_start"] - p["span_start"], "end": m["span_end"] - p["span_start"]} for m in found],
            "entities": list(entities.values()),
            "previous": self.store.neighbour_chunk(p["document_id"], p["ordinal"] - 1) if p["ordinal"] > 0 else None,
            "next": self.store.neighbour_chunk(p["document_id"], p["ordinal"] + 1),
            "indexedAt": p["indexed_at"],
        }
