"""CAD projects: the service's validation and operations, and the store's original files,
crash safety, startup sweep, restart and schema version. Temporary folders only."""

from __future__ import annotations

import hashlib
import io
import os
import sqlite3
import sys
import tempfile
import threading
import unittest
from pathlib import Path
from unittest import mock

REPO = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(REPO / "src"))

from hvac_agent.cad import projects  # noqa: E402
from hvac_agent.cad.projects import CadProjectService  # noqa: E402
from hvac_agent.core.errors import ServiceError  # noqa: E402
from hvac_agent.integrations import cad_store  # noqa: E402
from hvac_agent.integrations.cad_store import CadStore  # noqa: E402

DWG = b"AC1032" + bytes(range(256)) * 8
DXF_TEXT = b"\xef\xbb\xbf\r\n  0\r\nSECTION\r\n  2\r\nHEADER\r\n  0\r\nENDSEC\r\n  0\r\nEOF\r\n"
DXF_BINARY = b"AutoCAD Binary DXF\r\n\x1a\x00" + bytes(64)
LAYERS = {"cw": True, "chw": True, "valves": False, "instruments": True, "names": True}
TOPOLOGY = {"topology": {"devices": [{"id": "chiller_1"}], "links": [], "created": []}}
NO_PROJECT = "cadp_0000000000000000"


def state(review=None, **workspace):
    ws = {"view": "model", "selection": {"kind": "device", "id": "chiller_1"}, "compareSplit": 50, "layers": dict(LAYERS), "colourBy": "medium", **workspace}
    return {"schemaVersion": 1, "workspace": ws, "review": review}


def camera(**changes):
    return {"target": [0.0, 1.5, -2], "azimuth": 45, "polar": 35, "zoom": 1, **changes}


def without(key):
    s = state()
    del s["workspace"][key]
    return s


class Clock:
    """One second later on every call, so the orderings are deterministic."""

    def __init__(self):
        self.t = 0

    def __call__(self):
        self.t += 1
        return f"2026-11-13T09:{self.t // 60:02d}:{self.t % 60:02d}Z"


class Endless:
    """A client that never stops sending."""

    def __init__(self):
        self.sent = 0

    def read(self, size=-1):
        n = 4096 if size < 0 else min(size, 4096)
        self.sent += n
        return b"A" * n


class Dropped:
    """A client whose connection drops after a few reads."""

    def __init__(self, data, reads=2):
        self.stream, self.reads = io.BytesIO(data), reads

    def read(self, size=-1):
        if not self.reads:
            raise ConnectionResetError("the client went away")
        self.reads -= 1
        return self.stream.read(1024)


