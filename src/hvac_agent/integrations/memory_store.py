"""SQLite storage for Graph Memory (the memory namespace).

Its own database file, separate from the knowledge library: memory records with their
temporal fields (when it happened, when it was recorded, until when it was valid), the
supersession chain, typed links between records, the equipment each record is about,
and a keyword index. Nothing here reads or writes the knowledge store.
"""

from __future__ import annotations

import sqlite3
import threading
from contextlib import contextmanager
from pathlib import Path
from typing import Any, Iterable, Iterator

SCHEMA = """
CREATE TABLE IF NOT EXISTS memories (
  id TEXT PRIMARY KEY,
  kind TEXT NOT NULL CHECK (kind IN ('event', 'observation', 'finding', 'decision', 'correction', 'outcome')),
  title TEXT NOT NULL,
  body TEXT NOT NULL,
  provenance TEXT NOT NULL CHECK (provenance IN ('simulation', 'demo', 'user_entered', 'imported_record', 'verified_operational_source')),
  source_ref TEXT,
  run_id TEXT,
  occurred_at TEXT NOT NULL,
  recorded_at TEXT NOT NULL,
  valid_until TEXT,
  supersedes TEXT,
  superseded_by TEXT,
  correction_reason TEXT
);
CREATE TABLE IF NOT EXISTS memory_equipment (
  memory_id TEXT NOT NULL REFERENCES memories(id) ON DELETE CASCADE,
  equipment_id TEXT NOT NULL,
  PRIMARY KEY (memory_id, equipment_id)
);
CREATE TABLE IF NOT EXISTS links (
  id TEXT PRIMARY KEY,
  type TEXT NOT NULL CHECK (type IN ('RESULTED_IN', 'RESOLVED_BY', 'SUPPORTED_BY')),
  source_id TEXT NOT NULL REFERENCES memories(id) ON DELETE CASCADE,
  target_id TEXT NOT NULL REFERENCES memories(id) ON DELETE CASCADE,
  created_at TEXT NOT NULL,
  UNIQUE (type, source_id, target_id)
);
CREATE VIRTUAL TABLE IF NOT EXISTS memories_fts USING fts5(memory_id UNINDEXED, title, body, tokenize = 'porter unicode61');
CREATE INDEX IF NOT EXISTS memories_occurred ON memories(occurred_at);
CREATE INDEX IF NOT EXISTS memories_run ON memories(run_id);
CREATE INDEX IF NOT EXISTS memory_equipment_id ON memory_equipment(equipment_id);
CREATE INDEX IF NOT EXISTS links_source ON links(source_id);
CREATE INDEX IF NOT EXISTS links_target ON links(target_id);
"""

COLUMNS = "id, kind, title, body, provenance, source_ref, run_id, occurred_at, recorded_at, valid_until, supersedes, superseded_by, correction_reason"


def _marks(values: Iterable[Any]) -> str:
    return ",".join("?" for _ in values)


