"""The CAD project routes of the local API: every route's status codes and shapes through the
WSGI app, the request checks, 503 without a CAD folder, the other namespaces unchanged, and a
raw upload with a byte-exact download over a real server, across a restart. Temporary
folders only."""

from __future__ import annotations

import hashlib
import importlib.util
import io
import json
import os
import sys
import tempfile
import threading
import unittest
import urllib.error
import urllib.parse
import urllib.request
from pathlib import Path
from unittest import mock

REPO = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(REPO / "src"))
spec = importlib.util.spec_from_file_location("local_server", REPO / "apps/api/local_server.py")
local_server = importlib.util.module_from_spec(spec)
spec.loader.exec_module(local_server)

CAD = "/api/cad/v1"
DWG = b"AC1032" + bytes(range(256)) * 64
DXF = b"  0\r\nSECTION\r\n  2\r\nENTITIES\r\n  0\r\nENDSEC\r\n  0\r\nEOF\r\n"
LAYERS = {"cw": True, "chw": True, "valves": True, "instruments": False, "names": True}
TOPOLOGY = {"topology": {"devices": [], "links": []}}
NO_PROJECT = "cadp_0000000000000000"
OCTETS = "application/octet-stream"


def state(review=None, **workspace):
    ws = {"view": "drawing", "selection": None, "compareSplit": 50, "layers": dict(LAYERS), "colourBy": "medium", **workspace}
    return {"schemaVersion": 1, "workspace": ws, "review": review}


SAMPLE = {"name": "Plant", "sampleId": "water-cooled-plant", "sceneRevision": 1, "configRevision": 1, "state": state(), "openFindings": None}


