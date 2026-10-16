"""Local development API for Graph RAG and Graph Memory (Python standard library only).

    python apps/api/local_server.py [--host 127.0.0.1] [--port 8765] [--data-dir var]

Serves two separate JSON contracts:

    /api/knowledge/v1   status, documents, documents/{id}, documents/{id}/reindex, search,
                        graph, graph/nodes/{id}, graph/edges/{id}, chunks/{id}
    /api/memory/v1      status, memories, memories/{id}, memories/{id}/supersede,
                        memories/{id}/links[/{linkId}], timeline, graph, graph/nodes/{id}

Each has its own SQLite file in the data directory (default: the repository's ignored
`var/`), so documents and memories never share a store. The project has not chosen an
API framework (apps/api/README.md); this is a framework-neutral WSGI composition of the
two services that the chosen framework can mount or replace.

Local only: it binds to 127.0.0.1, refuses requests for other host names (DNS
rebinding), sends no CORS headers, and accepts writes only with the X-HVAC-Client
header, which a cross-site page cannot add. There are no user accounts yet.

Optional configuration (environment): HVAC_EMBEDDINGS_BASE_URL and HVAC_EMBEDDINGS_MODEL
(an OpenAI-compatible embedding server for vector retrieval), HVAC_DATA_DIR. PDF ingestion
needs the optional pypdf package.
"""

from __future__ import annotations

import argparse
import json
import logging
import re
import sys
import threading
import traceback
from pathlib import Path
from socketserver import ThreadingMixIn
from typing import Any, Callable
from urllib.parse import parse_qs
from wsgiref.simple_server import WSGIRequestHandler, WSGIServer, make_server

REPO = Path(__file__).resolve().parents[2]
if str(REPO / "src") not in sys.path:
    sys.path.insert(0, str(REPO / "src"))

from hvac_agent.agent.memory import MemoryService  # noqa: E402
from hvac_agent.core.errors import ServiceError  # noqa: E402
from hvac_agent.integrations import embeddings, pdf_text  # noqa: E402
from hvac_agent.integrations.knowledge_store import KnowledgeStore  # noqa: E402
from hvac_agent.integrations.memory_store import MemoryStore  # noqa: E402
from hvac_agent.knowledge.service import KnowledgeService, utcnow  # noqa: E402

log = logging.getLogger("hvac.local_api")

KNOWLEDGE = "/api/knowledge/v1"
MEMORY = "/api/memory/v1"
MAX_UPLOAD_BODY = 28 * 1024 * 1024  # a 20 MB document as base64 JSON
MAX_BODY = 64 * 1024
LOCAL_HOSTS = {"127.0.0.1", "localhost", "[::1]", "::1"}

Handler = Callable[[re.Match[str], dict[str, Any], Any], tuple[int, Any]]


def routes(knowledge: KnowledgeService, memory: MemoryService, wake: Callable[[], None]) -> list[tuple[str, re.Pattern[str], Handler]]:
    def queued(result: dict[str, Any]) -> tuple[int, Any]:
        wake()
        return 202, result

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
    ]
    return [(method, re.compile(pattern + "/?"), fn) for method, pattern, fn in table]


def create_app(knowledge: KnowledgeService, memory: MemoryService, *, wake: Callable[[], None] = lambda: None):
    table = routes(knowledge, memory, wake)

    def respond(start_response: Callable[..., Any], status: int, payload: Any) -> list[bytes]:
        body = json.dumps(payload, ensure_ascii=False).encode()
        reasons = {200: "OK", 201: "Created", 202: "Accepted", 400: "Bad Request", 403: "Forbidden", 404: "Not Found", 409: "Conflict", 413: "Payload Too Large", 415: "Unsupported Media Type", 500: "Internal Server Error", 503: "Service Unavailable"}
        start_response(
            f"{status} {reasons.get(status, 'Error')}",
            [("Content-Type", "application/json; charset=utf-8"), ("Content-Length", str(len(body))), ("Cache-Control", "no-store"), ("X-Content-Type-Options", "nosniff")],
        )
        return [body]

    def app(environ: dict[str, Any], start_response: Callable[..., Any]) -> list[bytes]:
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
            body = None
            if method in ("POST", "PUT"):
                length = int(environ.get("CONTENT_LENGTH") or 0)
                limit = MAX_UPLOAD_BODY if path.rstrip("/") == f"{KNOWLEDGE}/documents" else MAX_BODY
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


class _Server(ThreadingMixIn, WSGIServer):
    daemon_threads = True
    # A page's requests arrive at once (through the dev proxy too); past socketserver's
    # default queue of 5, Windows refuses connections instead of letting them wait.
    request_queue_size = 64


class _Quiet(WSGIRequestHandler):
    def log_message(self, format: str, *args: Any) -> None:  # noqa: A002
        sys.stderr.write(f"{self.command} {self.path.split('?')[0]} {args[1] if len(args) > 1 else ''}\n")


def main(argv: list[str] | None = None) -> None:
    import os

    parser = argparse.ArgumentParser(description=__doc__.split("\n\n")[0])
    # Loopback only: LAN access needs authentication, which this build does not have.
    parser.add_argument("--host", default="127.0.0.1", choices=["127.0.0.1", "localhost", "::1"])
    parser.add_argument("--port", type=int, default=8765)
    parser.add_argument("--data-dir", type=Path, default=Path(os.environ.get("HVAC_DATA_DIR") or REPO / "var"))
    args = parser.parse_args(argv)
    logging.basicConfig(level=logging.INFO, format="%(levelname)s %(name)s: %(message)s")
    knowledge, memory = build(args.data_dir)
    worker = Worker(knowledge)
    worker.thread.start()
    worker.wake()
    app = create_app(knowledge, memory, wake=worker.wake)
    server = make_server(args.host, args.port, app, server_class=_Server, handler_class=_Quiet)
    print(f"HVAC local API on http://{args.host}:{server.server_port} (data: {args.data_dir.resolve()})", flush=True)
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        pass


if __name__ == "__main__":
    main()
