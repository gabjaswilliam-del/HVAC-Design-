"""Graph Memory: what may be stored, provenance rules, typed links, supersession that
keeps history, deletion, search, the timeline, the memory graph and persistence."""

from __future__ import annotations

import sys
import tempfile
import unittest
from pathlib import Path

REPO = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(REPO / "src"))

from hvac_agent.agent.memory import MemoryService  # noqa: E402
from hvac_agent.core.errors import ServiceError  # noqa: E402
from hvac_agent.integrations.memory_store import MemoryStore  # noqa: E402

NOW = "2026-10-08T12:00:00Z"
_open: list[MemoryStore] = []


def tearDownModule():
    for store in _open:
        store.close()


def service(store: MemoryStore | None = None) -> MemoryService:
    if store is None:
        store = MemoryStore(":memory:")
        _open.append(store)
    return MemoryService(store, clock=lambda: NOW)


def record(**kw) -> dict:
    return {"kind": "observation", "title": "Chiller 2 condenser approach 4.8 K", "occurredAt": "2026-10-07T08:00:00Z", "equipment": ["chiller_plant_2"], **kw}


class Rules(unittest.TestCase):
    def refused(self, svc: MemoryService, payload: dict, code: str = "INVALID_REQUEST") -> ServiceError:
        with self.assertRaises(ServiceError) as ctx:
            svc.create(payload)
        self.assertEqual(ctx.exception.code, code)
        return ctx.exception

    def test_what_may_be_stored(self):
        svc = service()
        self.refused(svc, record(kind="chat_message"))
        self.refused(svc, record(title="  "))
        self.refused(svc, record(title="x" * 161))
        self.refused(svc, record(body="x" * 4001))
        self.refused(svc, record(occurredAt="2026-10-09T12:00:00Z"))  # in the future
        self.refused(svc, record(occurredAt="2026-10-07T08:00:00"))  # no time zone
        self.refused(svc, record(occurredAt="yesterday"))
        self.refused(svc, record(equipment=["Chiller 2"]))
        self.refused(svc, record(equipment=[f"chiller_plant_{i}" for i in range(11)]))
        self.assertIn("credential", self.refused(svc, record(body="login password: hunter2")).message)
        self.assertEqual(svc.store.totals()["memories"], 0)

    def test_provenance_boundaries_of_the_persistent_store(self):
        svc = service()
        self.assertIn("demo", self.refused(svc, record(provenance="demo")).message.lower())
        self.assertIn("verified operational", self.refused(svc, record(provenance="verified_operational_source")).message.lower())
        self.assertIn("run", self.refused(svc, record(provenance="simulation")).message)
        self.assertIn("reference", self.refused(svc, record(provenance="imported_record")).message)
        sim = svc.create(record(provenance="simulation", runId="RUN-0003"))["memory"]
        self.assertEqual((sim["provenance"], sim["runId"]), ("simulation", "RUN-0003"))
        imported = svc.create(record(provenance="imported_record", sourceRef="CMMS WO-1182"))["memory"]
        self.assertEqual(imported["sourceRef"], "CMMS WO-1182")
        self.assertEqual(svc.create(record())["memory"]["provenance"], "user_entered")
        allowed = {p["id"]: p["allowed"] for p in svc.status()["provenance"]}
        self.assertEqual(allowed, {"simulation": True, "demo": False, "user_entered": True, "imported_record": True, "verified_operational_source": False})

    def test_times_are_normalised_and_recorded_time_is_the_services(self):
        m = service().create(record(occurredAt="2026-10-07T10:00:00+02:00"))["memory"]
        self.assertEqual(m["occurredAt"], "2026-10-07T08:00:00Z")
        self.assertEqual(m["recordedAt"], NOW)
        self.assertIsNone(m["validUntil"])