class MemoryStore:
    def __init__(self, path: str | Path):
        self.path = str(path)
        self.lock = threading.RLock()
        self.db = sqlite3.connect(self.path, check_same_thread=False, isolation_level=None)
        self.db.row_factory = sqlite3.Row
        self.db.execute("PRAGMA foreign_keys = ON")
        self.db.execute("PRAGMA secure_delete = ON")
        try:
            self.db.executescript(SCHEMA)
        except sqlite3.OperationalError as e:
            if "fts5" in str(e).lower():
                raise RuntimeError("This Python's SQLite has no FTS5 full-text search, which the memory store needs.") from None
            raise

    def close(self) -> None:
        with self.lock:
            self.db.close()

    @contextmanager
    def tx(self) -> Iterator[sqlite3.Connection]:
        with self.lock:
            self.db.execute("BEGIN IMMEDIATE")
            try:
                yield self.db
            except BaseException:
                self.db.execute("ROLLBACK")
                raise
            self.db.execute("COMMIT")

    def _all(self, sql: str, params: Iterable[Any] = ()) -> list[dict[str, Any]]:
        with self.lock:
            return [dict(r) for r in self.db.execute(sql, tuple(params))]

    def _with_equipment(self, rows: list[dict[str, Any]]) -> list[dict[str, Any]]:
        if rows:
            ids = [r["id"] for r in rows]
            eq: dict[str, list[str]] = {}
            for e in self._all(f"SELECT memory_id, equipment_id FROM memory_equipment WHERE memory_id IN ({_marks(ids)}) ORDER BY equipment_id", ids):
                eq.setdefault(e["memory_id"], []).append(e["equipment_id"])
            for r in rows:
                r["equipment"] = eq.get(r["id"], [])
        return rows

    @staticmethod
    def _insert(db: sqlite3.Connection, record: dict[str, Any], equipment: list[str]) -> None:
        cols = COLUMNS.split(", ")
        db.execute(f"INSERT INTO memories ({COLUMNS}) VALUES ({_marks(cols)})", tuple(record.get(c) for c in cols))
        db.executemany("INSERT INTO memory_equipment VALUES (?, ?)", [(record["id"], e) for e in equipment])
        db.execute("INSERT INTO memories_fts (memory_id, title, body) VALUES (?, ?, ?)", (record["id"], record["title"], record["body"]))

    def insert(self, record: dict[str, Any], equipment: list[str], links: list[dict[str, Any]]) -> None:
        with self.tx() as db:
            self._insert(db, record, equipment)
            db.executemany("INSERT INTO links VALUES (:id, :type, :source_id, :target_id, :created_at)", links)

    def get(self, memory_id: str) -> dict[str, Any] | None:
        rows = self._with_equipment(self._all(f"SELECT {COLUMNS} FROM memories WHERE id = ?", (memory_id,)))
        return rows[0] if rows else None

    def many(self, ids: list[str]) -> dict[str, dict[str, Any]]:
        if not ids:
            return {}
        return {r["id"]: r for r in self._with_equipment(self._all(f"SELECT {COLUMNS} FROM memories WHERE id IN ({_marks(ids)})", ids))}

    def query(self, f: dict[str, Any], limit: int, offset: int = 0) -> tuple[list[dict[str, Any]], int]:
        """Records matching the filters, latest occurrence first, and how many match."""
        where, params = ["1 = 1"], []
        if not f.get("include_superseded"):
            where.append("m.superseded_by IS NULL")
        if f.get("kinds"):
            where.append(f"m.kind IN ({_marks(f['kinds'])})")
            params += f["kinds"]
        if f.get("provenance"):
            where.append(f"m.provenance IN ({_marks(f['provenance'])})")
            params += f["provenance"]
        if f.get("equipment"):
            where.append(f"EXISTS (SELECT 1 FROM memory_equipment e WHERE e.memory_id = m.id AND e.equipment_id IN ({_marks(f['equipment'])}))")
            params += f["equipment"]
        if f.get("run"):
            where.append("m.run_id = ?")
            params.append(f["run"])
        if f.get("from"):
            where.append("m.occurred_at >= ?")
            params.append(f["from"])
        if f.get("to"):
            where.append("m.occurred_at <= ?")
            params.append(f["to"])
        if f.get("match"):
            where.append("m.id IN (SELECT memory_id FROM memories_fts WHERE memories_fts MATCH ?)")
            params.append(f["match"])
        sql = f"FROM memories m WHERE {' AND '.join(where)}"
        with self.lock:
            total = self.db.execute(f"SELECT COUNT(*) {sql}", params).fetchone()[0]
            rows = [dict(r) for r in self.db.execute(f"SELECT {COLUMNS} {sql} ORDER BY m.occurred_at DESC, m.recorded_at DESC, m.id LIMIT ? OFFSET ?", (*params, limit, offset))]
        return self._with_equipment(rows), total

    def links_of(self, ids: list[str]) -> list[dict[str, Any]]:
        if not ids:
            return []
        return self._all(
            f"SELECT id, type, source_id, target_id, created_at FROM links WHERE source_id IN ({_marks(ids)}) OR target_id IN ({_marks(ids)}) ORDER BY created_at, id",
            (*ids, *ids),
        )

    def link(self, memory_id: str, link_id: str) -> dict[str, Any] | None:
        rows = self._all("SELECT id, type, source_id, target_id, created_at FROM links WHERE id = ? AND (source_id = ? OR target_id = ?)", (link_id, memory_id, memory_id))
        return rows[0] if rows else None

    def add_link(self, link: dict[str, Any]) -> None:
        with self.tx() as db:
            db.execute("INSERT INTO links VALUES (:id, :type, :source_id, :target_id, :created_at)", link)

    def delete_link(self, link_id: str) -> None:
        with self.tx() as db:
            db.execute("DELETE FROM links WHERE id = ?", (link_id,))

    def chain(self, memory_id: str) -> list[dict[str, Any]]:
        """Every version of a record, oldest first."""
        row, seen = self.get(memory_id), set()
        while row and row["supersedes"] and row["id"] not in seen:  # back to the first version
            seen.add(row["id"])
            row = self.get(row["supersedes"]) or row
        versions: list[dict[str, Any]] = []
        seen = set()
        while row and row["id"] not in seen:  # then forward to the current one
            seen.add(row["id"])
            versions.append(row)
            row = self.get(row["superseded_by"]) if row["superseded_by"] else None
        return versions

    def supersede(self, old_id: str, record: dict[str, Any], equipment: list[str], link_ids: Iterator[str]) -> bool:
        """Write the new version, close the old one, and carry the old version's links over.
        False if the old version was superseded in the meantime."""
        with self.tx() as db:
            cur = db.execute(
                "UPDATE memories SET superseded_by = ?, valid_until = ? WHERE id = ? AND superseded_by IS NULL",
                (record["id"], record["recorded_at"], old_id),
            )
            if cur.rowcount == 0:
                return False
            self._insert(db, record, equipment)
            for link in [dict(r) for r in db.execute("SELECT type, source_id, target_id FROM links WHERE source_id = ? OR target_id = ?", (old_id, old_id))]:
                source = record["id"] if link["source_id"] == old_id else link["source_id"]
                target = record["id"] if link["target_id"] == old_id else link["target_id"]
                db.execute(
                    "INSERT OR IGNORE INTO links VALUES (?, ?, ?, ?, ?)",
                    (next(link_ids), link["type"], source, target, record["recorded_at"]),
                )
            return True

    def delete(self, memory_id: str) -> dict[str, Any] | None:
        """Remove a record, its links and its index entry. A version it superseded becomes
        current again; a version that superseded it no longer points back to it."""
        with self.tx() as db:
            row = db.execute("SELECT id, supersedes, superseded_by FROM memories WHERE id = ?", (memory_id,)).fetchone()
            if not row:
                return None
            links = db.execute("SELECT COUNT(*) FROM links WHERE source_id = ? OR target_id = ?", (memory_id, memory_id)).fetchone()[0]
            restored = None
            if row["supersedes"]:
                cur = db.execute("UPDATE memories SET superseded_by = NULL, valid_until = NULL WHERE id = ? AND superseded_by = ?", (row["supersedes"], memory_id))
                restored = row["supersedes"] if cur.rowcount else None
            db.execute("UPDATE memories SET supersedes = NULL WHERE supersedes = ?", (memory_id,))
            db.execute("DELETE FROM memories_fts WHERE memory_id = ?", (memory_id,))
            db.execute("DELETE FROM memories WHERE id = ?", (memory_id,))
            return {"deleted": memory_id, "removedLinks": links, "restored": restored, "newerVersion": row["superseded_by"]}

    def totals(self) -> dict[str, int]:
        with self.lock:
            q = lambda sql: self.db.execute(sql).fetchone()[0]  # noqa: E731
            return {
                "memories": q("SELECT COUNT(*) FROM memories"),
                "current": q("SELECT COUNT(*) FROM memories WHERE superseded_by IS NULL"),
                "superseded": q("SELECT COUNT(*) FROM memories WHERE superseded_by IS NOT NULL"),
                "links": q("SELECT COUNT(*) FROM links"),
                "keywordRows": q("SELECT COUNT(*) FROM memories_fts"),
            }
