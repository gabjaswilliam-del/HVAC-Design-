"""MemoryService: the Graph Memory contract.

Persistent, temporal memory of what happened at the plant and what was decided:
observations, findings, decisions, corrections, outcomes and events. It is separate from
the knowledge library (its own store, namespace and contract) and is not a chat log.

What may be stored (enforced here, not only in the UI):
- Only records someone saves explicitly. Nothing is captured from conversations.
- One of six kinds, a short title, an optional body; no files, no personal data, and
  text that looks like a credential is refused.
- Every record carries its provenance. The persistent store refuses Demo records (they
  live only in the demo) and Verified operational source (no verified operational
  integration is connected in this build). Simulation records need their run ID, so a
  simulated observation is never mistaken for plant telemetry. Imported records need a
  reference to the record they came from.
- When it happened (occurredAt, not in the future) is separate from when it was
  recorded (recordedAt, set here). A correction never overwrites: it supersedes, the
  old version stays as history with its validity closed (validUntil).

Retention: records are kept until someone deletes them; superseded versions are kept
as history. Deletion is permanent and also removes the record's links and index entry.
Access: the local API binds to this machine only and has no user accounts yet.

Memory text is untrusted data: it is stored and returned as text, never interpreted.
"""

from __future__ import annotations

import re
import secrets
from datetime import datetime, timedelta, timezone
from typing import Any, Callable, Iterator

from ..core.errors import ServiceError

KINDS = ("event", "observation", "finding", "decision", "correction", "outcome")
PROVENANCE = ("simulation", "demo", "user_entered", "imported_record", "verified_operational_source")
LINK_TYPES = ("RESULTED_IN", "RESOLVED_BY", "SUPPORTED_BY")
EDGE_TYPES = ("OCCURRED_BEFORE", "RELATES_TO", "RESULTED_IN", "RESOLVED_BY", "SUPERSEDES", "SUPPORTED_BY", "PART_OF_RUN")
# type -> (source kinds, target kinds, whether the target must not occur before the source)
LINK_RULES: dict[str, tuple[set[str], set[str], bool]] = {
    "RESULTED_IN": ({"event", "decision", "correction"}, {"outcome", "observation", "finding", "event"}, True),
    "RESOLVED_BY": ({"finding", "event", "observation"}, {"decision", "correction"}, True),
    "SUPPORTED_BY": ({"finding", "decision", "correction", "outcome"}, {"observation", "event", "outcome", "finding"}, False),
}
REFUSED_IN_PERSISTENT = {
    "demo": "Demo records live only in the demo; the persistent memory does not store them.",
    "verified_operational_source": "No verified operational source is connected to this service; record it as an imported record with its reference.",
}
EQUIPMENT_ID = re.compile(r"^[a-z][a-z0-9_]{0,63}$")
RUN_ID = re.compile(r"^[A-Za-z0-9][A-Za-z0-9_.:-]{0,63}$")
CREDENTIAL = re.compile(
    r"(?i)\b(password|passwd|api[_-]?key|secret|token)\s*[:=]\s*\S+|-----BEGIN [A-Z ]*PRIVATE KEY-----|\bAKIA[0-9A-Z]{16}\b"
)
STOPWORDS = frozenset("a an and are as at be by for from has how in is it of on or the to was what when which with".split())
GRAPH_LIMIT = 200
FUTURE_SKEW = timedelta(minutes=5)


def utcnow() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="seconds").replace("+00:00", "Z")


def _time(value: Any, field: str) -> str:
    if not isinstance(value, str):
        raise ServiceError("INVALID_REQUEST", f"{field} must be an ISO 8601 time with a time zone.")
    try:
        t = datetime.fromisoformat(value.replace("Z", "+00:00"))
    except ValueError:
        raise ServiceError("INVALID_REQUEST", f"{field} must be an ISO 8601 time with a time zone.") from None
    if t.tzinfo is None:
        raise ServiceError("INVALID_REQUEST", f"{field} needs a time zone (for example 2026-10-08T09:30:00Z).")
    return t.astimezone(timezone.utc).isoformat(timespec="seconds").replace("+00:00", "Z")


