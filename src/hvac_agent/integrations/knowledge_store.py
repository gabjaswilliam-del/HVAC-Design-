"""SQLite storage for the knowledge library (the Graph RAG namespace).

One database file holds this namespace only: documents with their original bytes (for
reindexing), sections, passages, the keyword index (FTS5, ranked by BM25), optional
passage vectors, vocabulary mentions, and the relationship graph with its evidence.
Graph Memory keeps its own file (memory_store.py); nothing here reads or writes it.

All access is serialised by one lock. ponytail: a global lock suits one local service;
use a server database before many concurrent writers.
"""

from __future__ import annotations

import json
import sqlite3
import threading
from contextlib import contextmanager
from pathlib import Path
from typing import Any, Iterable, Iterator

SCHEMA = """
CREATE TABLE IF NOT EXISTS documents (
  id TEXT PRIMARY KEY,
  sha256 TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  title TEXT NOT NULL,
  media_type TEXT NOT NULL,
  size_bytes INTEGER NOT NULL,
  kind TEXT NOT NULL,
  metadata TEXT NOT NULL,
  revision INTEGER NOT NULL DEFAULT 1,
  generation INTEGER NOT NULL DEFAULT 0,
  status TEXT NOT NULL,
  stages TEXT NOT NULL,
  error TEXT,
  pipeline TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  indexed_at TEXT,
  content BLOB NOT NULL
);
CREATE TABLE IF NOT EXISTS sections (
  id TEXT PRIMARY KEY,
  document_id TEXT NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
  ordinal INTEGER NOT NULL,
  heading TEXT NOT NULL,
  level INTEGER NOT NULL,
  parent_id TEXT,
  path TEXT NOT NULL,
  page INTEGER,
  span_start INTEGER NOT NULL,
  span_end INTEGER NOT NULL,
  procedure INTEGER NOT NULL DEFAULT 0
);
CREATE TABLE IF NOT EXISTS chunks (
  id TEXT PRIMARY KEY,
  document_id TEXT NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
  section_id TEXT NOT NULL,
  ordinal INTEGER NOT NULL,
  span_start INTEGER NOT NULL,
  span_end INTEGER NOT NULL,
  page INTEGER,
  text TEXT NOT NULL,
  embedding BLOB,
  embedding_model TEXT
);
CREATE VIRTUAL TABLE IF NOT EXISTS chunks_fts USING fts5(
  chunk_id UNINDEXED, document_id UNINDEXED, text, tokenize = 'porter unicode61'
);
CREATE TABLE IF NOT EXISTS entities (
  id TEXT PRIMARY KEY,
  type TEXT NOT NULL,
  name TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS mentions (
  entity_id TEXT NOT NULL,
  document_id TEXT NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
  section_id TEXT NOT NULL,
  chunk_id TEXT,
  span_start INTEGER NOT NULL,
  span_end INTEGER NOT NULL,
  surface TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS relations (
  id TEXT PRIMARY KEY,
  type TEXT NOT NULL,
  source_id TEXT NOT NULL,
  target_id TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS evidence (
  relation_id TEXT NOT NULL,
  document_id TEXT NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
  chunk_id TEXT,
  span_start INTEGER,
  span_end INTEGER,
  rule TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS sections_document ON sections(document_id);
CREATE INDEX IF NOT EXISTS chunks_document ON chunks(document_id, ordinal);
CREATE INDEX IF NOT EXISTS mentions_entity ON mentions(entity_id);
CREATE INDEX IF NOT EXISTS mentions_chunk ON mentions(chunk_id);
CREATE INDEX IF NOT EXISTS mentions_document ON mentions(document_id);
CREATE INDEX IF NOT EXISTS relations_source ON relations(source_id);
CREATE INDEX IF NOT EXISTS relations_target ON relations(target_id);
CREATE INDEX IF NOT EXISTS evidence_relation ON evidence(relation_id);
CREATE INDEX IF NOT EXISTS evidence_document ON evidence(document_id);
"""

# Every graph node: documents with an index (the last successful run), their sections, and entities.
NODES = """
  SELECT id, 'document' AS type, title AS label, id AS document_id FROM documents WHERE indexed_at IS NOT NULL
  UNION ALL SELECT id, 'section', heading, document_id FROM sections
  UNION ALL SELECT id, type, name, NULL FROM entities
"""
DEGREE = "SELECT id, COUNT(*) AS n FROM (SELECT source_id AS id FROM relations UNION ALL SELECT target_id FROM relations) GROUP BY id"


