"""Local development API for Graph RAG, Graph Memory and CAD projects (Python standard library only).

    python apps/api/local_server.py [--host 127.0.0.1] [--port 8765] [--data-dir var] [--cad-dir DIR]

Serves three separate contracts, all JSON except a CAD drawing's raw bytes:

    /api/knowledge/v1   status, documents, documents/{id}, documents/{id}/reindex, search,
                        graph, graph/nodes/{id}, graph/edges/{id}, chunks/{id}
    /api/memory/v1      status, memories, memories/{id}, memories/{id}/supersede,
                        memories/{id}/links[/{linkId}], timeline, graph, graph/nodes/{id}
    /api/cad/v1         status, projects, projects/upload (the drawing's raw bytes),
                        projects/{id} (PUT saves, DELETE), projects/{id}/open,
                        projects/{id}/rename, projects/{id}/copy,
                        projects/{id}/original (the drawing's exact bytes)

Knowledge and memory each have their own SQLite file in the data directory (default: the
repository's ignored `var/`), so documents and memories never share a store. CAD projects
live outside the repository in the CAD folder (--cad-dir or HVAC_CAD_DIR; by default
%LOCALAPPDATA%\\HVAC Agent\\cad-projects on Windows, otherwise
$XDG_DATA_HOME/hvac-agent/cad-projects or ~/.local/share/hvac-agent/cad-projects): their
own SQLite file and the original drawings, kept byte for byte and never parsed. The project
has not chosen an API framework (apps/api/README.md); this is a framework-neutral WSGI
composition of the services that the chosen framework can mount or replace.

Local only: it binds to 127.0.0.1, refuses requests for other host names (DNS
rebinding), sends no CORS headers, and accepts writes only with the X-HVAC-Client
header, which a cross-site page cannot add. There are no user accounts yet.

Optional configuration (environment): HVAC_EMBEDDINGS_BASE_URL and HVAC_EMBEDDINGS_MODEL
(an OpenAI-compatible embedding server for vector retrieval), HVAC_DATA_DIR, HVAC_CAD_DIR.
PDF ingestion needs the optional pypdf package.
"""

from __future__ import annotations

import argparse
import json
import logging
import os
import re
import sys
import threading
import traceback
from pathlib import Path
from socketserver import ThreadingMixIn
from typing import Any, BinaryIO, Callable, NamedTuple
from urllib.parse import parse_qs, quote
from wsgiref.simple_server import WSGIRequestHandler, WSGIServer, make_server
from wsgiref.util import FileWrapper

REPO = Path(__file__).resolve().parents[2]
if str(REPO / "src") not in sys.path:
    sys.path.insert(0, str(REPO / "src"))

from hvac_agent.agent.memory import MemoryService  # noqa: E402
from hvac_agent.cad.projects import MAX_STATE_BYTES, MAX_UPLOAD_BYTES, CadProjectService  # noqa: E402
from hvac_agent.core.errors import ServiceError  # noqa: E402
from hvac_agent.integrations import embeddings, pdf_text  # noqa: E402
from hvac_agent.integrations.cad_store import CadStore  # noqa: E402
from hvac_agent.integrations.knowledge_store import KnowledgeStore  # noqa: E402
from hvac_agent.integrations.memory_store import MemoryStore  # noqa: E402
from hvac_agent.knowledge.service import KnowledgeService, utcnow  # noqa: E402

log = logging.getLogger("hvac.local_api")

KNOWLEDGE = "/api/knowledge/v1"
MEMORY = "/api/memory/v1"
CAD = "/api/cad/v1"
MAX_UPLOAD_BODY = 28 * 1024 * 1024  # a 20 MB document as base64 JSON
MAX_BODY = 64 * 1024
MAX_CAD_BODY = MAX_STATE_BYTES + MAX_BODY  # a saved state with its request
LOCAL_HOSTS = {"127.0.0.1", "localhost", "[::1]", "::1"}

Handler = Callable[[re.Match[str], dict[str, Any], Any], tuple[int, Any]]


class Download(NamedTuple):
    """A handler's raw response: an open file, sent as an attachment named `name`."""

    file: BinaryIO
    name: str


class UploadBody:
    """A raw request body, read up to its Content-Length and no further (as WSGI requires).
    A body that ends early is refused rather than stored short."""

    def __init__(self, stream: Any, length: int):
        self.stream, self.left = stream, length

    def read(self, size: int = -1) -> bytes:
        if self.left <= 0 or size == 0:
            return b""
        data = self.stream.read(self.left if size < 0 else min(size, self.left))
        if not data:
            raise ServiceError("INVALID_REQUEST", "The upload ended before all of its bytes arrived.")
        self.left -= len(data)
        return data