def _text(value: Any, field: str, max_len: int, *, required: bool = False) -> str:
    if value is None:
        value = ""
    if not isinstance(value, str):
        raise ServiceError("INVALID_REQUEST", f"{field} must be text.")
    value = value.replace("\r\n", "\n").strip()
    value = re.sub(r"[\x00-\x08\x0b-\x1f\x7f]", "", value)
    if required and not value:
        raise ServiceError("INVALID_REQUEST", f"{field} is required.")
    if len(value) > max_len:
        raise ServiceError("INVALID_REQUEST", f"{field} is longer than {max_len} characters.")
    if CREDENTIAL.search(value):
        raise ServiceError("INVALID_REQUEST", f"{field} looks like it contains a credential; remove it before saving.")
    return value


def _list(value: Any, field: str, allowed: tuple[str, ...] | None = None) -> list[str]:
    if value in (None, "", []):
        return []
    items = value.split(",") if isinstance(value, str) else value
    if not isinstance(items, list) or not all(isinstance(i, str) for i in items):
        raise ServiceError("INVALID_REQUEST", f"{field} must be a list.")
    if allowed:
        unknown = [i for i in items if i not in allowed]
        if unknown:
            raise ServiceError("INVALID_REQUEST", f"Unknown {field}: {', '.join(unknown[:5])}.")
    return list(dict.fromkeys(items))


def _int(value: Any, field: str, default: int, lo: int, hi: int) -> int:
    if value in (None, ""):
        return default
    try:
        n = int(value)
    except (TypeError, ValueError):
        raise ServiceError("INVALID_REQUEST", f"{field} must be a whole number.") from None
    if not lo <= n <= hi:
        raise ServiceError("INVALID_REQUEST", f"{field} must be between {lo} and {hi}.")
    return n


def _flag(value: Any) -> bool:
    return value in (True, "true", "1", 1)


def wire(row: dict[str, Any]) -> dict[str, Any]:
    return {
        "id": row["id"],
        "kind": row["kind"],
        "title": row["title"],
        "body": row["body"],
        "provenance": row["provenance"],
        "sourceRef": row["source_ref"],
        "runId": row["run_id"],
        "equipment": row.get("equipment", []),
        "occurredAt": row["occurred_at"],
        "recordedAt": row["recorded_at"],
        "validUntil": row["valid_until"],
        "status": "superseded" if row["superseded_by"] else "current",
        "supersedes": row["supersedes"],
        "supersededBy": row["superseded_by"],
        "correctionReason": row["correction_reason"],
    }