class Links(unittest.TestCase):
    def setUp(self):
        self.svc = service()
        self.obs = self.svc.create(record())["memory"]
        self.finding = self.svc.create(record(kind="finding", title="Condenser fouling suspected on Chiller 2", occurredAt="2026-10-07T09:00:00Z", links=[{"type": "SUPPORTED_BY", "target": self.obs["id"]}]))["memory"]

    def test_link_rules_follow_kinds_and_time(self):
        with self.assertRaises(ServiceError) as ctx:  # an observation cannot be RESOLVED_BY an observation
            self.svc.create(record(occurredAt="2026-10-07T10:00:00Z", links=[{"type": "RESOLVED_BY", "source": self.finding["id"]}]))
        self.assertIn("RESOLVED_BY links", ctx.exception.message)
        with self.assertRaises(ServiceError) as ctx:  # a decision cannot resolve a finding before it was made
            self.svc.create(record(kind="decision", title="Clean tubes", occurredAt="2026-10-07T08:30:00Z", links=[{"type": "RESOLVED_BY", "source": self.finding["id"]}]))
        self.assertIn("after", ctx.exception.message)
        with self.assertRaises(ServiceError):
            self.svc.create(record(links=[{"type": "SUPPORTED_BY", "target": "mem_missing"}]))
        with self.assertRaises(ServiceError):
            self.svc.add_link(self.finding["id"], {"type": "SUPPORTED_BY", "target": self.obs["id"]})  # already linked
        self.assertEqual(self.svc.store.totals()["memories"], 2)

    def test_which_correction_was_applied_after_the_previous_finding(self):
        corr = self.svc.create(record(kind="correction", title="Chiller 2 staged off for tube cleaning", occurredAt="2026-10-07T11:00:00Z", links=[{"type": "RESOLVED_BY", "source": self.finding["id"]}]))["memory"]
        links = self.svc.inspect(self.finding["id"])["links"]
        resolved = [l for l in links if l["type"] == "RESOLVED_BY"]
        self.assertEqual([(l["direction"], l["other"]["id"]) for l in resolved], [("out", corr["id"])])
        self.assertGreater(resolved[0]["other"]["occurredAt"], self.finding["occurredAt"])

    def test_removing_a_link(self):
        link = self.svc.inspect(self.finding["id"])["links"][0]
        self.assertEqual(self.svc.remove_link(self.finding["id"], link["id"])["links"], [])
        with self.assertRaises(ServiceError):
            self.svc.remove_link(self.finding["id"], link["id"])


class Supersession(unittest.TestCase):
    def setUp(self):
        self.svc = service()
        self.obs = self.svc.create(record())["memory"]
        self.finding = self.svc.create(record(kind="finding", title="Fouling suspected", occurredAt="2026-10-07T09:00:00Z", links=[{"type": "SUPPORTED_BY", "target": self.obs["id"]}]))["memory"]

    def test_a_correction_supersedes_and_keeps_the_old_version_as_history(self):
        new = self.svc.supersede(self.obs["id"], {"reason": "Sensor offset of 0.6 K corrected", "title": "Chiller 2 condenser approach 4.2 K"})
        old = self.svc.inspect(self.obs["id"])["memory"]
        self.assertEqual(old["status"], "superseded")
        self.assertEqual(old["supersededBy"], new["memory"]["id"])
        self.assertEqual(old["validUntil"], new["memory"]["recordedAt"])
        self.assertEqual(old["title"], "Chiller 2 condenser approach 4.8 K")  # never overwritten
        self.assertEqual(new["memory"]["correctionReason"], "Sensor offset of 0.6 K corrected")
        self.assertEqual(new["memory"]["equipment"], ["chiller_plant_2"])  # unchanged fields carried
        self.assertEqual([h["status"] for h in new["history"]], ["superseded", "current"])
        # The finding is now supported by both versions: history keeps the original link.
        supports = {l["other"]["id"] for l in self.svc.inspect(self.finding["id"])["links"]}
        self.assertEqual(supports, {self.obs["id"], new["memory"]["id"]})
        # Superseded versions are hidden unless asked for.
        self.assertEqual([m["id"] for m in self.svc.list({"kinds": "observation"})["memories"]], [new["memory"]["id"]])
        self.assertEqual(self.svc.list({"kinds": "observation", "includeSuperseded": "true"})["total"], 2)

    def test_conflicts(self):
        new = self.svc.supersede(self.obs["id"], {"reason": "typo"})
        with self.assertRaises(ServiceError) as ctx:
            self.svc.supersede(self.obs["id"], {"reason": "again"})
        self.assertEqual((ctx.exception.code, ctx.exception.details["currentId"]), ("CONFLICT", new["memory"]["id"]))
        with self.assertRaises(ServiceError):
            self.svc.supersede(new["memory"]["id"], {"reason": "x", "kind": "finding"})
        with self.assertRaises(ServiceError):
            self.svc.supersede(new["memory"]["id"], {"title": "no reason"})
        with self.assertRaises(ServiceError) as ctx:  # links go to current versions only
            self.svc.add_link(self.finding["id"], {"type": "SUPPORTED_BY", "target": self.obs["id"]})
        self.assertEqual(ctx.exception.details["currentId"], new["memory"]["id"])