class Api(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        root = Path(self.tmp.name)
        self.knowledge, self.memory = local_server.build(root / "data")
        self.cad = local_server.build_cad(root / "cad")
        self.app = local_server.create_app(self.knowledge, self.memory, cad=self.cad)

    def tearDown(self):
        for service in (self.knowledge, self.memory, self.cad):
            service.store.close()
        self.tmp.cleanup()

    def request(self, method, path, body=None, *, raw=None, query="", host="127.0.0.1:8765", client=True, content_type="application/json", length=None, app=None):
        data = raw if raw is not None else (json.dumps(body).encode() if body is not None else b"")
        environ = {
            "REQUEST_METHOD": method, "PATH_INFO": path, "QUERY_STRING": query, "HTTP_HOST": host,
            "CONTENT_LENGTH": str(len(data) if length is None else length), "CONTENT_TYPE": content_type, "wsgi.input": io.BytesIO(data),
        }
        if client:
            environ["HTTP_X_HVAC_CLIENT"] = "dashboard"
        seen = {}
        result = (app or self.app)(environ, lambda status, headers: seen.update(status=int(status.split()[0]), headers=dict(headers)))
        try:
            out = b"".join(result)
        finally:
            getattr(result, "close", lambda: None)()  # a download holds its file open until closed
        self.assertEqual(seen["headers"]["Cache-Control"], "no-store")
        self.assertEqual(seen["headers"]["X-Content-Type-Options"], "nosniff")
        self.assertNotIn("Access-Control-Allow-Origin", seen["headers"])
        return seen["status"], seen["headers"], out

    def call(self, method, path, body=None, **kw):
        status, headers, out = self.request(method, path, body, **kw)
        self.assertEqual(headers["Content-Type"], "application/json; charset=utf-8")
        return status, json.loads(out)

    def upload(self, data, name, **kw):
        return self.call("POST", f"{CAD}/projects/upload", raw=data, query="name=" + urllib.parse.quote(name), content_type=OCTETS, **kw)

    def test_status_and_every_project_route(self):
        limits = {"maxUploadBytes": 64 * 1024 * 1024, "maxStateBytes": 1024 * 1024, "maxNameLength": 120, "extensions": ["dwg", "dxf"]}
        self.assertEqual(self.call("GET", f"{CAD}/status"), (200, {"available": True, "schemaVersion": 1, "limits": limits}))
        status, made = self.call("POST", f"{CAD}/projects", SAMPLE)
        self.assertEqual((status, set(made), made["state"]), (201, {"project", "state"}, state()))
        pid = made["project"]["id"]
        self.assertEqual(self.call("GET", f"{CAD}/projects"), (200, {"projects": [made["project"]]}))
        status, opened = self.call("POST", f"{CAD}/projects/{pid}/open")
        self.assertEqual((status, opened["state"], opened["project"]["id"]), (200, state(), pid))
        status, saved = self.call("PUT", f"{CAD}/projects/{pid}", {"expectedRevision": 1, "state": state(review=TOPOLOGY), "openFindings": 2})
        self.assertEqual((status, list(saved), saved["project"]["revision"], saved["project"]["review"]), (200, ["project"], 2, {"openFindings": 2}))
        status, stale = self.call("PUT", f"{CAD}/projects/{pid}", {"expectedRevision": 1, "state": state(), "openFindings": None})
        self.assertEqual((status, stale["error"]["code"], stale["error"]["details"]["project"]["revision"]), (409, "CONFLICT", 2))
        status, renamed = self.call("POST", f"{CAD}/projects/{pid}/rename", {"name": "Plant B", "expectedRevision": 2})
        self.assertEqual((status, renamed["project"]["name"], renamed["project"]["revision"]), (200, "Plant B", 3))
        status, stale = self.call("POST", f"{CAD}/projects/{pid}/rename", {"name": "Plant C", "expectedRevision": 2})
        self.assertEqual((status, stale["error"]["details"]["project"]["name"]), (409, "Plant B"))
        status, duplicate = self.call("POST", f"{CAD}/projects/{pid}/copy", {"name": "Duplicate"})
        self.assertEqual((status, duplicate["state"]["review"], duplicate["project"]["revision"]), (201, TOPOLOGY, 1))
        status, save_as = self.call("POST", f"{CAD}/projects/{pid}/copy", {"name": "Save as", "state": state(view="compare"), "openFindings": None})
        self.assertEqual((status, save_as["state"], save_as["project"]["review"]), (201, state(view="compare"), None))
        self.assertEqual(len(self.call("GET", f"{CAD}/projects")[1]["projects"]), 3)
        self.assertEqual(self.call("DELETE", f"{CAD}/projects/{pid}"), (200, {"deleted": pid}))
        for method, path in [
            ("DELETE", f"{CAD}/projects/{pid}"), ("POST", f"{CAD}/projects/{pid}/open"), ("GET", f"{CAD}/projects/{pid}/original"),
            ("PUT", f"{CAD}/projects/{NO_PROJECT}"), ("POST", f"{CAD}/projects/cadp_nothex!!/open"), ("POST", f"{CAD}/projects/..%2F..%2Fetc/copy"),
            ("PUT", f"{CAD}/projects/upload"), ("GET", f"{CAD}/projects/{pid}"), ("GET", f"{CAD}/unknown"),
        ]:
            with self.subTest(method=method, path=path):
                status, err = self.call(method, path, {"name": "X", "expectedRevision": 1, "state": state()} if method in ("PUT", "POST") else None)
                self.assertEqual((status, err["error"]["code"]), (404, "NOT_FOUND"))
        status, err = self.call("PUT", f"{CAD}/projects/{duplicate['project']['id']}", {"expectedRevision": 1, "state": {**state(), "schemaVersion": 2}})
        self.assertEqual((status, err["error"]["code"]), (400, "INVALID_REQUEST"))
        self.assertIn("state.schemaVersion", err["error"]["message"])

    def test_a_raw_upload_and_its_byte_exact_download(self):
        status, made = self.upload(DWG, "Plant A (rev 2).dwg")
        self.assertEqual((status, made["project"]["name"], made["state"]["review"]), (201, "Plant A (rev 2)", None))
        original = made["project"]["source"]["original"]
        self.assertEqual(original, {"name": "Plant A (rev 2).dwg", "extension": "dwg", "sizeBytes": len(DWG), "sha256": hashlib.sha256(DWG).hexdigest(), "available": True})
        status, headers, out = self.request("GET", f"{CAD}/projects/{made['project']['id']}/original")
        self.assertEqual((status, out), (200, DWG))
        self.assertEqual((headers["Content-Type"], headers["Content-Length"]), (OCTETS, str(len(DWG))))
        self.assertEqual(headers["Content-Disposition"], "attachment; filename=\"Plant A (rev 2).dwg\"; filename*=UTF-8''Plant%20A%20%28rev%202%29.dwg")
        name = '冷水机房 "B";\\.dxf'
        status, made = self.upload(DXF, name)
        self.assertEqual(status, 201)
        _, headers, out = self.request("GET", f"{CAD}/projects/{made['project']['id']}/original")
        disposition = headers["Content-Disposition"]
        self.assertEqual(out, DXF)
        self.assertTrue(disposition.startswith('attachment; filename="____ _B___.dxf"; filename*=UTF-8\'\''), disposition)
        self.assertEqual(urllib.parse.unquote(disposition.split("filename*=UTF-8''")[1]), name)
        self.assertTrue(disposition.isascii())
        _, sample = self.call("POST", f"{CAD}/projects", SAMPLE)
        status, err = self.call("GET", f"{CAD}/projects/{sample['project']['id']}/original")
        self.assertEqual((status, err["error"]["code"]), (404, "NOT_FOUND"))

    def test_upload_checks(self):
        cases = [
            (415, "UNSUPPORTED", dict(raw=DWG, query="name=plant.dwg", content_type="application/json")),
            (413, "TOO_LARGE", dict(raw=DWG, query="name=plant.dwg", content_type=OCTETS, length=64 * 1024 * 1024 + 1)),
            (415, "UNSUPPORTED", dict(raw=DWG, query="name=plant.pdf", content_type=OCTETS)),
            (415, "UNSUPPORTED", dict(raw=b"%PDF-1.7", query="name=plant.dwg", content_type=OCTETS)),
            (400, "INVALID_REQUEST", dict(raw=b"", query="name=plant.dwg", content_type=OCTETS)),
            (400, "INVALID_REQUEST", dict(raw=DWG, query="", content_type=OCTETS)),
            (400, "INVALID_REQUEST", dict(raw=DWG[:100], query="name=plant.dwg", content_type=OCTETS, length=len(DWG))),  # the body ended early
            (400, "INVALID_REQUEST", dict(raw=DWG, query="name=plant.dwg", content_type=OCTETS, length="lots")),
        ]
        for status, code, kw in cases:
            with self.subTest(code=code, query=kw["query"], length=kw.get("length")):
                got, body = self.call("POST", f"{CAD}/projects/upload", **kw)
                self.assertEqual((got, body["error"]["code"]), (status, code))
        self.assertEqual(self.call("GET", f"{CAD}/projects")[1]["projects"], [])
        self.assertEqual([p for p in (Path(self.tmp.name) / "cad" / "originals").rglob("*") if p.is_file()], [])

    def test_the_request_checks_apply_to_cad_routes(self):
        self.assertEqual(self.call("GET", f"{CAD}/status", host="attacker.example")[0], 403)
        self.assertEqual(self.call("GET", f"{CAD}/projects", host="evil.example:8765")[0], 403)
        self.assertEqual(self.call("GET", f"{CAD}/projects", host="localhost:5173", client=False)[0], 200)
        for method, path, kw in [
            ("POST", f"{CAD}/projects", {"body": SAMPLE}), ("PUT", f"{CAD}/projects/{NO_PROJECT}", {"body": {}}),
            ("DELETE", f"{CAD}/projects/{NO_PROJECT}", {}), ("POST", f"{CAD}/projects/{NO_PROJECT}/open", {}),
            ("POST", f"{CAD}/projects/{NO_PROJECT}/rename", {"body": {}}), ("POST", f"{CAD}/projects/{NO_PROJECT}/copy", {"body": {}}),
            ("POST", f"{CAD}/projects/upload", {"raw": DWG, "query": "name=a.dwg", "content_type": OCTETS}),
        ]:
            with self.subTest(method=method, path=path):
                status, body = self.call(method, path, client=False, **kw)
                self.assertEqual((status, body["error"]["code"]), (403, "PERMISSION_DENIED"))
        self.assertEqual(self.call("GET", f"{CAD}/projects")[1]["projects"], [])
        self.assertEqual(self.call("POST", f"{CAD}/projects", raw=b"x" * (local_server.MAX_CAD_BODY + 1))[0], 413)
        self.assertEqual(self.call("POST", f"{CAD}/projects", SAMPLE, content_type="text/plain")[0], 415)
        self.assertEqual(self.call("POST", f"{CAD}/projects", raw=b"{nope")[0], 400)
        # A state near its 1 MB cap fits the CAD request limit, far past the other routes' 64 KB.
        near = {**SAMPLE, "state": state(review={"topology": {"blob": "a" * (1000 * 1024)}}), "openFindings": 0}
        self.assertEqual(self.call("POST", f"{CAD}/projects", near)[0], 201)
        over = {**SAMPLE, "state": state(review={"topology": {"blob": "a" * (1024 * 1024)}}), "openFindings": 0}
        status, body = self.call("POST", f"{CAD}/projects", over)
        self.assertEqual((status, body["error"]["code"]), (400, "INVALID_REQUEST"))

    def test_cad_routes_answer_503_without_a_cad_folder(self):
        app = local_server.create_app(self.knowledge, self.memory)
        for method, path, kw in [
            ("GET", f"{CAD}/status", {}), ("GET", f"{CAD}/projects", {}), ("POST", f"{CAD}/projects", {"body": SAMPLE}),
            ("POST", f"{CAD}/projects/upload", {"raw": DWG, "query": "name=a.dwg", "content_type": OCTETS}),
            ("POST", f"{CAD}/projects/{NO_PROJECT}/open", {}), ("PUT", f"{CAD}/projects/{NO_PROJECT}", {"body": {}}),
            ("DELETE", f"{CAD}/projects/{NO_PROJECT}", {}), ("GET", f"{CAD}/projects/{NO_PROJECT}/original", {}),
        ]:
            with self.subTest(method=method, path=path):
                status, body = self.call(method, path, app=app, **kw)
                self.assertEqual((status, body["error"]["code"], body["error"]["retryable"]), (503, "UNAVAILABLE", False))
                self.assertIn("CAD projects are not available", body["error"]["message"])
        self.assertEqual(self.call("GET", "/api/knowledge/v1/status", app=app)[0], 200)

    def test_the_knowledge_and_memory_routes_still_work(self):
        self.assertEqual(self.call("GET", "/api/knowledge/v1/status")[0], 200)
        self.assertEqual(self.call("GET", "/api/knowledge/v1/documents")[0], 200)
        status, created = self.call("POST", "/api/memory/v1/memories", {"kind": "event", "title": "Chiller 2 trip", "occurredAt": "2026-10-01T06:00:00Z"})
        self.assertEqual(status, 201)
        self.assertEqual(self.call("GET", f"/api/memory/v1/memories/{created['memory']['id']}")[0], 200)
        self.assertEqual(self.call("POST", "/api/memory/v1/memories", raw=b"x" * (local_server.MAX_BODY + 1))[0], 413)  # their limit is unchanged
        self.assertEqual(self.call("POST", "/api/knowledge/v1/documents", raw=b"{}", length=local_server.MAX_UPLOAD_BODY + 1)[0], 413)

    def test_the_default_cad_folder_is_per_user_and_outside_the_repository(self):
        with tempfile.TemporaryDirectory() as home, mock.patch.dict(os.environ, {"LOCALAPPDATA": home, "XDG_DATA_HOME": home}):
            expected = Path(home) / ("HVAC Agent" if os.name == "nt" else "hvac-agent") / "cad-projects"
            self.assertEqual(local_server.default_cad_dir(), expected)
        self.assertNotIn(REPO, local_server.default_cad_dir().parents)


class RealServer(unittest.TestCase):
    """A real threaded server on a free port: a raw upload comes back byte for byte with the
    download headers, and again after the server restarts."""

    def start(self, root: Path):
        knowledge, memory = local_server.build(root / "data")
        cad = local_server.build_cad(root / "cad")
        app = local_server.create_app(knowledge, memory, cad=cad)
        server = local_server.make_server("127.0.0.1", 0, app, server_class=local_server._Server, handler_class=local_server._Quiet)
        threading.Thread(target=server.serve_forever, daemon=True).start()
        return server, (knowledge, memory, cad)

    def stop(self, server, services):
        server.shutdown()
        server.server_close()  # waits for the request threads, which close the files they sent
        for service in services:
            service.store.close()

    def request(self, port, method, path, data=None, content_type="application/json"):
        req = urllib.request.Request(f"http://127.0.0.1:{port}{path}", method=method, data=data, headers={"Content-Type": content_type, "X-HVAC-Client": "test"})
        try:
            with urllib.request.urlopen(req, timeout=30) as r:
                return r.status, r.headers, r.read()
        except urllib.error.HTTPError as e:
            with e:
                return e.code, e.headers, e.read()

    def download(self, port, project_id, data):
        status, headers, out = self.request(port, "GET", f"{CAD}/projects/{project_id}/original")
        self.assertEqual(status, 200)
        self.assertEqual(hashlib.sha256(out).hexdigest(), hashlib.sha256(data).hexdigest())
        self.assertEqual(headers["Content-Type"], OCTETS)
        self.assertEqual(headers["Content-Length"], str(len(data)))
        self.assertEqual(headers["Content-Disposition"], "attachment; filename=\"Site plan.dwg\"; filename*=UTF-8''Site%20plan.dwg")
        self.assertEqual((headers["X-Content-Type-Options"], headers["Cache-Control"]), ("nosniff", "no-store"))

    def test_a_raw_upload_downloads_byte_for_byte_and_survives_a_restart(self):
        data = b"AC1027" + os.urandom(3 * 1024 * 1024 + 123)  # several chunks each way
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            server, services = self.start(root)
            try:
                port = server.server_port
                status, _, body = self.request(port, "POST", f"{CAD}/projects/upload?name={urllib.parse.quote('Site plan.dwg')}", data, OCTETS)
                self.assertEqual(status, 201, body)
                project = json.loads(body)["project"]
                self.assertEqual(project["source"]["original"]["sha256"], hashlib.sha256(data).hexdigest())
                self.download(port, project["id"], data)
            finally:
                self.stop(server, services)

            server, services = self.start(root)
            try:
                port = server.server_port
                status, _, body = self.request(port, "GET", f"{CAD}/projects")
                self.assertEqual([p["id"] for p in json.loads(body)["projects"]], [project["id"]])
                self.download(port, project["id"], data)
            finally:
                self.stop(server, services)


if __name__ == "__main__":
    unittest.main()
