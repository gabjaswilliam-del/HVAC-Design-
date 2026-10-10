"""Write the Knowledge workspace's demo snapshots with the real services.

    python scripts/export_knowledge_demo.py          # write both snapshots
    python scripts/export_knowledge_demo.py --check  # fail if a committed one is stale

Graph RAG: the synthetic demo documents indexed by the real rule-based pipeline, so the
demo shows exactly what it produced and never claims that a model processed them.
Graph Memory: synthetic records created through the real MemoryService, so every record
and link obeys its rules (only the Demo provenance is allowed, because this store is
not the persistent one).
"""

from __future__ import annotations

import base64
import json
import sys
from datetime import datetime, timedelta, timezone
from pathlib import Path

REPO = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(REPO / "src"))

from hvac_agent.agent.memory import MemoryService  # noqa: E402
from hvac_agent.integrations.knowledge_store import KnowledgeStore  # noqa: E402
from hvac_agent.integrations.memory_store import MemoryStore  # noqa: E402
from hvac_agent.knowledge import vocabulary  # noqa: E402
from hvac_agent.knowledge.service import KnowledgeService  # noqa: E402

CORPUS_DIR = REPO / "apps/dashboard/src/fixtures/knowledge"
SNAPSHOT = REPO / "apps/dashboard/src/fixtures/knowledgeDemo.json"
MEMORY_SNAPSHOT = REPO / "apps/dashboard/src/fixtures/memoryDemo.json"
CORPUS = [
    ("demo-chiller-maintenance-guide.md", {"kind": "manual"}),
    ("demo-site-procedure-chiller-2.md", {"kind": "procedure", "equipment": ["chiller_plant_2"]}),
    ("demo-cooling-tower-performance.md", {"kind": "reference"}),
    ("demo-pump-troubleshooting.md", {"kind": "manual"}),
    ("demo-plant-sequence-note.txt", {"kind": "reference", "title": "Demo site note: chilled water plant sequence"}),
    ("demo-reference-card.md", {"kind": "reference"}),
    ("demo-drawing-register.md", {"kind": "reference", "title": "Demo drawing register (images only, no text)"}),
]
INSTANCE_ALIASES = {
    "chiller_plant_": ["chiller {n}"],
    "cooling_towers_": ["cooling tower {n}"],
    "cooling_water_pump_": ["cw pump {n}", "condenser water pump {n}", "cooling water pump {n}"],
    "chilled_water_pump_pri_": ["chw pump {n}", "chilled water pump {n}"],
}


def clock():
    """A fixed, advancing clock: the same snapshot on every machine."""
    t = datetime(2026, 10, 1, 8, 0, tzinfo=timezone.utc)
    while True:
        yield t.isoformat().replace("+00:00", "Z")
        t += timedelta(seconds=1)


def aliases(entity_id: str, type_: str, name: str) -> list[str]:
    key = entity_id[len(f"ent_{type_}_") :]
    for k, _n, terms in vocabulary.TERMS.get(type_, []):
        if k == key:
            return terms
    for prefix, forms in INSTANCE_ALIASES.items():
        if key.startswith(prefix) and key[len(prefix) :].isdigit():
            return [f.format(n=int(key[len(prefix) :])) for f in forms]
    return [name.lower()] if type_ == "standard" else []