class Deletion(unittest.TestCase):
    def test_deleting_a_correction_restores_the_previous_version(self):
        svc = service()
        obs = svc.create(record())["memory"]
        new = svc.supersede(obs["id"], {"reason": "wrong reading", "title": "Corrected reading"})["memory"]
        effects = svc.delete(new["id"])
        self.assertEqual(effects["restored"], obs["id"])
        restored = svc.inspect(obs["id"])["memory"]
        self.assertEqual((restored["status"], restored["validUntil"]), ("current", None))
        self.assertEqual(svc.list({"query": "corrected"})["total"], 0)  # index entry gone
        with self.assertRaises(ServiceError) as ctx:
            svc.inspect(new["id"])
        self.assertEqual(ctx.exception.code, "NOT_FOUND")

    def test_deleting_removes_links_and_index_rows(self):
        svc = service()
        obs = svc.create(record())["memory"]
        finding = svc.create(record(kind="finding", title="Fouling", occurredAt="2026-10-07T09:00:00Z", links=[{"type": "SUPPORTED_BY", "target": obs["id"]}]))["memory"]
        self.assertEqual(svc.delete(obs["id"])["removedLinks"], 1)
        self.assertEqual(svc.inspect(finding["id"])["links"], [])
        totals = svc.store.totals()
        self.assertEqual((totals["memories"], totals["links"], totals["keywordRows"]), (1, 0, 1))
        with self.assertRaises(ServiceError):
            svc.delete(obs["id"])