def _marks(values: Iterable[Any]) -> str:
    return ",".join("?" for _ in values)


class KnowledgeStore:
    def __init__(self, path: str | Path):
        self.path = str(path)
        self.lock = threading.RLock()
        self.db = sqlite3.connect(self.path, check_same_thread=False, isolation_level=None)
        self.db.row_factory = sqlite3.Row
        self.db.execute("PRAGMA foreign_keys = ON")
        self.db.execute("PRAGMA secure_delete = ON")  # removed content is overwritten, not left in free pages
        try:
            self.db.executescript(SCHEMA)
        except sqlite3.OperationalError as e:
            if "fts5" in str(e).lower():
                raise RuntimeError("This Python's SQLite has no FTS5 full-text search, which the knowledge store needs.") from None
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

    def _one(self, sql: str, params: Iterable[Any] = ()) -> dict[str, Any] | None:
        rows = self._all(sql, params)
        return rows[0] if rows else None

    # --- Documents -------------------------------------------------------------------

    _DOC = """id, sha256, name, title, media_type, size_bytes, kind, metadata, revision, generation, status,
      stages, error, pipeline, created_at, updated_at, indexed_at,
      (SELECT COUNT(*) FROM sections s WHERE s.document_id = documents.id) AS section_count,
      (SELECT COUNT(*) FROM chunks c WHERE c.document_id = documents.id) AS chunk_count"""

    @staticmethod
    def _doc(row: dict[str, Any] | None) -> dict[str, Any] | None:
        if row:
            row["metadata"] = json.loads(row["metadata"])
            row["stages"] = json.loads(row["stages"])
        return row

    def insert_document(self, row: dict[str, Any]) -> None:
        row = {**row, "metadata": json.dumps(row["metadata"]), "stages": json.dumps(row["stages"])}
        with self.tx() as db:
            db.execute(f"INSERT INTO documents ({','.join(row)}) VALUES ({_marks(row)})", tuple(row.values()))

    def document_by_sha(self, sha256: str) -> dict[str, Any] | None:
        return self._doc(self._one(f"SELECT {self._DOC} FROM documents WHERE sha256 = ?", (sha256,)))

    def get_document(self, document_id: str) -> dict[str, Any] | None:
        return self._doc(self._one(f"SELECT {self._DOC} FROM documents WHERE id = ?", (document_id,)))

    def list_documents(self, limit: int) -> list[dict[str, Any]]:
        return [self._doc(r) for r in self._all(f"SELECT {self._DOC} FROM documents ORDER BY created_at DESC, id LIMIT ?", (limit,))]  # type: ignore[misc]

    def content(self, document_id: str) -> bytes | None:
        row = self._one("SELECT content FROM documents WHERE id = ?", (document_id,))
        return row["content"] if row else None

    def outline(self, document_id: str) -> list[dict[str, Any]]:
        return self._all(
            """SELECT s.id, s.ordinal, s.heading, s.level, s.parent_id, s.path, s.page, s.procedure,
                 (SELECT COUNT(*) FROM chunks c WHERE c.section_id = s.id) AS chunk_count,
                 (SELECT c.id FROM chunks c WHERE c.section_id = s.id ORDER BY c.ordinal LIMIT 1) AS first_chunk
               FROM sections s WHERE s.document_id = ? ORDER BY s.ordinal""",
            (document_id,),
        )

    def set_state(self, document_id: str, generation: int, **fields: Any) -> bool:
        """Update a document's status fields if this job still owns it (same generation)."""
        if "stages" in fields:
            fields["stages"] = json.dumps(fields["stages"])
        with self.tx() as db:
            cur = db.execute(
                f"UPDATE documents SET {', '.join(f'{k} = ?' for k in fields)} WHERE id = ? AND generation = ?",
                (*fields.values(), document_id, generation),
            )
            return cur.rowcount > 0

    def queue(self, document_id: str, stages: list[dict[str, Any]], now: str) -> bool:
        with self.tx() as db:
            cur = db.execute(
                "UPDATE documents SET status = 'queued', stages = ?, error = NULL, updated_at = ? WHERE id = ? AND status NOT IN ('queued', 'processing')",
                (json.dumps(stages), now, document_id),
            )
            return cur.rowcount > 0

    def claim_next(self, now: str) -> dict[str, Any] | None:
        """The oldest queued document, now processing under a new generation."""
        with self.tx() as db:
            row = db.execute("SELECT id FROM documents WHERE status = 'queued' ORDER BY updated_at, id LIMIT 1").fetchone()
            if not row:
                return None
            db.execute("UPDATE documents SET status = 'processing', generation = generation + 1, updated_at = ? WHERE id = ?", (now, row["id"]))
        doc = self.get_document(row["id"])
        if doc:
            doc["content"] = self.content(row["id"])
        return doc

    def requeue_interrupted(self, now: str) -> int:
        """Jobs a stopped service left processing start again from the beginning."""
        with self.tx() as db:
            return db.execute("UPDATE documents SET status = 'queued', updated_at = ? WHERE status = 'processing'", (now,)).rowcount

    def write_index(self, document_id: str, generation: int, index: dict[str, list[tuple]], state: dict[str, Any]) -> bool:
        """Replace a document's whole index in one transaction, if the job still owns it.
        `index` holds rows for sections, chunks, entities, mentions, relations, evidence."""
        with self.tx() as db:
            owner = db.execute("SELECT 1 FROM documents WHERE id = ? AND generation = ?", (document_id, generation)).fetchone()
            if not owner:
                return False
            self._drop_index(db, document_id)
            db.executemany("INSERT INTO sections VALUES (?,?,?,?,?,?,?,?,?,?,?)", index["sections"])
            db.executemany("INSERT INTO chunks VALUES (?,?,?,?,?,?,?,?,?,?)", index["chunks"])
            db.executemany(
                "INSERT INTO chunks_fts (chunk_id, document_id, text) VALUES (?,?,?)",
                [(c[0], c[1], c[7]) for c in index["chunks"]],
            )
            db.executemany("INSERT OR IGNORE INTO entities VALUES (?,?,?)", index["entities"])
            db.executemany("INSERT INTO mentions VALUES (?,?,?,?,?,?,?)", index["mentions"])
            db.executemany("INSERT OR IGNORE INTO relations VALUES (?,?,?,?)", index["relations"])
            db.executemany("INSERT INTO evidence VALUES (?,?,?,?,?,?)", index["evidence"])
            self._drop_orphans(db)
            fields = {**state, "stages": json.dumps(state["stages"])}
            db.execute(f"UPDATE documents SET {', '.join(f'{k} = ?' for k in fields)} WHERE id = ?", (*fields.values(), document_id))
            return True

    def delete_document(self, document_id: str) -> dict[str, int] | None:
        with self.tx() as db:
            if not db.execute("SELECT 1 FROM documents WHERE id = ?", (document_id,)).fetchone():
                return None
            before = self._totals(db)
            self._drop_index(db, document_id)
            db.execute("DELETE FROM documents WHERE id = ?", (document_id,))
            self._drop_orphans(db)
            after = self._totals(db)
        return {k: before[k] - after[k] for k in before}

    @staticmethod
    def _drop_index(db: sqlite3.Connection, document_id: str) -> None:
        db.execute("DELETE FROM chunks_fts WHERE document_id = ?", (document_id,))
        for table in ("evidence", "mentions", "chunks", "sections"):
            db.execute(f"DELETE FROM {table} WHERE document_id = ?", (document_id,))

    @staticmethod
    def _drop_orphans(db: sqlite3.Connection) -> None:
        """A relationship without evidence, and an entity nothing mentions or relates, go."""
        db.execute("DELETE FROM relations WHERE NOT EXISTS (SELECT 1 FROM evidence e WHERE e.relation_id = relations.id)")
        db.execute(
            """DELETE FROM entities WHERE NOT EXISTS (SELECT 1 FROM mentions m WHERE m.entity_id = entities.id)
               AND NOT EXISTS (SELECT 1 FROM relations r WHERE r.source_id = entities.id OR r.target_id = entities.id)"""
        )

    @staticmethod
    def _totals(db: sqlite3.Connection) -> dict[str, int]:
        q = lambda sql: db.execute(sql).fetchone()[0]  # noqa: E731
        return {
            "documents": q("SELECT COUNT(*) FROM documents"),
            "sections": q("SELECT COUNT(*) FROM sections"),
            "chunks": q("SELECT COUNT(*) FROM chunks"),
            "keywordRows": q("SELECT COUNT(*) FROM chunks_fts"),
            "mentions": q("SELECT COUNT(*) FROM mentions"),
            "entities": q("SELECT COUNT(*) FROM entities"),
            "relations": q("SELECT COUNT(*) FROM relations"),
            "evidence": q("SELECT COUNT(*) FROM evidence"),
        }

    def totals(self) -> dict[str, int]:
        with self.lock:
            totals = self._totals(self.db)
            totals["vectors"] = self.db.execute("SELECT COUNT(*) FROM chunks WHERE embedding IS NOT NULL").fetchone()[0]
            return totals

    # --- Retrieval -------------------------------------------------------------------

    def keyword(self, match: str, limit: int) -> list[dict[str, Any]]:
        """Passages matching an FTS5 query, best BM25 first (FTS5's bm25 is lower-is-better)."""
        return self._all(
            "SELECT chunk_id, bm25(chunks_fts) AS score FROM chunks_fts WHERE chunks_fts MATCH ? ORDER BY score LIMIT ?",
            (match, limit),
        )

    def mentioning(self, entity_ids: list[str], limit: int) -> list[dict[str, Any]]:
        if not entity_ids:
            return []
        return self._all(
            f"""SELECT chunk_id, entity_id, COUNT(*) AS n FROM mentions
                WHERE entity_id IN ({_marks(entity_ids)}) AND chunk_id IS NOT NULL
                GROUP BY chunk_id, entity_id ORDER BY n DESC LIMIT ?""",
            (*entity_ids, limit),
        )

    def related_evidence(self, entity_ids: list[str], types: tuple[str, ...], limit: int) -> list[dict[str, Any]]:
        """Relationships of these entities (by type) and the passages that justify them."""
        if not entity_ids:
            return []
        return self._all(
            f"""SELECT r.id, r.type, r.source_id, r.target_id, e.chunk_id, e.rule FROM relations r
                JOIN evidence e ON e.relation_id = r.id
                WHERE r.type IN ({_marks(types)}) AND e.chunk_id IS NOT NULL
                  AND (r.source_id IN ({_marks(entity_ids)}) OR r.target_id IN ({_marks(entity_ids)}))
                LIMIT ?""",
            (*types, *entity_ids, *entity_ids, limit),
        )

    def vectors(self, model: str) -> list[dict[str, Any]]:
        return self._all("SELECT id AS chunk_id, embedding FROM chunks WHERE embedding_model = ?", (model,))

    def vector_models(self) -> list[dict[str, Any]]:
        return self._all("SELECT embedding_model AS model, COUNT(*) AS n FROM chunks WHERE embedding_model IS NOT NULL GROUP BY embedding_model")

    def passages(self, chunk_ids: list[str]) -> dict[str, dict[str, Any]]:
        if not chunk_ids:
            return {}
        rows = self._all(
            f"""SELECT c.id, c.document_id, c.section_id, c.ordinal, c.span_start, c.span_end, c.page, c.text,
                  d.title AS document_title, d.name AS document_name, d.revision, d.media_type, d.kind, d.indexed_at, d.pipeline,
                  s.heading AS section_heading, s.path AS section_path, s.procedure
                FROM chunks c JOIN documents d ON d.id = c.document_id JOIN sections s ON s.id = c.section_id
                WHERE c.id IN ({_marks(chunk_ids)})""",
            chunk_ids,
        )
        return {r["id"]: r for r in rows}

    def chunk_entities(self, chunk_ids: list[str]) -> list[dict[str, Any]]:
        if not chunk_ids:
            return []
        return self._all(
            f"""SELECT m.chunk_id, m.entity_id, e.type, e.name, m.span_start, m.span_end FROM mentions m
                JOIN entities e ON e.id = m.entity_id WHERE m.chunk_id IN ({_marks(chunk_ids)}) ORDER BY m.span_start""",
            chunk_ids,
        )

    def entities(self, entity_ids: list[str]) -> dict[str, dict[str, Any]]:
        if not entity_ids:
            return {}
        return {r["id"]: r for r in self._all(f"SELECT id, type, name FROM entities WHERE id IN ({_marks(entity_ids)})", entity_ids)}

    def chunk_ids(self) -> list[str]:
        return [r["id"] for r in self._all("SELECT id FROM chunks ORDER BY document_id, ordinal")]

    def neighbour_chunk(self, document_id: str, ordinal: int) -> str | None:
        row = self._one("SELECT id FROM chunks WHERE document_id = ? AND ordinal = ?", (document_id, ordinal))
        return row["id"] if row else None

    # --- Graph -------------------------------------------------------------------------

    def overview(self, types: list[str], limit: int, document_id: str | None) -> tuple[list[dict[str, Any]], int]:
        """The best-connected nodes of these types (optionally those one document
        contributes), and how many there are in all."""
        where = f"n.type IN ({_marks(types)})"
        params: list[Any] = list(types)
        if document_id:
            where += """ AND (n.document_id = ? OR EXISTS (SELECT 1 FROM relations r JOIN evidence e ON e.relation_id = r.id
                         WHERE (r.source_id = n.id OR r.target_id = n.id) AND e.document_id = ?))"""
            params += [document_id, document_id]
        base = f"WITH deg AS ({DEGREE}), n AS ({NODES}) SELECT n.id, n.type, n.label, n.document_id, COALESCE(deg.n, 0) AS degree FROM n LEFT JOIN deg ON deg.id = n.id WHERE {where}"
        with self.lock:
            total = self.db.execute(f"SELECT COUNT(*) FROM ({base})", params).fetchone()[0]
            rows = [dict(r) for r in self.db.execute(f"{base} ORDER BY degree DESC, n.label, n.id LIMIT ?", (*params, limit))]
        return rows, total

    def nodes(self, ids: list[str]) -> dict[str, dict[str, Any]]:
        if not ids:
            return {}
        rows = self._all(
            f"WITH deg AS ({DEGREE}), n AS ({NODES}) SELECT n.id, n.type, n.label, n.document_id, COALESCE(deg.n, 0) AS degree FROM n LEFT JOIN deg ON deg.id = n.id WHERE n.id IN ({_marks(ids)})",
            ids,
        )
        return {r["id"]: r for r in rows}

    def edges_among(self, ids: list[str]) -> list[dict[str, Any]]:
        if not ids:
            return []
        return self._all(
            f"""SELECT r.id, r.type, r.source_id, r.target_id, (SELECT COUNT(*) FROM evidence e WHERE e.relation_id = r.id) AS evidence
                FROM relations r WHERE r.source_id IN ({_marks(ids)}) AND r.target_id IN ({_marks(ids)}) ORDER BY r.id""",
            (*ids, *ids),
        )

    def edges_of(self, node_id: str, types: list[str] | None, limit: int) -> list[dict[str, Any]]:
        type_filter = f"AND r.type IN ({_marks(types)})" if types else ""
        return self._all(
            f"""SELECT r.id, r.type, r.source_id, r.target_id, (SELECT COUNT(*) FROM evidence e WHERE e.relation_id = r.id) AS evidence
                FROM relations r WHERE (r.source_id = ? OR r.target_id = ?) {type_filter} ORDER BY r.type, r.id LIMIT ?""",
            (node_id, node_id, *(types or []), limit),
        )

    def relation(self, relation_id: str) -> dict[str, Any] | None:
        return self._one("SELECT id, type, source_id, target_id FROM relations WHERE id = ?", (relation_id,))

    def evidence(self, relation_id: str, limit: int) -> tuple[list[dict[str, Any]], int]:
        with self.lock:
            total = self.db.execute("SELECT COUNT(*) FROM evidence WHERE relation_id = ?", (relation_id,)).fetchone()[0]
        rows = self._all(
            """SELECT e.document_id, e.chunk_id, e.span_start, e.span_end, e.rule, d.title AS document_title, d.revision,
                 c.text, c.span_start AS chunk_start, c.page, s.path AS section_path
               FROM evidence e JOIN documents d ON d.id = e.document_id
               LEFT JOIN chunks c ON c.id = e.chunk_id LEFT JOIN sections s ON s.id = c.section_id
               WHERE e.relation_id = ? ORDER BY d.title, e.span_start LIMIT ?""",
            (relation_id, limit),
        )
        return rows, total

    def entity_mentions(self, entity_id: str, limit: int) -> tuple[list[dict[str, Any]], int]:
        with self.lock:
            total = self.db.execute("SELECT COUNT(*) FROM mentions WHERE entity_id = ?", (entity_id,)).fetchone()[0]
        rows = self._all(
            """SELECT m.document_id, m.chunk_id, m.span_start, m.span_end, m.surface, d.title AS document_title, d.revision,
                 c.text, c.span_start AS chunk_start, c.page, s.path AS section_path
               FROM mentions m JOIN documents d ON d.id = m.document_id
               LEFT JOIN chunks c ON c.id = m.chunk_id LEFT JOIN sections s ON s.id = m.section_id
               WHERE m.entity_id = ? ORDER BY d.title, m.span_start LIMIT ?""",
            (entity_id, limit),
        )
        return rows, total

    def section(self, section_id: str) -> dict[str, Any] | None:
        return self._one(
            """SELECT s.id, s.document_id, s.heading, s.path, s.page, s.procedure, d.title AS document_title,
                 (SELECT id FROM chunks c WHERE c.section_id = s.id ORDER BY c.ordinal LIMIT 1) AS first_chunk
               FROM sections s JOIN documents d ON d.id = s.document_id WHERE s.id = ?""",
            (section_id,),
        )