def snapshot() -> dict:
    ticks = clock()
    service = KnowledgeService(KnowledgeStore(":memory:"), clock=lambda: next(ticks))
    for name, meta in CORPUS:
        data = (CORPUS_DIR / name).read_bytes().replace(b"\r\n", b"\n")  # same bytes on every checkout
        service.ingest({"name": name, "contentBase64": base64.b64encode(data).decode(), **meta})
    while service.process_pending():
        pass
    graph = service.graph({"limit": 300})
    assert not graph["truncated"], "the demo graph must fit in one view"
    store = service.store
    status = service.status()

    def span(r: dict) -> dict:  # evidence relative to its passage; the demo cuts snippets itself
        at = r["chunk_start"] if r["chunk_id"] else None
        return {
            "documentId": r["document_id"],
            "chunkId": r["chunk_id"],
            "start": r["span_start"] - at if at is not None and r["span_start"] is not None else None,
            "end": r["span_end"] - at if at is not None and r["span_end"] is not None else None,
            **({"rule": r["rule"]} if "rule" in r else {}),
        }

    return {
        "generatedBy": "scripts/export_knowledge_demo.py",
        "note": "Synthetic demo documents indexed by the rule-based pipeline; no language model processed them.",
        "pipeline": status["pipeline"],
        "vocabularyVersion": vocabulary.VERSION,
        "status": status,
        "documents": [service.get_document(d["id"]) for d in service.list_documents()["documents"]],
        "graph": graph,
        "evidence": {e["id"]: [span(r) for r in store.evidence(e["id"], 1000)[0]] for e in graph["edges"]},
        "mentions": {n["id"]: [span(r) for r in store.entity_mentions(n["id"], 1000)[0]] for n in graph["nodes"] if n["type"] not in ("document", "section")},
        "chunks": {c: service.chunk(c) for c in store.chunk_ids()},
        "aliases": {n["id"]: aliases(n["id"], n["type"], n["label"]) for n in graph["nodes"] if n["type"] not in ("document", "section", "procedure")},
    }


# Synthetic demo memory: a Chiller 2 investigation, a Cooling tower 4 fan and a CW pump 4
# rotation. ("create", key, record) or ("supersede", old key, new key, correction); links
# name earlier records by key. Simulation records carry the ID of a (demo) simulation run.
CHILLER, TOWER, PUMP = ["chiller_plant_2"], ["cooling_towers_4"], ["cooling_water_pump_4"]
MEMORIES = [
    ("create", "trip", {"kind": "event", "title": "Chiller 2 tripped on high head pressure", "body": "The compressor stopped on its high-pressure safety; Chiller 3 started as lag.", "occurredAt": "2026-09-28T06:10:00Z", "equipment": CHILLER}),
    ("create", "approach", {"kind": "observation", "title": "Chiller 2 condenser approach 4.8 K at 70% load", "body": "Logged on the morning round. The commissioning value is about 1.5 K.", "occurredAt": "2026-09-29T08:00:00Z", "equipment": CHILLER}),
    ("supersede", "approach", "approach2", {"reason": "The leaving condenser water sensor read 0.6 K low; corrected after a check against a reference thermometer.", "title": "Chiller 2 condenser approach 4.2 K at 70% load", "recordedAt": "2026-09-29T10:15:00Z"}),
    ("create", "fouling", {"kind": "finding", "title": "Condenser tube fouling likely on Chiller 2", "body": "A high approach, and the purge log rules out non-condensable gases.", "occurredAt": "2026-09-29T10:30:00Z", "equipment": CHILLER, "links": [{"type": "SUPPORTED_BY", "target": "approach2"}, {"type": "SUPPORTED_BY", "target": "trip"}]}),
    ("create", "schedule", {"kind": "decision", "title": "Schedule condenser tube cleaning for Chiller 2", "body": "Clean in the next low-load window while Chiller 1 and Chiller 3 carry the load.", "occurredAt": "2026-09-29T11:00:00Z", "equipment": CHILLER, "links": [{"type": "RESOLVED_BY", "source": "fouling"}]}),
    ("create", "simulated", {"kind": "outcome", "title": "Simulated cleaning: Chiller 2 approach back to 2.9 K", "body": "Mock simulation of a clean condenser at the same load and wet-bulb temperature.", "provenance": "simulation", "runId": "RUN-0002", "occurredAt": "2026-09-30T14:00:00Z", "equipment": CHILLER, "links": [{"type": "RESULTED_IN", "source": "schedule"}]}),
    ("create", "cleaned", {"kind": "correction", "title": "Chiller 2 condenser tubes cleaned and returned to service", "body": "Cleaned following the demo site procedure; scale deposits noted at the inlet water box.", "occurredAt": "2026-10-02T15:00:00Z", "equipment": CHILLER, "links": [{"type": "RESOLVED_BY", "source": "fouling"}]}),
    ("create", "after", {"kind": "observation", "title": "Chiller 2 condenser approach 2.8 K after cleaning", "occurredAt": "2026-10-03T08:00:00Z", "equipment": CHILLER, "links": [{"type": "RESULTED_IN", "source": "cleaned"}]}),
    ("create", "vibration", {"kind": "observation", "title": "Cooling tower 4 fan vibration rising", "body": "Gearbox vibration up from 2.5 to 4.1 mm/s over a week.", "occurredAt": "2026-10-01T07:00:00Z", "equipment": TOWER}),
    ("create", "towerfinding", {"kind": "finding", "title": "Cooling tower 4 fan fault limits heat rejection in the heat-wave simulation", "body": "With Cooling tower 4 out, condenser water was 1.6 K warmer at the peak wet-bulb temperature.", "provenance": "simulation", "runId": "RUN-0003", "occurredAt": "2026-10-01T13:00:00Z", "equipment": TOWER, "links": [{"type": "SUPPORTED_BY", "target": "vibration"}]}),
    ("create", "towerdecision", {"kind": "decision", "title": "Keep Cooling tower 4 out of the lead rotation until its fan is inspected", "occurredAt": "2026-10-01T15:00:00Z", "equipment": TOWER, "links": [{"type": "RESOLVED_BY", "source": "towerfinding"}]}),
    ("create", "rotation", {"kind": "event", "title": "CW pump 4 standby rotation run", "body": "The weekly one-hour run of the standby condenser water pump.", "occurredAt": "2026-10-04T09:00:00Z", "equipment": PUMP}),
    ("create", "pumpvib", {"kind": "observation", "title": "CW pump 4 vibration 2.1 mm/s during the rotation run", "occurredAt": "2026-10-04T10:00:00Z", "equipment": PUMP, "links": [{"type": "RESULTED_IN", "source": "rotation"}]}),
]