class Case(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.root = Path(self.tmp.name) / "cad"
        self.clock = Clock()
        self.start()

    def start(self):
        self.store = CadStore(self.root)
        self.cad = CadProjectService(self.store, clock=self.clock)

    def restart(self):
        self.store.close()
        self.start()

    def tearDown(self):
        self.store.close()
        self.tmp.cleanup()

    def sample(self, name="Water-cooled plant", st=None, findings=None, **extra):
        body = {"name": name, "sampleId": "water-cooled-plant", "sceneRevision": 4, "configRevision": 2, "state": st or state(), "openFindings": findings}
        return self.cad.create({**body, **extra})

    def upload(self, data=DWG, name="Plant A.dwg"):
        return self.cad.upload(name, io.BytesIO(data))

    def refused(self, code, call, says=""):
        with self.assertRaises(ServiceError) as caught:
            call()
        self.assertEqual(caught.exception.code, code, caught.exception.message)
        self.assertIn(says, caught.exception.message)
        return caught.exception

    def files(self):
        """Every file under originals/, relative to it."""
        base = self.root / "originals"
        return sorted(p.relative_to(base).as_posix() for p in base.rglob("*") if p.is_file())

    def ids(self):
        return [p["id"] for p in self.cad.list()["projects"]]

    def summary(self, project_id):
        return next(p for p in self.cad.list()["projects"] if p["id"] == project_id)


class Create(Case):
    def test_a_project_from_the_sample(self):
        made = self.sample(name="  Water-cooled plant  ")
        project = made["project"]
        self.assertRegex(project["id"], r"^cadp_[0-9a-f]{16}$")
        self.assertEqual((project["name"], project["revision"], project["review"]), ("Water-cooled plant", 1, None))
        self.assertEqual(project["source"], {"kind": "sample", "sampleId": "water-cooled-plant", "sceneRevision": 4, "configRevision": 2})
        self.assertEqual({project["createdAt"], project["modifiedAt"], project["lastOpenedAt"]}, {"2026-11-13T09:00:01Z"})
        self.assertEqual(made["state"], state())
        self.assertEqual(self.cad.list(), {"projects": [project]})
        reviewed = self.sample(st=state(review=TOPOLOGY), findings=3)
        self.assertEqual(reviewed["project"]["review"], {"openFindings": 3})
        self.assertEqual(self.cad.open(reviewed["project"]["id"])["state"]["review"], TOPOLOGY)
        self.assertEqual(self.files(), [])  # a sample has no original

    def test_names_and_sample_fields_are_checked(self):
        for name, says in [
            ("", "name is required"), ("   ", "name is required"), (None, "name is required"), (7, "name must be text"),
            ("x" * 121, "longer than 120"), ("a\x00b", "control character"), ("tab\there", "control character"),
            ("bell\x07", "control character"), ("\ud800", "invalid text"),
        ]:
            with self.subTest(name=name):
                self.refused("INVALID_REQUEST", lambda: self.sample(name=name), says)
        self.assertEqual(self.sample(name="x" * 120)["project"]["name"], "x" * 120)
        # Stored trimmed and returned as given: no escaping, the dashboard renders text.
        self.assertEqual(self.sample(name=' <b>冷水机房</b> & "x" ')["project"]["name"], '<b>冷水机房</b> & "x"')
        for extra, says in [
            ({"sampleId": "air-cooled"}, "sampleId"), ({"sampleId": None}, "sampleId"), ({"sceneRevision": -1}, "sceneRevision"),
            ({"sceneRevision": "4"}, "sceneRevision"), ({"sceneRevision": 2**53}, "sceneRevision"),
            ({"configRevision": 1.5}, "configRevision"), ({"configRevision": True}, "configRevision"), ({"configRevision": None}, "configRevision"),
        ]:
            with self.subTest(extra=extra):
                self.refused("INVALID_REQUEST", lambda: self.sample(**extra), says)
        self.refused("INVALID_REQUEST", lambda: self.cad.create(["not", "an", "object"]), "JSON object")
        self.assertEqual(len(self.ids()), 2)


class Upload(Case):
    def test_drawings_are_kept_byte_for_byte_by_their_signature(self):
        cases = [
            ("Plant A.dwg", DWG, "dwg"), ("OLD.DWG", b"AC1015" + bytes(100), "dwg"), ("plan.dxf", DXF_TEXT, "dxf"),
            ("PLAN B.DXF", DXF_BINARY, "dxf"), ("unix.dxf", b"0\nSECTION\n2\nENTITIES\n", "dxf"),
        ]
        for name, data, extension in cases:
            with self.subTest(name=name):
                made = self.cad.upload(name, io.BytesIO(data))
                sha = hashlib.sha256(data).hexdigest()
                original = {"name": name, "extension": extension, "sizeBytes": len(data), "sha256": sha, "available": True}
                self.assertEqual(made["project"]["source"], {"kind": "upload", "original": original})
                self.assertEqual((made["project"]["name"], made["project"]["review"]), (name.rpartition(".")[0], None))
                self.assertIsNone(made["state"]["review"])
                self.assertEqual((self.root / "originals" / sha[:2] / sha).read_bytes(), data)
                f, file_name = self.cad.original(made["project"]["id"])
                with f:
                    self.assertEqual((f.read(), file_name), (data, name))
                # The default state is itself a valid state.
                self.assertEqual(self.cad.save(made["project"]["id"], {"expectedRevision": 1, "state": made["state"]})["project"]["revision"], 2)
        self.assertEqual(len(self.files()), len(cases))
        long = self.upload(name="x" * 200 + ".dwg")["project"]
        self.assertEqual((long["name"], long["source"]["original"]["name"]), ("x" * 120, "x" * 200 + ".dwg"))

    def test_refused_uploads_leave_nothing_behind(self):
        cases = [
            ("UNSUPPORTED", "notes.pdf", DWG, "Only DWG and DXF"), ("UNSUPPORTED", "drawing", DWG, "Only DWG and DXF"),
            ("UNSUPPORTED", "drawing.dwg.zip", DWG, "Only DWG and DXF"), ("UNSUPPORTED", "fake.dwg", b"%PDF-1.7\n" + bytes(100), "DWG drawing"),
            ("UNSUPPORTED", "short.dwg", b"AC10", "DWG drawing"), ("UNSUPPORTED", "letters.dwg", b"AC10AB" + bytes(10), "DWG drawing"),
            ("UNSUPPORTED", "text.dwg", DXF_TEXT, "DWG drawing"), ("UNSUPPORTED", "fake.dxf", b"0\nHEADER\n", "DXF drawing"),
            ("UNSUPPORTED", "binary.dxf", DWG, "DXF drawing"), ("UNSUPPORTED", "lower.dxf", b"0\nsection\n", "DXF drawing"),
            ("INVALID_REQUEST", "empty.dwg", b"", "empty"), ("INVALID_REQUEST", None, DWG, "name is required"),
            ("INVALID_REQUEST", ".dwg", DWG, "file name such as"), ("INVALID_REQUEST", "x" * 252 + ".dwg", DWG, "longer than 255"),
            ("INVALID_REQUEST", "line\nbreak.dwg", DWG, "control character"),
        ]
        for code, name, data, says in cases:
            with self.subTest(name=name):
                self.refused(code, lambda: self.cad.upload(name, io.BytesIO(data)), says)
        self.assertEqual((self.ids(), self.files()), ([], []))

    def test_the_size_cap_is_enforced_while_streaming(self):
        with mock.patch.object(projects, "MAX_UPLOAD_BYTES", 10_000):
            client = Endless()
            self.refused("TOO_LARGE", lambda: self.cad.upload("huge.dwg", client), "larger than")
            self.assertLessEqual(client.sent, 10_000 + 4096)  # it stopped reading once past the cap
            exact = b"AC1032" + bytes(10_000 - 6)
            self.assertEqual(self.upload(exact, "exact.dwg")["project"]["source"]["original"]["sizeBytes"], 10_000)
            self.refused("TOO_LARGE", lambda: self.upload(exact + b"x", "over.dwg"))
        self.assertEqual((len(self.ids()), len(self.files())), (1, 1))


class Operations(Case):
    def test_opening_records_the_time_and_orders_the_library(self):
        a, b, c = (self.sample(name=n)["project"] for n in "ABC")
        self.assertEqual(self.ids(), [c["id"], b["id"], a["id"]])
        opened = self.cad.open(a["id"])
        self.assertGreater(opened["project"]["lastOpenedAt"], c["lastOpenedAt"])
        self.assertEqual((opened["project"]["modifiedAt"], opened["project"]["revision"]), (a["modifiedAt"], 1))
        self.assertEqual(opened["state"], state())
        self.assertEqual(self.ids(), [a["id"], c["id"], b["id"]])
        for missing in (NO_PROJECT, "cadp_123", "../" + a["id"], a["id"].upper(), a["id"] + "\n", "", None):
            with self.subTest(missing=missing):
                self.refused("NOT_FOUND", lambda: self.cad.open(missing))

    def test_saving_advances_the_revision_and_a_stale_save_is_refused(self):
        project = self.sample()["project"]
        reviewed = state(review=TOPOLOGY, view="compare", compareSplit=30)
        saved = self.cad.save(project["id"], {"expectedRevision": 1, "state": reviewed, "openFindings": 2})["project"]
        self.assertEqual((saved["revision"], saved["review"], saved["createdAt"]), (2, {"openFindings": 2}, project["createdAt"]))
        self.assertGreater(saved["modifiedAt"], project["modifiedAt"])
        self.assertEqual(self.cad.open(project["id"])["state"], reviewed)
        conflict = self.refused("CONFLICT", lambda: self.cad.save(project["id"], {"expectedRevision": 1, "state": state()}), "revision 2")
        self.assertEqual(conflict.details, {"project": self.summary(project["id"])})
        self.assertEqual(conflict.details["project"]["revision"], 2)
        self.assertEqual(self.cad.open(project["id"])["state"], reviewed)  # the stale save changed nothing
        self.refused("NOT_FOUND", lambda: self.cad.save(NO_PROJECT, {"expectedRevision": 1, "state": state()}))
        self.refused("INVALID_REQUEST", lambda: self.cad.save(project["id"], {"state": state()}), "expectedRevision")
        self.refused("INVALID_REQUEST", lambda: self.cad.save(project["id"], {"expectedRevision": 0, "state": state()}), "expectedRevision")

    def test_rename_and_a_stale_rename(self):
        project = self.sample()["project"]
        renamed = self.cad.rename(project["id"], {"name": "  Plant B  ", "expectedRevision": 1})["project"]
        self.assertEqual((renamed["name"], renamed["revision"]), ("Plant B", 2))
        self.assertGreater(renamed["modifiedAt"], project["modifiedAt"])
        conflict = self.refused("CONFLICT", lambda: self.cad.rename(project["id"], {"name": "Plant C", "expectedRevision": 1}))
        self.assertEqual(conflict.details["project"]["name"], "Plant B")
        self.refused("INVALID_REQUEST", lambda: self.cad.rename(project["id"], {"name": "x" * 121, "expectedRevision": 2}), "name")
        self.refused("NOT_FOUND", lambda: self.cad.rename(NO_PROJECT, {"name": "X", "expectedRevision": 1}))
        self.assertEqual(self.cad.open(project["id"])["project"]["name"], "Plant B")

    def test_save_as_and_duplicate_share_one_original(self):
        source = self.upload()["project"]
        reviewed = state(review=TOPOLOGY)
        self.cad.save(source["id"], {"expectedRevision": 1, "state": reviewed, "openFindings": 1})
        duplicate = self.cad.copy(source["id"], {"name": "Plant A (copy)"})
        self.assertEqual((duplicate["state"], duplicate["project"]["review"]), (reviewed, {"openFindings": 1}))
        unsaved = state(view="drawing", selection={"kind": "port", "deviceId": "chiller_1", "port": "chw_out"})
        save_as = self.cad.copy(source["id"], {"name": "Plant A rev 2", "state": unsaved, "openFindings": None})
        self.assertEqual((save_as["state"], save_as["project"]["review"]), (unsaved, None))
        for made, name in ((duplicate, "Plant A (copy)"), (save_as, "Plant A rev 2")):
            self.assertNotEqual(made["project"]["id"], source["id"])
            self.assertEqual((made["project"]["name"], made["project"]["revision"]), (name, 1))
            self.assertEqual(made["project"]["source"], source["source"])  # the same original, available
        self.assertEqual(len(self.files()), 1)
        self.assertEqual(self.cad.open(source["id"])["state"], reviewed)  # the source is untouched
        sample_copy = self.cad.copy(self.sample()["project"]["id"], {"name": "Sample copy"})["project"]
        self.assertEqual(sample_copy["source"]["kind"], "sample")
        self.refused("NOT_FOUND", lambda: self.cad.copy(NO_PROJECT, {"name": "X"}))
        self.refused("INVALID_REQUEST", lambda: self.cad.copy(source["id"], {"name": "X", "state": {"schemaVersion": 1}}), "state")
        self.refused("INVALID_REQUEST", lambda: self.cad.copy(source["id"], {"name": "X", "state": reviewed}), "openFindings")
        self.refused("INVALID_REQUEST", lambda: self.cad.copy(source["id"], {"state": unsaved}), "name")

    def test_a_shared_original_stays_until_its_last_project_is_deleted(self):
        first = self.upload()["project"]
        second = self.cad.copy(first["id"], {"name": "Copy"})["project"]
        third = self.upload(name="Again.dwg")["project"]  # the same bytes uploaded again
        self.assertEqual(third["source"]["original"]["sha256"], first["source"]["original"]["sha256"])
        self.assertEqual(len(self.files()), 1)
        self.assertEqual(self.cad.delete(first["id"]), {"deleted": first["id"]})
        self.cad.delete(third["id"])
        self.assertEqual(len(self.files()), 1)
        self.assertTrue(self.cad.open(second["id"])["project"]["source"]["original"]["available"])
        self.cad.delete(second["id"])
        self.assertEqual((self.files(), self.ids()), ([], []))
        self.refused("NOT_FOUND", lambda: self.cad.delete(second["id"]))
        self.refused("NOT_FOUND", lambda: self.cad.delete("not-an-id"))

    def test_the_original_is_byte_exact_and_a_sample_has_none(self):
        data = DWG + os.urandom(1024 * 1024 + 4321)  # more than one chunk
        made = self.upload(data)["project"]
        f, name = self.cad.original(made["id"])
        with f:
            self.assertEqual((hashlib.sha256(f.read()).hexdigest(), name), (hashlib.sha256(data).hexdigest(), "Plant A.dwg"))
        self.refused("NOT_FOUND", lambda: self.cad.original(self.sample()["project"]["id"]), "sample")
        sha = made["source"]["original"]["sha256"]
        (self.root / "originals" / sha[:2] / sha).unlink()
        self.assertFalse(self.summary(made["id"])["source"]["original"]["available"])
        self.refused("NOT_FOUND", lambda: self.cad.original(made["id"]), "missing")

    def test_concurrent_writers_from_the_threaded_server(self):
        project = self.sample()["project"]
        results = []

        def save(n):
            try:
                self.cad.save(project["id"], {"expectedRevision": 1, "state": state(compareSplit=30 + n)})
                results.append("saved")
            except ServiceError as e:
                results.append(e.code)
            self.upload(name=f"Copy {n}.dwg")  # the same bytes from every thread

        threads = [threading.Thread(target=save, args=(n,)) for n in range(8)]
        for t in threads:
            t.start()
        for t in threads:
            t.join()
        self.assertEqual(sorted(results), ["CONFLICT"] * 7 + ["saved"])  # exactly one save from revision 1 wins
        self.assertEqual((len(self.ids()), len(self.files())), (9, 1))
        self.assertTrue(all(p["source"]["kind"] == "sample" or p["source"]["original"]["available"] for p in self.cad.list()["projects"]))

    def test_status_reports_the_limits(self):
        limits = {"maxUploadBytes": 67108864, "maxStateBytes": 1048576, "maxNameLength": 120, "extensions": ["dwg", "dxf"]}
        self.assertEqual(self.cad.status(), {"available": True, "schemaVersion": 1, "limits": limits})


class StateChecks(Case):
    def test_the_saved_state_is_checked(self):
        project = self.sample()["project"]
        bad = [
            ("state must be an object", None), ("state must be an object", []),
            ("state.schemaVersion must be 1", {**state(), "schemaVersion": 2}), ("state.schemaVersion must be 1", {**state(), "schemaVersion": True}),
            ("state.schemaVersion must be 1", {**state(), "schemaVersion": "1"}), ("state.schemaVersion must be 1", {**state(), "schemaVersion": 1.0}),
            ("state has unknown keys: extra", {**state(), "extra": 1}),
            ("state.review is required", {k: v for k, v in state().items() if k != "review"}),
            ("state.workspace must be an object", {**state(), "workspace": None}),
            ("state.workspace has unknown keys: camera", state(camera={})),
            ("state.workspace.colourBy is required", without("colourBy")), ("state.workspace.selection is required", without("selection")),
            ("state.workspace.view must be one of drawing, model, compare", state(view="3d")),
            ("state.workspace.compareSplit must be between 25 and 75", state(compareSplit=24.9)),
            ("state.workspace.compareSplit must be between 25 and 75", state(compareSplit=76)),
            ("state.workspace.compareSplit must be a finite number", state(compareSplit="50")),
            ("state.workspace.compareSplit must be a finite number", state(compareSplit=True)),
            ("state.workspace.drawing.cx must be a finite number", state(drawing={"cx": float("nan"), "cy": 0, "scale": 1})),
            ("state.workspace.drawing.cy must be a finite number", state(drawing={"cx": 0, "cy": float("inf"), "scale": 1})),
            ("state.workspace.drawing.scale must be greater than 0", state(drawing={"cx": 0, "cy": 0, "scale": 0})),
            ("state.workspace.drawing.scale is required", state(drawing={"cx": 0, "cy": 0})),
            ("state.workspace.drawing must be an object", state(drawing=None)),
            ("state.workspace.model.polar must be between 0 and 80", state(model=camera(polar=81))),
            ("state.workspace.model.polar must be between 0 and 80", state(model=camera(polar=-1))),
            ("state.workspace.model.zoom must be between 0.5 and 8", state(model=camera(zoom=0.4))),
            ("state.workspace.model.zoom must be between 0.5 and 8", state(model=camera(zoom=8.5))),
            ("state.workspace.model.target must be a list of 3 numbers", state(model=camera(target=[0, 0]))),
            ("state.workspace.model.target[2] must be a finite number", state(model=camera(target=[0, 0, "1"]))),
            ("state.workspace.model.azimuth must be a finite number", state(model=camera(azimuth=10**400))),
            ("state.workspace.model has unknown keys: fov", state(model={**camera(), "fov": 30})),
            ("state.workspace.layers.names is required", state(layers={k: True for k in ("cw", "chw", "valves", "instruments")})),
            ("state.workspace.layers.cw must be true or false", state(layers={**LAYERS, "cw": 1})),
            ("state.workspace.layers has unknown keys: pipes", state(layers={**LAYERS, "pipes": True})),
            ("state.workspace.colourBy must be one of medium, review", state(colourBy="pressure")),
            ("state.workspace.selection.kind must be one of device, link, port", state(selection={"kind": "pump", "id": "p1"})),
            ("state.workspace.selection.id is required", state(selection={"kind": "device"})),
            ("state.workspace.selection.id must be text of 1 to 200", state(selection={"kind": "link", "id": ""})),
            ("state.workspace.selection.id must be text of 1 to 200", state(selection={"kind": "link", "id": "x" * 201})),
            ("state.workspace.selection.id must be text of 1 to 200", state(selection={"kind": "device", "id": 5})),
            ("state.workspace.selection.port is required", state(selection={"kind": "port", "deviceId": "chiller_1"})),
            ("state.workspace.selection.deviceId must be text", state(selection={"kind": "port", "deviceId": None, "port": "a"})),
            ("state.workspace.selection has unknown keys: port", state(selection={"kind": "device", "id": "chiller_1", "port": "chw_out"})),
            ("state.workspace.selection must be an object or null", state(selection="chiller_1")),
            ("state.review must be an object", state(review="none")),
            ("state.review.topology is required", state(review={})),
            ("state.review.topology must be an object", state(review={"topology": []})),
            ("state.review has unknown keys: findings", state(review={**TOPOLOGY, "findings": []})),
            ("state contains a number that is not finite", state(review={"topology": {"x": [float("nan")]}})),
            ("state contains text that is not valid Unicode", state(review={"topology": {"x": "\ud800"}})),
            ("state is larger than 1,024 KB", state(review={"topology": {"x": "a" * (1024 * 1024)}})),
        ]
        for says, st in bad:
            with self.subTest(says=says):
                self.refused("INVALID_REQUEST", lambda: self.cad.save(project["id"], {"expectedRevision": 1, "state": st, "openFindings": 1}), says)
        good = [
            state(compareSplit=25), state(compareSplit=75.0), state(model=camera(polar=0, zoom=0.5)),
            state(model=camera(polar=80, zoom=8, azimuth=-725.5)), state(drawing={"cx": -1e6, "cy": 2.5, "scale": 1e-6}),
            state(selection=None), state(selection={"kind": "port", "deviceId": "chiller_1", "port": "chw_out"}),
            state(selection={"kind": "link", "id": "x" * 200}), state(view="compare", colourBy="review"),
            state(review={"topology": {"x": "a" * (1000 * 1024)}}),
        ]
        for revision, st in enumerate(good, start=1):
            with self.subTest(workspace=st["workspace"]):
                findings = None if st["review"] is None else 0
                saved = self.cad.save(project["id"], {"expectedRevision": revision, "state": st, "openFindings": findings})
                self.assertEqual(saved["project"]["revision"], revision + 1)
                self.assertEqual(self.cad.open(project["id"])["state"], st)

    def test_open_findings_follow_the_review(self):
        project = self.sample()["project"]
        for body, says in [
            ({"state": state(), "openFindings": 0}, "openFindings must be null when the state has no review"),
            ({"state": state(review=TOPOLOGY)}, "openFindings is required when the state has a review"),
            ({"state": state(review=TOPOLOGY), "openFindings": -1}, "openFindings must be between 0"),
            ({"state": state(review=TOPOLOGY), "openFindings": 1.5}, "openFindings must be a whole number"),
            ({"state": state(review=TOPOLOGY), "openFindings": True}, "openFindings must be a whole number"),
        ]:
            with self.subTest(body=body):
                self.refused("INVALID_REQUEST", lambda: self.cad.save(project["id"], {"expectedRevision": 1, **body}), says)
        self.refused("INVALID_REQUEST", lambda: self.sample(st=state(review=TOPOLOGY)), "openFindings")
        self.refused("INVALID_REQUEST", lambda: self.cad.save(project["id"], ["not", "an", "object"]), "JSON object")


class Store(Case):
    def test_an_interrupted_upload_leaves_no_temporary_file_and_no_row(self):
        with self.assertRaises(ConnectionResetError):
            self.cad.upload("Plant A.dwg", Dropped(DWG * 4))
        self.assertEqual((self.files(), self.ids()), ([], []))

    def test_a_row_that_fails_after_its_file_was_placed_takes_the_file_away_again(self):
        existing = self.sample()["project"]["id"]
        staged = self.store.stage(io.BytesIO(DWG), 1 << 20)
        row = {
            "id": existing, "name": "Clash", "created_at": "t", "modified_at": "t", "last_opened_at": "t", "revision": 1,
            "source_kind": "upload", "original_name": "a.dwg", "original_extension": "dwg", "original_size": staged.size,
            "original_sha256": staged.sha256, "open_findings": None, "state": "{}",
        }
        with mock.patch.object(cad_store.os, "replace", wraps=os.replace) as replace:
            with self.assertRaises(sqlite3.IntegrityError):  # the same ID: the insert fails after the move
                self.store.insert(row, staged)
        replace.assert_called_once()
        self.store.discard(staged)
        self.assertEqual((self.files(), self.ids()), ([], [existing]))

    def test_the_startup_sweep_removes_what_interrupted_writes_left(self):
        kept = self.upload()["project"]
        sha = kept["source"]["original"]["sha256"]
        originals = self.root / "originals"
        (originals / "upload-0123456789abcdef.tmp").write_bytes(b"half an upload")
        orphan = "ab" + "0" * 62
        (originals / "ab").mkdir(exist_ok=True)
        (originals / "ab" / orphan).write_bytes(b"an original whose row never committed")
        (originals / "notes.txt").write_bytes(b"not ours: left alone")
        self.restart()
        self.assertEqual(self.files(), sorted([f"{sha[:2]}/{sha}", "notes.txt"]))
        self.assertTrue(self.summary(kept["id"])["source"]["original"]["available"])

    def test_everything_survives_a_restart(self):
        uploaded = self.upload()["project"]
        sample = self.sample(st=state(review=TOPOLOGY), findings=4)["project"]
        self.cad.rename(sample["id"], {"name": "Renamed", "expectedRevision": 1})
        saved = state(review=TOPOLOGY, colourBy="review", model=camera())
        self.cad.save(sample["id"], {"expectedRevision": 2, "state": saved, "openFindings": 0})
        before = self.cad.list()
        self.restart()
        self.assertEqual(self.cad.list(), before)
        reopened = self.cad.open(sample["id"])
        self.assertEqual((reopened["state"], reopened["project"]["name"], reopened["project"]["revision"]), (saved, "Renamed", 3))
        f, _ = self.cad.original(uploaded["id"])
        with f:
            self.assertEqual(f.read(), DWG)

    def test_the_schema_version_is_recorded_and_a_newer_database_is_refused(self):
        self.store.close()
        db = sqlite3.connect(self.root / "projects.sqlite3")
        try:
            self.assertEqual(db.execute("PRAGMA user_version").fetchone()[0], len(cad_store.MIGRATIONS))
            self.assertEqual(len(cad_store.MIGRATIONS), 1)
            db.execute("PRAGMA user_version = 99")
        finally:
            db.close()
        with self.assertRaisesRegex(RuntimeError, "schema version 99"):
            CadStore(self.root)


if __name__ == "__main__":
    unittest.main()