def routes(knowledge: KnowledgeService, memory: MemoryService, wake: Callable[[], None], cad: CadProjectService | None = None) -> list[tuple[str, re.Pattern[str], Handler]]:
    def queued(result: dict[str, Any]) -> tuple[int, Any]:
        wake()
        return 202, result

    def projects() -> CadProjectService:
        if cad is None:
            raise ServiceError("UNAVAILABLE", "CAD projects are not available: this server has no CAD folder, or could not open it (see its log).")
        return cad

    table: list[tuple[str, str, Handler]] = [
        ("GET", rf"{KNOWLEDGE}/status", lambda m, q, b: (200, knowledge.status())),
        ("GET", rf"{KNOWLEDGE}/documents", lambda m, q, b: (200, knowledge.list_documents(q))),
        ("POST", rf"{KNOWLEDGE}/documents", lambda m, q, b: queued(knowledge.ingest(b))),
        ("GET", rf"{KNOWLEDGE}/documents/([\w-]+)", lambda m, q, b: (200, knowledge.get_document(m[1]))),
        ("DELETE", rf"{KNOWLEDGE}/documents/([\w-]+)", lambda m, q, b: (200, knowledge.delete(m[1]))),
        ("POST", rf"{KNOWLEDGE}/documents/([\w-]+)/reindex", lambda m, q, b: queued(knowledge.reindex(m[1]))),
        ("POST", rf"{KNOWLEDGE}/search", lambda m, q, b: (200, knowledge.search(b))),
        ("GET", rf"{KNOWLEDGE}/graph", lambda m, q, b: (200, knowledge.graph(q))),
        ("GET", rf"{KNOWLEDGE}/graph/nodes/([\w-]+)", lambda m, q, b: (200, knowledge.node(m[1], q))),
        ("GET", rf"{KNOWLEDGE}/graph/edges/([\w-]+)", lambda m, q, b: (200, knowledge.edge(m[1]))),
        ("GET", rf"{KNOWLEDGE}/chunks/([\w-]+)", lambda m, q, b: (200, knowledge.chunk(m[1]))),
        ("GET", rf"{MEMORY}/status", lambda m, q, b: (200, memory.status())),
        ("GET", rf"{MEMORY}/memories", lambda m, q, b: (200, memory.list(q))),
        ("POST", rf"{MEMORY}/memories", lambda m, q, b: (201, memory.create(b))),
        ("GET", rf"{MEMORY}/memories/([\w-]+)", lambda m, q, b: (200, memory.inspect(m[1]))),
        ("DELETE", rf"{MEMORY}/memories/([\w-]+)", lambda m, q, b: (200, memory.delete(m[1]))),
        ("POST", rf"{MEMORY}/memories/([\w-]+)/supersede", lambda m, q, b: (201, memory.supersede(m[1], b))),
        ("POST", rf"{MEMORY}/memories/([\w-]+)/links", lambda m, q, b: (201, memory.add_link(m[1], b))),
        ("DELETE", rf"{MEMORY}/memories/([\w-]+)/links/([\w-]+)", lambda m, q, b: (200, memory.remove_link(m[1], m[2]))),
        ("GET", rf"{MEMORY}/timeline", lambda m, q, b: (200, memory.timeline(q))),
        ("GET", rf"{MEMORY}/graph", lambda m, q, b: (200, memory.graph(q))),
        ("GET", rf"{MEMORY}/graph/nodes/([\w:.-]+)", lambda m, q, b: (200, memory.expand(m[1], q))),
        # CAD project IDs are checked by the service, so a malformed one is a missing project.
        ("GET", rf"{CAD}/status", lambda m, q, b: (200, projects().status())),
        ("GET", rf"{CAD}/projects", lambda m, q, b: (200, projects().list())),
        ("POST", rf"{CAD}/projects", lambda m, q, b: (201, projects().create(b))),
        ("POST", rf"{CAD}/projects/upload", lambda m, q, b: (201, projects().upload(q.get("name"), b))),
        ("POST", rf"{CAD}/projects/([^/]+)/open", lambda m, q, b: (200, projects().open(m[1]))),
        ("PUT", rf"{CAD}/projects/([^/]+)", lambda m, q, b: (200, projects().save(m[1], b))),
        ("POST", rf"{CAD}/projects/([^/]+)/rename", lambda m, q, b: (200, projects().rename(m[1], b))),
        ("POST", rf"{CAD}/projects/([^/]+)/copy", lambda m, q, b: (201, projects().copy(m[1], b))),
        ("DELETE", rf"{CAD}/projects/([^/]+)", lambda m, q, b: (200, projects().delete(m[1]))),
        ("GET", rf"{CAD}/projects/([^/]+)/original", lambda m, q, b: (200, Download(*projects().original(m[1])))),
    ]
    return [(method, re.compile(pattern + "/?"), fn) for method, pattern, fn in table]