def memory_snapshot() -> dict:
    now = ["2026-10-04T12:00:00Z"]
    counter = iter(range(1, 1000))
    service = MemoryService(MemoryStore(":memory:"), persistent=False, clock=lambda: now[0], ids=lambda prefix: f"{prefix}_demo{next(counter):03d}")
    keys: dict[str, str] = {}
    later = lambda t: (datetime.fromisoformat(t.replace("Z", "+00:00")) + timedelta(minutes=20)).isoformat().replace("+00:00", "Z")  # noqa: E731
    for op in MEMORIES:
        if op[0] == "create":
            _, key, payload = op
            links = [{k: keys.get(v, v) for k, v in link.items()} for link in payload.get("links", [])]
            now[0] = later(payload["occurredAt"])  # recorded 20 minutes after it happened
            keys[key] = service.create({"provenance": "demo", **payload, "links": links})["memory"]["id"]
        else:
            _, old, key, payload = op
            now[0] = payload["recordedAt"]
            keys[key] = service.supersede(keys[old], {k: v for k, v in payload.items() if k != "recordedAt"})["memory"]["id"]
    records = service.list({"includeSuperseded": True, "limit": 200})["memories"]
    links = service.store.links_of([r["id"] for r in records])
    # The rules shown are the persistent service's; storage and totals are the demo's.
    rules = MemoryService(MemoryStore(":memory:"), persistent=True).status()
    status = {**rules, "storage": {"engine": "demo snapshot", "persistent": False, "namespace": "memory"}, "totals": service.status()["totals"]}
    return {
        "generatedBy": "scripts/export_knowledge_demo.py",
        "note": "Synthetic demo records created through the memory service's own rules; nothing here happened at a real plant.",
        "status": status,
        "records": records,
        "links": [{"id": l["id"], "type": l["type"], "source": l["source_id"], "target": l["target_id"], "createdAt": l["created_at"]} for l in links],
    }


def main() -> int:
    outputs = [(SNAPSHOT, snapshot()), (MEMORY_SNAPSHOT, memory_snapshot())]
    if "--check" in sys.argv:
        stale = [p for p, data in outputs if not p.exists() or json.loads(p.read_text(encoding="utf-8")) != data]
        for p in stale:
            print(f"{p.relative_to(REPO)} is stale: run python scripts/export_knowledge_demo.py", file=sys.stderr)
        if not stale:
            print("demo snapshots are current")
        return 1 if stale else 0
    for path, data in outputs:
        path.write_text(json.dumps(data, ensure_ascii=False, separators=(",", ":")) + "\n", encoding="utf-8", newline="\n")
        print(f"wrote {path.relative_to(REPO)}: {path.stat().st_size:,} bytes")
    return 0


if __name__ == "__main__":
    sys.exit(main())