class Reading(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.svc = service()
        c = cls.svc.create
        cls.trip = c(record(kind="event", title="Chiller 2 tripped on high head pressure", occurredAt="2026-10-01T06:00:00Z"))["memory"]
        cls.obs = c(record(occurredAt="2026-10-05T08:00:00Z"))["memory"]
        cls.tower = c(record(title="Cooling tower 4 fan vibration", occurredAt="2026-10-06T07:00:00Z", equipment=["cooling_towers_4"]))["memory"]
        cls.finding = c(record(kind="finding", title="Condenser fouling on Chiller 2", occurredAt="2026-10-06T09:00:00Z", links=[{"type": "SUPPORTED_BY", "target": cls.obs["id"]}]))["memory"]
        cls.outcome = c(record(kind="outcome", title="Approach back to 2.9 K in the cleaning simulation", provenance="simulation", runId="RUN-0007", occurredAt="2026-10-07T10:00:00Z"))["memory"]

    def test_search_finds_records_by_their_words_and_filters(self):
        self.assertEqual([m["id"] for m in self.svc.list({"query": "fouling"})["memories"]], [self.finding["id"]])
        self.assertEqual(self.svc.list({"equipment": "cooling_towers_4"})["total"], 1)
        self.assertEqual(self.svc.list({"provenance": "simulation"})["memories"][0]["id"], self.outcome["id"])
        self.assertEqual(self.svc.list({"from": "2026-10-06T00:00:00Z", "to": "2026-10-06T23:59:59Z"})["total"], 2)
        with self.assertRaises(ServiceError):
            self.svc.list({"from": "2026-10-07T00:00:00Z", "to": "2026-10-06T00:00:00Z"})

    def test_the_last_recorded_issue_involving_chiller_2(self):
        latest = self.svc.list({"equipment": "chiller_plant_2", "kinds": "event,finding,observation", "limit": 1})["memories"][0]
        self.assertEqual(latest["id"], self.finding["id"])

    def test_the_timeline_reads_as_a_sequence_per_equipment(self):
        entries = self.svc.timeline({"equipment": "chiller_plant_2"})["entries"]
        self.assertEqual([e["id"] for e in entries], [self.outcome["id"], self.finding["id"], self.obs["id"], self.trip["id"]])
        self.assertEqual(entries[0]["previous"], {"chiller_plant_2": self.finding["id"]})
        self.assertEqual(entries[-1]["previous"], {})

    def test_the_memory_graph_reflects_the_records(self):
        g = self.svc.graph({})
        ids = {n["id"] for n in g["nodes"]}
        self.assertTrue({"equipment:chiller_plant_2", "equipment:cooling_towers_4", "run:RUN-0007"} <= ids)
        types = {e["type"] for e in g["edges"]}
        self.assertTrue({"RELATES_TO", "SUPPORTED_BY", "PART_OF_RUN", "OCCURRED_BEFORE"} <= types)
        for e in g["edges"]:
            self.assertIn(e["source"], ids)
            self.assertIn(e["target"], ids)
        # Derived order: consecutive records about the same equipment, earlier to later.
        seq = [(e["source"], e["target"]) for e in g["edges"] if e["type"] == "OCCURRED_BEFORE" and e["equipment"] == "chiller_plant_2"]
        self.assertEqual(seq, [(self.trip["id"], self.obs["id"]), (self.obs["id"], self.finding["id"]), (self.finding["id"], self.outcome["id"])])
        self.assertTrue(all(e.get("derived") for e in g["edges"] if e["type"] == "OCCURRED_BEFORE"))

    def test_the_graph_is_bounded_and_filtered_in_time(self):
        g = self.svc.graph({"limit": 2})
        self.assertEqual(len([n for n in g["nodes"] if not n["id"].startswith(("equipment:", "run:"))]), 2)
        self.assertTrue(g["truncated"])
        window = self.svc.graph({"from": "2026-10-06T00:00:00Z"})
        self.assertNotIn(self.trip["id"], {n["id"] for n in window["nodes"]})
        with self.assertRaises(ServiceError):
            self.svc.graph({"limit": 1000})

    def test_expanding_an_equipment_anchor_and_a_record(self):
        around = self.svc.expand("equipment:cooling_towers_4", {})
        self.assertEqual({n["id"] for n in around["nodes"]}, {self.tower["id"], "equipment:cooling_towers_4"})
        rec = self.svc.expand(self.finding["id"], {})
        self.assertIn(self.obs["id"], {n["id"] for n in rec["nodes"]})
        with self.assertRaises(ServiceError):
            self.svc.expand("equipment:chiller_plant_9", {})


class Persistence(unittest.TestCase):
    def test_records_survive_reopening_the_store(self):
        with tempfile.TemporaryDirectory() as tmp:
            path = Path(tmp) / "memory.sqlite3"
            store = MemoryStore(path)
            m = service(store).create(record())["memory"]
            store.close()
            store = MemoryStore(path)
            self.assertEqual(service(store).inspect(m["id"])["memory"]["title"], m["title"])
            tables = {r[0] for r in store.db.execute("SELECT name FROM sqlite_master WHERE type = 'table'")}
            store.close()
            self.assertFalse({"documents", "chunks", "relations", "evidence"} & tables)  # no knowledge tables


if __name__ == "__main__":
    unittest.main()
