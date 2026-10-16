"""The local API: request checks, the error contract, both namespaces over HTTP, and
persistence across a restart of a real server."""

from __future__ import annotations

import base64
import importlib.util
import io
import json
import socket
import sys
import tempfile
import threading
import time
import unittest
import urllib.error
import urllib.request
from pathlib import Path

REPO = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(REPO / "src"))
spec = importlib.util.spec_from_file_location("local_server", REPO / "apps/api/local_server.py")
local_server = importlib.util.module_from_spec(spec)
spec.loader.exec_module(local_server)

DOC = b"# Chiller 2 notes\n\nCondenser tube fouling causes low COP on Chiller 2.\n"


class App(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.knowledge, self.memory = local_server.build(Path(self.tmp.name))
        self.app = local_server.create_app(self.knowledge, self.memory)

    def tearDown(self):
        self.knowledge.store.close()
        self.memory.store.close()
        self.tmp.cleanup()

    def call(self, method, path, body=None, *, host="127.0.0.1:8765", client=True, query="", content_type="application/json", raw=None):
        data = raw if raw is not None else (json.dumps(body).encode() if body is not None else b"")
        environ = {
            "REQUEST_METHOD": method, "PATH_INFO": path, "QUERY_STRING": query, "HTTP_HOST": host,
            "CONTENT_LENGTH": str(len(data)), "CONTENT_TYPE": content_type, "wsgi.input": io.BytesIO(data),
        }
        if client:
            environ["HTTP_X_HVAC_CLIENT"] = "dashboard"
        seen = {}
        out = b"".join(self.app(environ, lambda status, headers: seen.update(status=int(status.split()[0]), headers=dict(headers))))
        self.assertEqual(seen["headers"]["Content-Type"], "application/json; charset=utf-8")
        self.assertEqual(seen["headers"]["Cache-Control"], "no-store")
        self.assertNotIn("Access-Control-Allow-Origin", seen["headers"])
        return seen["status"], json.loads(out)

    def test_requests_from_other_hosts_and_writes_without_the_client_header_are_refused(self):
        self.assertEqual(self.call("GET", "/api/knowledge/v1/status", host="attacker.example")[0], 403)
        self.assertEqual(self.call("GET", "/api/memory/v1/status", host="localhost:5173")[0], 200)
        status, body = self.call("POST", "/api/memory/v1/memories", {}, client=False)
        self.assertEqual((status, body["error"]["code"]), (403, "PERMISSION_DENIED"))
        self.assertEqual(self.call("POST", "/api/knowledge/v1/search", {"query": "x"}, content_type="text/plain")[0], 415)
        self.assertEqual(self.call("POST", "/api/knowledge/v1/search", raw=b"{nope")[0], 400)
        self.assertEqual(self.call("POST", "/api/memory/v1/memories", raw=b"x" * (local_server.MAX_BODY + 1))[0], 413)
        self.assertEqual(self.call("GET", "/api/knowledge/v1/unknown")[0], 404)
        self.assertEqual(self.call("PUT", "/api/knowledge/v1/documents")[0], 404)

    def test_errors_follow_the_contract_and_leak_nothing(self):
        def boom(*a, **k):
            raise RuntimeError("secret path C:/x")

        self.knowledge.status = boom
        status, body = self.call("GET", "/api/knowledge/v1/status")
        self.assertEqual(status, 500)
        self.assertEqual(set(body["error"]), {"code", "message", "retryable"})
        self.assertNotIn("secret", json.dumps(body))
        status, body = self.call("GET", "/api/knowledge/v1/documents/doc_missing")
        self.assertEqual((status, body["error"]["code"], body["error"]["retryable"]), (404, "NOT_FOUND", False))

    def test_upload_index_search_and_delete_over_http(self):
        status, doc = self.call("POST", "/api/knowledge/v1/documents", {"name": "notes.md", "contentBase64": base64.b64encode(DOC).decode()})
        self.assertEqual((status, doc["status"]), (202, "queued"))
        status, dup = self.call("POST", "/api/knowledge/v1/documents", {"name": "again.md", "contentBase64": base64.b64encode(DOC).decode()})
        self.assertEqual((status, dup["error"]["details"]["existingDocumentId"]), (409, doc["id"]))
        while self.knowledge.process_pending():
            pass
        self.assertEqual(self.call("GET", f"/api/knowledge/v1/documents/{doc['id']}")[1]["status"], "ready")
        status, result = self.call("POST", "/api/knowledge/v1/search", {"query": "low COP"})
        self.assertEqual(result["results"][0]["documentId"], doc["id"])
        status, graph = self.call("GET", "/api/knowledge/v1/graph", query="limit=5")
        self.assertEqual(len(graph["nodes"]), 5)
        self.assertEqual(self.call("GET", "/api/knowledge/v1/graph", query="limit=999")[0], 400)
        edge = graph["edges"][0]["id"] if graph["edges"] else self.call("GET", "/api/knowledge/v1/graph")[1]["edges"][0]["id"]
        self.assertEqual(self.call("GET", f"/api/knowledge/v1/graph/edges/{edge}")[0], 200)
        status, removed = self.call("DELETE", f"/api/knowledge/v1/documents/{doc['id']}")
        self.assertEqual((status, removed["removed"]["documents"]), (200, 1))
        self.assertEqual(self.call("POST", "/api/knowledge/v1/search", {"query": "low COP"})[1]["results"], [])

    def test_memory_over_http(self):
        status, created = self.call("POST", "/api/memory/v1/memories", {"kind": "event", "title": "Chiller 2 trip", "occurredAt": "2026-10-01T06:00:00Z", "equipment": ["chiller_plant_2"]})
        self.assertEqual(status, 201)
        mid = created["memory"]["id"]
        status, sup = self.call("POST", f"/api/memory/v1/memories/{mid}/supersede", {"reason": "time was local", "occurredAt": "2026-10-01T04:00:00Z"})
        self.assertEqual((status, sup["memory"]["supersedes"]), (201, mid))
        self.assertEqual(self.call("GET", "/api/memory/v1/timeline", query="includeSuperseded=true")[1]["total"], 2)
        self.assertEqual(self.call("GET", "/api/memory/v1/graph/nodes/equipment:chiller_plant_2")[0], 200)
        self.assertEqual(self.call("DELETE", f"/api/memory/v1/memories/{sup['memory']['id']}")[1]["restored"], mid)

    def test_the_two_namespaces_use_separate_files(self):
        files = sorted(p.name for p in Path(self.tmp.name).iterdir() if p.suffix == ".sqlite3")
        self.assertEqual(files, ["knowledge.sqlite3", "memory.sqlite3"])


class RealServer(unittest.TestCase):
    """A real server on a free port: data survives stopping and starting it again."""

    def start(self, data_dir: Path):
        knowledge, memory = local_server.build(data_dir)
        worker = local_server.Worker(knowledge)
        worker.thread.start()
        app = local_server.create_app(knowledge, memory, wake=worker.wake)
        server = local_server.make_server("127.0.0.1", 0, app, server_class=local_server._Server, handler_class=local_server._Quiet)
        threading.Thread(target=server.serve_forever, daemon=True).start()
        return server, knowledge, memory

    def stop(self, server, knowledge, memory):
        server.shutdown()
        server.server_close()
        knowledge.store.close()
        memory.store.close()

    def request(self, port, method, path, body=None):
        req = urllib.request.Request(
            f"http://127.0.0.1:{port}{path}", method=method, data=json.dumps(body).encode() if body is not None else None,
            headers={"Content-Type": "application/json", "X-HVAC-Client": "test"},
        )
        try:
            with urllib.request.urlopen(req, timeout=10) as r:
                return r.status, json.loads(r.read())
        except urllib.error.HTTPError as e:
            with e:
                return e.code, json.loads(e.read())

    def test_documents_and_memories_survive_a_restart(self):
        with tempfile.TemporaryDirectory() as tmp:
            running = self.start(Path(tmp))
            port = running[0].server_port
            status, doc = self.request(port, "POST", "/api/knowledge/v1/documents", {"name": "notes.md", "contentBase64": base64.b64encode(DOC).decode()})
            self.assertEqual(status, 202)
            deadline = time.time() + 10
            while self.request(port, "GET", f"/api/knowledge/v1/documents/{doc['id']}")[1]["status"] != "ready":
                self.assertLess(time.time(), deadline, "the worker did not index the document")
                time.sleep(0.05)
            status, mem = self.request(port, "POST", "/api/memory/v1/memories", {"kind": "finding", "title": "Fouling on Chiller 2", "occurredAt": "2026-10-07T09:00:00Z"})
            self.assertEqual(status, 201)
            self.stop(*running)

            running = self.start(Path(tmp))
            port = running[0].server_port
            self.assertEqual(self.request(port, "GET", f"/api/knowledge/v1/documents/{doc['id']}")[1]["status"], "ready")
            self.assertEqual(self.request(port, "POST", "/api/knowledge/v1/search", {"query": "fouling"})[1]["results"][0]["documentId"], doc["id"])
            self.assertEqual(self.request(port, "GET", f"/api/memory/v1/memories/{mem['memory']['id']}")[1]["memory"]["title"], "Fouling on Chiller 2")
            self.stop(*running)

    def test_connections_made_all_at_once_wait_their_turn(self):
        # A page asks for several things at once (the RAG Graph: the graph, a node's
        # neighbours, a document, the library, the status), and a proxy forwards them at
        # once. They must wait for the server, not be refused, which Windows does past the
        # listen queue. All of them connect here before the server takes any.
        with tempfile.TemporaryDirectory() as tmp:
            knowledge, memory = local_server.build(Path(tmp))
            app = local_server.create_app(knowledge, memory)
            server = local_server.make_server("127.0.0.1", 0, app, server_class=local_server._Server, handler_class=local_server._Quiet)
            serving = None
            try:
                socks = [socket.create_connection(("127.0.0.1", server.server_port), timeout=5) for _ in range(24)]
                serving = threading.Thread(target=server.serve_forever, daemon=True)
                serving.start()
                for s in socks:
                    s.sendall(f"GET /api/knowledge/v1/status HTTP/1.0\r\nHost: 127.0.0.1:{server.server_port}\r\n\r\n".encode())
                for s in socks:
                    with s:
                        self.assertTrue(s.recv(64).startswith(b"HTTP/1.0 200 "))
            finally:
                if serving:
                    server.shutdown()
                server.server_close()
                knowledge.store.close()
                memory.store.close()


if __name__ == "__main__":
    unittest.main()