def upload_body(environ: dict[str, Any]) -> UploadBody:
    """The CAD upload's raw body, which the service streams to disk under the same cap."""
    try:
        length = int(environ.get("CONTENT_LENGTH") or 0)
    except ValueError:
        raise ServiceError("INVALID_REQUEST", "Content-Length is not a number.") from None
    if length > MAX_UPLOAD_BYTES:
        raise ServiceError("TOO_LARGE", f"The drawing is larger than {MAX_UPLOAD_BYTES // (1024 * 1024)} MB.")
    if "application/octet-stream" not in environ.get("CONTENT_TYPE", ""):
        raise ServiceError("UNSUPPORTED", "Send the drawing's bytes (Content-Type: application/octet-stream).")
    return UploadBody(environ["wsgi.input"], length)


def create_app(knowledge: KnowledgeService, memory: MemoryService, *, cad: CadProjectService | None = None, wake: Callable[[], None] = lambda: None):
    """The WSGI app. Without `cad`, the CAD routes answer 503 UNAVAILABLE."""
    table = routes(knowledge, memory, wake, cad)

    def respond(start_response: Callable[..., Any], status: int, payload: Any) -> list[bytes]:
        body = json.dumps(payload, ensure_ascii=False).encode()
        reasons = {200: "OK", 201: "Created", 202: "Accepted", 400: "Bad Request", 403: "Forbidden", 404: "Not Found", 409: "Conflict", 413: "Payload Too Large", 415: "Unsupported Media Type", 500: "Internal Server Error", 503: "Service Unavailable"}
        start_response(
            f"{status} {reasons.get(status, 'Error')}",
            [("Content-Type", "application/json; charset=utf-8"), ("Content-Length", str(len(body))), ("Cache-Control", "no-store"), ("X-Content-Type-Options", "nosniff")],
        )
        return [body]

    def send(start_response: Callable[..., Any], download: Download) -> Any:
        # A quoted ASCII name for old clients, and the exact name percent-encoded (RFC 6266).
        fallback = re.sub(r"[^A-Za-z0-9 ._()-]", "_", download.name)
        start_response(
            "200 OK",
            [
                ("Content-Type", "application/octet-stream"),
                ("Content-Length", str(os.fstat(download.file.fileno()).st_size)),
                ("Content-Disposition", f"attachment; filename=\"{fallback}\"; filename*=UTF-8''{quote(download.name, safe='')}"),
                ("Cache-Control", "no-store"),
                ("X-Content-Type-Options", "nosniff"),
            ],
        )
        return FileWrapper(download.file, 64 * 1024)  # streamed; the server closes it

    def app(environ: dict[str, Any], start_response: Callable[..., Any]) -> Any:
        try:
            host = environ.get("HTTP_HOST", "")
            name = host.rsplit(":", 1)[0] if not host.startswith("[") else host.split("]")[0] + "]"
            if name.lower() not in LOCAL_HOSTS:
                raise ServiceError("PERMISSION_DENIED", "This service answers only on this machine (localhost).")
            method, path = environ["REQUEST_METHOD"], environ.get("PATH_INFO", "")
            if method != "GET" and not environ.get("HTTP_X_HVAC_CLIENT"):
                raise ServiceError("PERMISSION_DENIED", "Writes need the X-HVAC-Client header.")
            for verb, pattern, fn in table:
                m = pattern.fullmatch(path)
                if m and verb == method:
                    break
            else:
                raise ServiceError("NOT_FOUND", f"No {method} route for {path}.")
            query = {k: v[-1] for k, v in parse_qs(environ.get("QUERY_STRING", "")).items()}
            body: Any = None
            if method == "POST" and path.rstrip("/") == f"{CAD}/projects/upload":
                body = upload_body(environ)
            elif method in ("POST", "PUT"):
                length = int(environ.get("CONTENT_LENGTH") or 0)
                limit = MAX_UPLOAD_BODY if path.rstrip("/") == f"{KNOWLEDGE}/documents" else MAX_CAD_BODY if path.startswith(f"{CAD}/") else MAX_BODY
                if length > limit:
                    raise ServiceError("TOO_LARGE", f"The request is larger than {limit // 1024:,} KB.")
                if length and "application/json" not in environ.get("CONTENT_TYPE", ""):
                    raise ServiceError("UNSUPPORTED", "Send JSON (Content-Type: application/json).")
                raw = environ["wsgi.input"].read(length) if length else b""
                try:
                    body = json.loads(raw) if raw else {}
                except ValueError:
                    raise ServiceError("INVALID_REQUEST", "The request body is not valid JSON.") from None
            status, payload = fn(m, query, body)
            if isinstance(payload, Download):
                return send(start_response, payload)
            return respond(start_response, status, payload)
        except ServiceError as e:
            return respond(start_response, e.status, e.to_wire())
        except Exception:
            log.error("unhandled error\n%s", traceback.format_exc())
            return respond(start_response, 500, {"error": {"code": "UNAVAILABLE", "message": "Internal error in the local service; see its log.", "retryable": True}})

    return app


