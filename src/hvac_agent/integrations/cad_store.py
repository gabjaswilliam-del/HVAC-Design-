"""SQLite metadata and original drawing files for CAD projects (the CAD namespace).

The CAD folder lives outside the repository (apps/api/local_server.py --cad-dir). It holds
`projects.sqlite3`, the project records with their saved state, and `originals/`, where an
uploaded drawing is stored once under its SHA-256 (`originals/ab/<sha256>`) however many
projects share it. Nothing here parses a drawing, and no name a client sends becomes a path.

Crash-safe writes: an upload streams to a temporary file beside the originals, hashed as it
goes and refused as soon as it passes the size cap; it is flushed and fsynced, moved into
place with os.replace, and only then is its project row committed. An original is deleted
once no project references it. Opening the store removes what an interrupted write left
behind: temporary files, and originals no project references.

The schema is versioned with PRAGMA user_version (MIGRATIONS). All access is serialised by
one lock. ponytail: one server per CAD folder and a global lock suit one local service; use
a server database before many concurrent writers.
"""

from __future__ import annotations

import hashlib
import os
import re
import secrets
import sqlite3
import threading
from contextlib import contextmanager, suppress
from dataclasses import dataclass
from pathlib import Path
from typing import Any, BinaryIO, Iterator

from ..core.errors import ServiceError

# One entry per schema version, applied in order. Append a new entry; never edit one.
MIGRATIONS: list[tuple[str, ...]] = [
    (
        """CREATE TABLE projects (
          id TEXT PRIMARY KEY,
          name TEXT NOT NULL,
          created_at TEXT NOT NULL,
          modified_at TEXT NOT NULL,
          last_opened_at TEXT NOT NULL,
          revision INTEGER NOT NULL,
          source_kind TEXT NOT NULL CHECK (source_kind IN ('upload', 'sample')),
          original_name TEXT,
          original_extension TEXT,
          original_size INTEGER,
          original_sha256 TEXT CHECK (source_kind = 'sample' OR original_sha256 IS NOT NULL),
          sample_id TEXT,
          scene_revision INTEGER,
          config_revision INTEGER,
          open_findings INTEGER,
          state TEXT NOT NULL
        )""",
        "CREATE INDEX projects_original ON projects(original_sha256)",
    ),
]
SUMMARY = """id, name, created_at, modified_at, last_opened_at, revision, source_kind, original_name,
  original_extension, original_size, original_sha256, sample_id, scene_revision, config_revision, open_findings"""
CHUNK = 1 << 20
HEAD = 1024  # the first bytes, kept for the caller's signature check
TEMP = ".tmp"
SHA256 = re.compile(r"[0-9a-f]{64}")


@dataclass(frozen=True)
class Staged:
    """An upload streamed to a temporary file; stored only once a project row takes it."""

    path: Path
    sha256: str
    size: int
    head: bytes


def _remove(path: Path) -> None:
    # Already gone, or still open for a download (Windows): the next startup sweep removes it.
    with suppress(OSError):
        path.unlink()


def _sync_dir(path: Path) -> None:
    """Make a rename in this directory durable (POSIX; Windows cannot open a directory)."""
    if os.name == "posix":
        fd = os.open(path, os.O_RDONLY)
        try:
            os.fsync(fd)
        finally:
            os.close(fd)


def _insert(db: sqlite3.Connection, row: dict[str, Any]) -> None:
    db.execute(f"INSERT INTO projects ({', '.join(row)}) VALUES ({', '.join('?' for _ in row)})", tuple(row.values()))