class MemoryService:
    def __init__(self, store: Any, *, persistent: bool = True, clock: Callable[[], str] = utcnow, ids: Callable[[str], str] | None = None):
        self.store = store
        self.persistent = persistent
        self.clock = clock
        self._new_id = ids or (lambda prefix: f"{prefix}_{secrets.token_hex(6)}")

    def _id(self, prefix: str) -> str:
        return self._new_id(prefix)

    def _ids(self, prefix: str) -> Iterator[str]:
        while True:
            yield self._id(prefix)

    def status(self) -> dict[str, Any]:
        return {
            "service": "memory",
            "storage": {"engine": "sqlite", "persistent": self.persistent, "namespace": "memory"},
            "kinds": list(KINDS),
            "provenance": [
                {"id": p, "allowed": not (self.persistent and p in REFUSED_IN_PERSISTENT), **({"reason": REFUSED_IN_PERSISTENT[p]} if self.persistent and p in REFUSED_IN_PERSISTENT else {})}
                for p in PROVENANCE
            ],
            "linkTypes": {t: {"from": sorted(r[0]), "to": sorted(r[1]), "targetNotEarlier": r[2]} for t, r in LINK_RULES.items()},
            "limits": {"title": 160, "body": 4000, "equipment": 10, "links": 10},
            "retention": "Kept until deleted. Superseded versions are kept as history. Deletion is permanent and removes the record's links and index entry.",
            "totals": self.store.totals(),
        }

    # --- Validation ----------------------------------------------------------------------

    def _fields(self, payload: dict[str, Any], base: dict[str, Any] | None = None) -> tuple[dict[str, Any], list[str]]:
        """A record's validated fields; `base` supplies values a correction leaves unchanged."""
        base = base or {}
        get = lambda k, wire_key: payload[wire_key] if wire_key in payload else base.get(k)  # noqa: E731
        kind = get("kind", "kind")
        if kind not in KINDS:
            raise ServiceError("INVALID_REQUEST", f"kind must be one of {', '.join(KINDS)}.")
        provenance = get("provenance", "provenance") or "user_entered"
        if provenance not in PROVENANCE:
            raise ServiceError("INVALID_REQUEST", f"provenance must be one of {', '.join(PROVENANCE)}.")
        if self.persistent and provenance in REFUSED_IN_PERSISTENT:
            raise ServiceError("INVALID_REQUEST", REFUSED_IN_PERSISTENT[provenance], details={"field": "provenance"})
        source_ref = _text(get("source_ref", "sourceRef"), "sourceRef", 200) or None
        run_id = _text(get("run_id", "runId"), "runId", 64) or None
        if run_id and not RUN_ID.match(run_id):
            raise ServiceError("INVALID_REQUEST", "runId must be a simulation run ID such as RUN-0003.")
        if provenance == "simulation" and not run_id:
            raise ServiceError("INVALID_REQUEST", "A simulation record needs the ID of its simulation run.", details={"field": "runId"})
        if provenance == "imported_record" and not source_ref:
            raise ServiceError("INVALID_REQUEST", "An imported record needs a reference to the record it came from.", details={"field": "sourceRef"})
        equipment = _list(get("equipment", "equipment"), "equipment")
        if len(equipment) > 10 or not all(EQUIPMENT_ID.match(e) for e in equipment):
            raise ServiceError("INVALID_REQUEST", "equipment must be up to 10 equipment IDs such as chiller_plant_2.")
        occurred = _time(get("occurred_at", "occurredAt"), "occurredAt")
        now = datetime.fromisoformat(self.clock().replace("Z", "+00:00"))
        when = datetime.fromisoformat(occurred.replace("Z", "+00:00"))
        if when > now + FUTURE_SKEW:
            raise ServiceError("INVALID_REQUEST", "occurredAt is in the future; memory records what has already happened.")
        if when.year < 1990:
            raise ServiceError("INVALID_REQUEST", "occurredAt is before 1990.")
        record = {
            "kind": kind,
            "title": _text(get("title", "title"), "title", 160, required=True),
            "body": _text(get("body", "body"), "body", 4000),
            "provenance": provenance,
            "source_ref": source_ref,
            "run_id": run_id,
            "occurred_at": occurred,
        }
        return record, equipment

    def _link(self, type_: Any, source: dict[str, Any], target: dict[str, Any]) -> None:
        if type_ not in LINK_RULES:
            raise ServiceError("INVALID_REQUEST", f"Link type must be one of {', '.join(LINK_TYPES)}.")
        sources, targets, ordered = LINK_RULES[type_]
        if source["id"] == target["id"]:
            raise ServiceError("INVALID_REQUEST", "A record cannot link to itself.")
        if source["kind"] not in sources or target["kind"] not in targets:
            raise ServiceError("INVALID_REQUEST", f"{type_} links a {' or '.join(sorted(sources))} to a {' or '.join(sorted(targets))}, not a {source['kind']} to a {target['kind']}.")
        if ordered and target["occurred_at"] < source["occurred_at"]:
            raise ServiceError("INVALID_REQUEST", f"{type_} needs the {target['kind']} to occur after the {source['kind']}.")
        for end in (source, target):
            if end.get("superseded_by"):
                raise ServiceError("CONFLICT", f'"{end["title"]}" has been corrected; link its current version.', details={"currentId": self._current(end["id"])})

    def _current(self, memory_id: str) -> str:
        versions = self.store.chain(memory_id)
        return versions[-1]["id"] if versions else memory_id

    def _links(self, record: dict[str, Any], items: Any) -> list[dict[str, Any]]:
        if items in (None, []):
            return []
        if not isinstance(items, list) or len(items) > 10:
            raise ServiceError("INVALID_REQUEST", "links must be a list of at most 10 links.")
        out = []
        for item in items:
            if not isinstance(item, dict) or (("source" in item) == ("target" in item)):
                raise ServiceError("INVALID_REQUEST", "Each link names either a source or a target record.")
            other_id = item.get("source") or item.get("target")
            other = self.store.get(other_id) if isinstance(other_id, str) else None
            if not other:
                raise ServiceError("NOT_FOUND", f"Linked record {other_id} does not exist.")
            source, target = (other, record) if "source" in item else (record, other)
            self._link(item.get("type"), source, target)
            out.append({"id": self._id("lnk"), "type": item["type"], "source_id": source["id"], "target_id": target["id"], "created_at": record["recorded_at"]})
        if len({(l["type"], l["source_id"], l["target_id"]) for l in out}) != len(out):
            raise ServiceError("INVALID_REQUEST", "The same link is listed twice.")
        return out

    # --- Lifecycle -----------------------------------------------------------------------

    def create(self, payload: dict[str, Any]) -> dict[str, Any]:
        if not isinstance(payload, dict):
            raise ServiceError("INVALID_REQUEST", "Send the record as a JSON object.")
        record, equipment = self._fields(payload)
        record.update(id=self._id("mem"), recorded_at=self.clock(), valid_until=None, supersedes=None, superseded_by=None, correction_reason=None)
        links = self._links(record, payload.get("links"))
        self.store.insert(record, equipment, links)
        return self.inspect(record["id"])

    def supersede(self, memory_id: str, payload: dict[str, Any]) -> dict[str, Any]:
        if not isinstance(payload, dict):
            raise ServiceError("INVALID_REQUEST", "Send the correction as a JSON object.")
        old = self.store.get(memory_id)
        if not old:
            raise ServiceError("NOT_FOUND", "No memory record with this ID exists; it may have been deleted.")
        if old["superseded_by"]:
            raise ServiceError("CONFLICT", "This version has already been corrected; correct the current version.", details={"currentId": self._current(memory_id)})
        reason = _text(payload.get("reason"), "reason", 300, required=True)
        if "kind" in payload and payload["kind"] != old["kind"]:
            raise ServiceError("INVALID_REQUEST", "A correction keeps the record's kind; record a new memory for a different kind.")
        record, equipment = self._fields(payload, {**old, "equipment": old["equipment"]})
        record.update(id=self._id("mem"), recorded_at=self.clock(), valid_until=None, supersedes=memory_id, superseded_by=None, correction_reason=reason)
        if not self.store.supersede(memory_id, record, equipment, self._ids("lnk")):
            raise ServiceError("CONFLICT", "This version was corrected by someone else in the meantime.", details={"currentId": self._current(memory_id)})
        return self.inspect(record["id"])

    def add_link(self, memory_id: str, payload: dict[str, Any]) -> dict[str, Any]:
        record = self.store.get(memory_id)
        if not record:
            raise ServiceError("NOT_FOUND", "No memory record with this ID exists.")
        links = self._links(record, [payload] if isinstance(payload, dict) else payload)
        existing = {(l["type"], l["source_id"], l["target_id"]) for l in self.store.links_of([memory_id])}
        if (links[0]["type"], links[0]["source_id"], links[0]["target_id"]) in existing:
            raise ServiceError("CONFLICT", "These records are already linked this way.")
        self.store.add_link(links[0])
        return self.inspect(memory_id)

    def remove_link(self, memory_id: str, link_id: str) -> dict[str, Any]:
        if not self.store.link(memory_id, link_id):
            raise ServiceError("NOT_FOUND", "This link does not exist on this record.")
        self.store.delete_link(link_id)
        return self.inspect(memory_id)

    def delete(self, memory_id: str) -> dict[str, Any]:
        effects = self.store.delete(memory_id)
        if effects is None:
            raise ServiceError("NOT_FOUND", "No memory record with this ID exists; it may already have been deleted.")
        return effects

    # --- Reading -------------------------------------------------------------------------

    def _filters(self, params: dict[str, Any]) -> dict[str, Any]:
        query = _text(params.get("query"), "query", 300)
        terms = [t for t in re.findall(r"[^\W_]+", query.lower()) if t not in STOPWORDS][:24]
        equipment = _list(params.get("equipment"), "equipment")
        if not all(EQUIPMENT_ID.match(e) for e in equipment):
            raise ServiceError("INVALID_REQUEST", "equipment must be equipment IDs such as chiller_plant_2.")
        f = {
            "kinds": _list(params.get("kinds"), "kinds", KINDS),
            "provenance": _list(params.get("provenance"), "provenance", PROVENANCE),
            "equipment": equipment,
            "run": _text(params.get("run"), "run", 64) or None,
            "from": _time(params["from"], "from") if params.get("from") else None,
            "to": _time(params["to"], "to") if params.get("to") else None,
            "include_superseded": _flag(params.get("includeSuperseded")),
            "match": " OR ".join('"' + t.replace('"', '""') + '"' for t in terms) if terms else None,
        }
        if f["from"] and f["to"] and f["from"] > f["to"]:
            raise ServiceError("INVALID_REQUEST", "from must not be after to.")
        return f

    def list(self, params: dict[str, Any]) -> dict[str, Any]:
        f = self._filters(params)
        limit = _int(params.get("limit"), "limit", 50, 1, 200)
        offset = _int(params.get("offset"), "offset", 0, 0, 1_000_000)
        rows, total = self.store.query(f, limit, offset)
        return {"memories": [wire(r) for r in rows], "total": total, "limit": limit, "offset": offset, "searched": bool(f["match"])}

    def timeline(self, params: dict[str, Any]) -> dict[str, Any]:
        """Records in time order (latest first) with the previous record about the same
        equipment, so a sequence of states reads as a sequence."""
        f = self._filters(params)
        limit = _int(params.get("limit"), "limit", 100, 1, 200)
        rows, total = self.store.query(f, limit)
        entries = [wire(r) for r in rows]
        last: dict[str, str] = {}
        for e in reversed(entries):  # oldest first
            e["previous"] = {eq: last[eq] for eq in e["equipment"] if eq in last}
            if e["status"] == "current":
                for eq in e["equipment"]:
                    last[eq] = e["id"]
        return {"entries": entries, "total": total, "window": {"from": f["from"], "to": f["to"]}}

    def inspect(self, memory_id: str) -> dict[str, Any]:
        row = self.store.get(memory_id)
        if not row:
            raise ServiceError("NOT_FOUND", "No memory record with this ID exists; it may have been deleted.")
        links = self.store.links_of([memory_id])
        other = lambda l: l["target_id"] if l["source_id"] == memory_id else l["source_id"]  # noqa: E731
        others = self.store.many(sorted({other(l) for l in links}))
        return {
            "memory": wire(row),
            "links": [
                {
                    "id": l["id"],
                    "type": l["type"],
                    "direction": "out" if l["source_id"] == memory_id else "in",
                    "other": wire(others[other(l)]) if other(l) in others else None,
                    "createdAt": l["created_at"],
                }
                for l in links
            ],
            "history": [wire(v) for v in self.store.chain(memory_id)],
        }

    # --- Graph -----------------------------------------------------------------------------

    @staticmethod
    def _memory_node(r: dict[str, Any]) -> dict[str, Any]:
        return {
            "id": r["id"],
            "type": r["kind"],
            "label": r["title"],
            "occurredAt": r["occurred_at"],
            "provenance": r["provenance"],
            "status": "superseded" if r["superseded_by"] else "current",
            "equipment": r.get("equipment", []),
            "runId": r["run_id"],
        }

    def _assemble(self, rows: list[dict[str, Any]]) -> dict[str, Any]:
        ids = {r["id"] for r in rows}
        nodes = [self._memory_node(r) for r in rows]
        edges: list[dict[str, Any]] = []
        anchors: dict[str, dict[str, Any]] = {}
        for r in rows:
            for eq in r.get("equipment", []):
                anchors.setdefault(f"equipment:{eq}", {"id": f"equipment:{eq}", "type": "equipment", "label": eq})
                edges.append({"id": f"rel:{r['id']}:{eq}", "type": "RELATES_TO", "source": r["id"], "target": f"equipment:{eq}"})
            if r["run_id"]:
                anchors.setdefault(f"run:{r['run_id']}", {"id": f"run:{r['run_id']}", "type": "simulation_run", "label": r["run_id"]})
                edges.append({"id": f"run:{r['id']}", "type": "PART_OF_RUN", "source": r["id"], "target": f"run:{r['run_id']}"})
            if r["supersedes"] in ids:
                edges.append({"id": f"sup:{r['id']}", "type": "SUPERSEDES", "source": r["id"], "target": r["supersedes"]})
        for l in self.store.links_of(sorted(ids)):
            if l["source_id"] in ids and l["target_id"] in ids:
                edges.append({"id": l["id"], "type": l["type"], "source": l["source_id"], "target": l["target_id"]})
        # Derived, not stored: consecutive current records about the same equipment.
        lanes: dict[str, list[dict[str, Any]]] = {}
        for r in sorted(rows, key=lambda r: (r["occurred_at"], r["recorded_at"], r["id"])):
            if not r["superseded_by"]:
                for eq in r.get("equipment", []):
                    lanes.setdefault(eq, []).append(r)
        for eq, lane in lanes.items():
            for a, b in zip(lane, lane[1:]):
                edges.append({"id": f"seq:{eq}:{a['id']}:{b['id']}", "type": "OCCURRED_BEFORE", "source": a["id"], "target": b["id"], "derived": True, "equipment": eq})
        return {"nodes": nodes + list(anchors.values()), "edges": edges}

    def graph(self, params: dict[str, Any]) -> dict[str, Any]:
        f = self._filters(params)
        limit = _int(params.get("limit"), "limit", 120, 1, GRAPH_LIMIT)
        rows, total = self.store.query(f, limit)
        return {**self._assemble(rows), "total": total, "truncated": total > len(rows), "limit": limit, "window": {"from": f["from"], "to": f["to"]}}

    def expand(self, node_id: str, params: dict[str, Any]) -> dict[str, Any]:
        """A node's neighbourhood: a record with everything it links to and its versions,
        or an equipment item or simulation run with the records about it (bounded)."""
        limit = _int(params.get("limit"), "limit", 40, 1, 100)
        if node_id.startswith("equipment:") or node_id.startswith("run:"):
            key = node_id.split(":", 1)[1]
            f = {"equipment": [key]} if node_id.startswith("equipment:") else {"run": key}
            rows, total = self.store.query({**f, "include_superseded": _flag(params.get("includeSuperseded"))}, limit)
            if not rows:
                raise ServiceError("NOT_FOUND", "No memory records refer to this item.")
            return {**self._assemble(rows), "focus": node_id, "total": total, "hasMore": total > len(rows)}
        row = self.store.get(node_id)
        if not row:
            raise ServiceError("NOT_FOUND", "No memory record with this ID exists; it may have been deleted.")
        links = self.store.links_of([node_id])
        ids = {node_id} | {l["source_id"] for l in links} | {l["target_id"] for l in links}
        ids |= {v["id"] for v in self.store.chain(node_id)}
        rows = list(self.store.many(sorted(ids)).values())[:limit]
        return {**self._assemble(rows), "focus": node_id, "total": len(ids), "hasMore": len(ids) > limit}