class Worker:
    """Runs queued ingestion jobs one at a time, off the request threads."""

    def __init__(self, knowledge: KnowledgeService):
        self.knowledge = knowledge
        self.event = threading.Event()
        self.thread = threading.Thread(target=self._run, name="ingestion", daemon=True)

    def wake(self) -> None:
        self.event.set()

    def _run(self) -> None:
        while True:
            self.event.wait(timeout=5)
            self.event.clear()
            try:
                while self.knowledge.process_pending():
                    pass
            except Exception:
                log.error("ingestion worker error\n%s", traceback.format_exc())


def build(data_dir: Path) -> tuple[KnowledgeService, MemoryService]:
    data_dir.mkdir(parents=True, exist_ok=True)
    kstore = KnowledgeStore(data_dir / "knowledge.sqlite3")
    knowledge = KnowledgeService(kstore, embedder=embeddings.from_env(), pdf=pdf_text)
    kstore.requeue_interrupted(utcnow())
    memory = MemoryService(MemoryStore(data_dir / "memory.sqlite3"), persistent=True)
    return knowledge, memory


def build_cad(cad_dir: Path) -> CadProjectService:
    """CAD projects in `cad_dir`, which opening creates; it sweeps leftovers of interrupted writes."""
    return CadProjectService(CadStore(cad_dir))


def default_cad_dir() -> Path:
    """The per-user CAD folder, outside the repository: customer drawings stay out of Git."""
    if os.name == "nt":
        return Path(os.environ.get("LOCALAPPDATA") or Path.home() / "AppData" / "Local") / "HVAC Agent" / "cad-projects"
    return Path(os.environ.get("XDG_DATA_HOME") or Path.home() / ".local" / "share") / "hvac-agent" / "cad-projects"


class _Server(ThreadingMixIn, WSGIServer):
    daemon_threads = True
    # A page's requests arrive at once (through the dev proxy too); past socketserver's
    # default queue of 5, Windows refuses connections instead of letting them wait.
    request_queue_size = 64


class _Quiet(WSGIRequestHandler):
    def log_message(self, format: str, *args: Any) -> None:  # noqa: A002
        sys.stderr.write(f"{self.command} {self.path.split('?')[0]} {args[1] if len(args) > 1 else ''}\n")


def main(argv: list[str] | None = None) -> None:
    parser = argparse.ArgumentParser(description=__doc__.split("\n\n")[0])
    # Loopback only: LAN access needs authentication, which this build does not have.
    parser.add_argument("--host", default="127.0.0.1", choices=["127.0.0.1", "localhost", "::1"])
    parser.add_argument("--port", type=int, default=8765)
    parser.add_argument("--data-dir", type=Path, default=Path(os.environ.get("HVAC_DATA_DIR") or REPO / "var"))
    parser.add_argument("--cad-dir", type=Path, default=Path(os.environ.get("HVAC_CAD_DIR") or default_cad_dir()))
    args = parser.parse_args(argv)
    logging.basicConfig(level=logging.INFO, format="%(levelname)s %(name)s: %(message)s")
    knowledge, memory = build(args.data_dir)
    try:
        cad: CadProjectService | None = build_cad(args.cad_dir)
    except Exception:  # knowledge and memory still serve; the CAD routes answer 503
        log.error("CAD projects are unavailable: the CAD folder %s could not be opened\n%s", args.cad_dir, traceback.format_exc())
        cad = None
    worker = Worker(knowledge)
    worker.thread.start()
    worker.wake()
    app = create_app(knowledge, memory, cad=cad, wake=worker.wake)
    server = make_server(args.host, args.port, app, server_class=_Server, handler_class=_Quiet)
    cad_note = args.cad_dir.resolve() if cad else "unavailable, see the log"
    print(f"HVAC local API on http://{args.host}:{server.server_port} (data: {args.data_dir.resolve()}; CAD: {cad_note})", flush=True)
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        pass


if __name__ == "__main__":
    main()