class CadStore:
    def __init__(self, root: str | Path):
        self.root = Path(root)
        self.originals = self.root / "originals"
        self.originals.mkdir(parents=True, exist_ok=True)
        self.lock = threading.RLock()
        self.db = sqlite3.connect(self.root / "projects.sqlite3", check_same_thread=False, isolation_level=None)
        self.db.row_factory = sqlite3.Row
        self.db.execute("PRAGMA secure_delete = ON")
        try:
            self._migrate()
            self._sweep()
        except BaseException:
            self.db.close()
            raise

    def close(self) -> None:
        with self.lock:
            self.db.close()

    @contextmanager
    def tx(self) -> Iterator[sqlite3.Connection]:
        """One write transaction, holding both this process's lock and SQLite's write lock."""
        with self.lock:
            self.db.execute("BEGIN IMMEDIATE")
            try:
                yield self.db
                self.db.execute("COMMIT")
            except BaseException:
                if self.db.in_transaction:
                    self.db.execute("ROLLBACK")
                raise

    def _migrate(self) -> None:
        with self.tx() as db:  # inside the write lock, so two servers starting at once migrate once
            version = db.execute("PRAGMA user_version").fetchone()[0]
            if version > len(MIGRATIONS):
                raise RuntimeError(f"The CAD project database has schema version {version}; this build reads up to {len(MIGRATIONS)}.")
            for number in range(version, len(MIGRATIONS)):
                for statement in MIGRATIONS[number]:
                    db.execute(statement)
                db.execute(f"PRAGMA user_version = {number + 1}")

    def _sweep(self) -> None:
        """Remove temporary uploads and unreferenced originals that interrupted writes left."""
        with self.tx() as db:  # inside the write lock, so no write is placing a file meanwhile
            referenced = {r[0] for r in db.execute("SELECT DISTINCT original_sha256 FROM projects WHERE original_sha256 IS NOT NULL")}
            for path in self.originals.glob(f"*{TEMP}"):
                _remove(path)
            for path in self.originals.glob("??/*"):
                if SHA256.fullmatch(path.name) and path.name not in referenced:
                    _remove(path)

    def _all(self, sql: str, params: tuple[Any, ...] = ()) -> list[dict[str, Any]]:
        with self.lock:
            return [dict(r) for r in self.db.execute(sql, params)]

    # --- Original files ----------------------------------------------------------------

    def original_path(self, sha256: str) -> Path:
        return self.originals / sha256[:2] / sha256

    def has_original(self, sha256: str) -> bool:
        return self.original_path(sha256).is_file()

    def open_original(self, sha256: str) -> BinaryIO | None:
        try:
            return open(self.original_path(sha256), "rb")
        except FileNotFoundError:
            return None

    def stage(self, stream: Any, limit: int) -> Staged:
        """Stream an upload to a temporary file beside the originals, hashing it, and refuse it
        as soon as it passes `limit` bytes. On any failure nothing is left behind."""
        path = self.originals / f"upload-{secrets.token_hex(8)}{TEMP}"
        digest, size, head = hashlib.sha256(), 0, b""
        try:
            with open(path, "xb") as f:
                while chunk := stream.read(CHUNK):
                    size += len(chunk)
                    if size > limit:
                        raise ServiceError("TOO_LARGE", f"The drawing is larger than {limit // (1024 * 1024)} MB.")
                    digest.update(chunk)
                    if len(head) < HEAD:
                        head += chunk[: HEAD - len(head)]
                    f.write(chunk)
                f.flush()
                os.fsync(f.fileno())
        except BaseException:
            _remove(path)
            raise
        return Staged(path, digest.hexdigest(), size, head)

    def discard(self, staged: Staged) -> None:
        """Remove a staged upload's temporary file (nothing to do once a project took it)."""
        _remove(staged.path)

    def _place(self, staged: Staged) -> None:
        target = self.original_path(staged.sha256)
        if target.is_file() and target.stat().st_size == staged.size:
            return  # the same bytes are stored already (and Windows cannot replace a file being read)
        target.parent.mkdir(exist_ok=True)
        os.replace(staged.path, target)
        _sync_dir(target.parent)
        _sync_dir(self.originals)

    def _drop_unreferenced(self, sha256: str) -> None:
        with self.tx() as db:  # inside the write lock, so no write can be taking this file meanwhile
            if not db.execute("SELECT 1 FROM projects WHERE original_sha256 = ? LIMIT 1", (sha256,)).fetchone():
                _remove(self.original_path(sha256))

    # --- Projects ----------------------------------------------------------------------

    def insert(self, row: dict[str, Any], staged: Staged | None = None) -> None:
        """Add a project. With `staged`, its upload moves into place first and the row is
        committed after it; if the row fails, the file goes again unless another project
        references it. The caller discards `staged` afterwards either way."""
        try:
            with self.tx() as db:
                if staged:
                    self._place(staged)
                _insert(db, row)
        except BaseException:
            if staged:
                with suppress(sqlite3.Error, OSError):  # never hide the original failure
                    self._drop_unreferenced(staged.sha256)
            raise

    def get(self, project_id: str) -> dict[str, Any] | None:
        rows = self._all(f"SELECT {SUMMARY}, state FROM projects WHERE id = ?", (project_id,))
        return rows[0] if rows else None

    def list(self) -> list[dict[str, Any]]:
        """Every project without its state, most recently opened first, then modified."""
        return self._all(f"SELECT {SUMMARY} FROM projects ORDER BY last_opened_at DESC, modified_at DESC, created_at DESC, id")

    def opened(self, project_id: str, now: str) -> dict[str, Any] | None:
        """Record that a project was opened; the project with its state, or None."""
        with self.tx() as db:
            if not db.execute("UPDATE projects SET last_opened_at = ? WHERE id = ?", (now, project_id)).rowcount:
                return None
            return dict(db.execute(f"SELECT {SUMMARY}, state FROM projects WHERE id = ?", (project_id,)).fetchone())

    def update(self, project_id: str, revision: int, fields: dict[str, Any]) -> dict[str, Any] | None:
        """Change a project and advance its revision, only if it is still at `revision`.
        The updated project (without its state), or None if it is missing or newer."""
        with self.tx() as db:
            cur = db.execute(
                f"UPDATE projects SET {', '.join(f'{k} = ?' for k in fields)}, revision = revision + 1 WHERE id = ? AND revision = ?",
                (*fields.values(), project_id, revision),
            )
            if not cur.rowcount:
                return None
            return dict(db.execute(f"SELECT {SUMMARY} FROM projects WHERE id = ?", (project_id,)).fetchone())

    def copy(self, source_id: str, fields: dict[str, Any]) -> dict[str, Any] | None:
        """A new project from an existing one: the same source, and so the same original file
        (no second copy on disk), with `fields` replacing the rest. None if the source is gone."""
        with self.tx() as db:
            source = db.execute("SELECT * FROM projects WHERE id = ?", (source_id,)).fetchone()
            if not source:
                return None
            row = {**dict(source), **fields}
            _insert(db, row)
            return row

    def delete(self, project_id: str) -> bool:
        """Remove a project, then its original once no other project references it."""
        with self.tx() as db:
            row = db.execute("SELECT original_sha256 FROM projects WHERE id = ?", (project_id,)).fetchone()
            if not row:
                return False
            db.execute("DELETE FROM projects WHERE id = ?", (project_id,))
        if row["original_sha256"]:
            self._drop_unreferenced(row["original_sha256"])
        return True
