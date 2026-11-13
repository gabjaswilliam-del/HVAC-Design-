"""CadProjectService: persistent CAD Studio projects, independent of HTTP.

A project is the prepared sample or an uploaded DWG/DXF drawing, plus the workspace and
review state the dashboard saves with it. The original drawing is kept byte for byte and is
never parsed or executed: an upload is checked by its extension and file signature only,
which shows that a file looks like DWG or DXF, nothing more. The server has no topology
logic: it checks the saved state's shape, types, ranges and size, and the dashboard
validates the review in full.

Every save and rename names the revision it started from, so a stale tab cannot overwrite
newer work (CONFLICT, with the current summary in the error details). Names are stored
trimmed and returned as given; the dashboard renders them as text. The store is injected
(apps/api composes it): integrations/cad_store.py.
"""

from __future__ import annotations

import json
import math
import re
import secrets
import unicodedata
from datetime import datetime, timezone
from typing import Any, BinaryIO, Callable

from ..core.errors import ServiceError

SCHEMA_VERSION = 1
MAX_UPLOAD_BYTES = 64 * 1024 * 1024
MAX_STATE_BYTES = 1024 * 1024
MAX_NAME = 120
MAX_FILE_NAME = 255
MAX_ID = 200
MAX_WHOLE = 2**53 - 1  # the largest whole number a browser reads exactly
EXTENSIONS = ("dwg", "dxf")
SAMPLE_ID = "water-cooled-plant"
VIEWS = ("drawing", "model", "compare")
LAYERS = ("cw", "chw", "valves", "instruments", "names")
COLOUR_BY = ("medium", "review")
PROJECT_ID = re.compile(r"cadp_[0-9a-f]{16}")
DWG_SIGNATURE = re.compile(rb"AC10[0-9]{2}")
DXF_BINARY = b"AutoCAD Binary DXF\r\n\x1a\x00"


def utcnow() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="seconds").replace("+00:00", "Z")


def _invalid(message: str) -> ServiceError:
    return ServiceError("INVALID_REQUEST", message)


def _body(value: Any) -> dict[str, Any]:
    if not isinstance(value, dict):
        raise _invalid("Send the request as a JSON object.")
    return value


def _name(value: Any, field: str = "name", max_len: int = MAX_NAME) -> str:
    if not isinstance(value, str):
        raise _invalid(f"{field} is required." if value is None else f"{field} must be text.")
    value = value.strip()
    if not value:
        raise _invalid(f"{field} is required.")
    if len(value) > max_len:
        raise _invalid(f"{field} is longer than {max_len} characters.")
    if any(unicodedata.category(c) in ("Cc", "Cs") for c in value):
        raise _invalid(f"{field} contains a control character or invalid text.")
    return value


def _whole(value: Any, field: str, lo: int = 0) -> int:
    if isinstance(value, bool) or not isinstance(value, int):
        raise _invalid(f"{field} must be a whole number.")
    if not lo <= value <= MAX_WHOLE:
        raise _invalid(f"{field} must be between {lo} and {MAX_WHOLE}.")
    return value


def _number(value: Any, field: str, lo: float | None = None, hi: float | None = None) -> None:
    try:
        finite = not isinstance(value, bool) and isinstance(value, (int, float)) and math.isfinite(value)
    except OverflowError:  # a whole number too large for a float, which a browser reads as Infinity
        finite = False
    if not finite:
        raise _invalid(f"{field} must be a finite number.")
    if (lo is not None and value < lo) or (hi is not None and value > hi):
        raise _invalid(f"{field} must be between {lo:g} and {hi:g}.")


def _choice(value: Any, field: str, options: tuple[str, ...]) -> None:
    if not isinstance(value, str) or value not in options:
        raise _invalid(f"{field} must be one of {', '.join(options)}.")


def _ident(value: Any, field: str) -> None:
    if not isinstance(value, str) or not value or len(value) > MAX_ID:
        raise _invalid(f"{field} must be text of 1 to {MAX_ID} characters.")


def _object(value: Any, field: str, required: set[str], optional: frozenset[str] = frozenset()) -> dict[str, Any]:
    """An object with exactly these keys (the optional ones may be left out)."""
    if not isinstance(value, dict):
        raise _invalid(f"{field} must be an object.")
    unknown = sorted(set(value) - required - optional)
    if unknown:
        raise _invalid(f"{field} has unknown keys: {', '.join(unknown[:5])}.")
    missing = sorted(required - set(value))
    if missing:
        raise _invalid(f"{field}.{missing[0]} is required.")
    return value


def _selection(value: Any) -> None:
    field = "state.workspace.selection"
    if value is None:
        return
    kind = value.get("kind") if isinstance(value, dict) else None
    if kind in ("device", "link"):
        _object(value, field, {"kind", "id"})
        _ident(value["id"], f"{field}.id")
    elif kind == "port":
        _object(value, field, {"kind", "deviceId", "port"})
        _ident(value["deviceId"], f"{field}.deviceId")
        _ident(value["port"], f"{field}.port")
    elif isinstance(value, dict):
        raise _invalid(f"{field}.kind must be one of device, link, port.")
    else:
        raise _invalid(f"{field} must be an object or null.")


def _state(value: Any) -> tuple[dict[str, Any], str]:
    """A ProjectState checked for shape, types, ranges and size, and the JSON text to store."""
    state = _object(value, "state", {"schemaVersion", "workspace", "review"})
    if type(state["schemaVersion"]) is not int or state["schemaVersion"] != SCHEMA_VERSION:
        raise _invalid(f"state.schemaVersion must be {SCHEMA_VERSION}.")
    ws = _object(state["workspace"], "state.workspace", {"view", "selection", "compareSplit", "layers", "colourBy"}, frozenset({"drawing", "model"}))
    _choice(ws["view"], "state.workspace.view", VIEWS)
    _selection(ws["selection"])
    if "drawing" in ws:
        drawing = _object(ws["drawing"], "state.workspace.drawing", {"cx", "cy", "scale"})
        _number(drawing["cx"], "state.workspace.drawing.cx")
        _number(drawing["cy"], "state.workspace.drawing.cy")
        _number(drawing["scale"], "state.workspace.drawing.scale")
        if drawing["scale"] <= 0:
            raise _invalid("state.workspace.drawing.scale must be greater than 0.")
    if "model" in ws:
        model = _object(ws["model"], "state.workspace.model", {"target", "azimuth", "polar", "zoom"})
        target = model["target"]
        if not isinstance(target, list) or len(target) != 3:
            raise _invalid("state.workspace.model.target must be a list of 3 numbers.")
        for i, n in enumerate(target):
            _number(n, f"state.workspace.model.target[{i}]")
        _number(model["azimuth"], "state.workspace.model.azimuth")
        _number(model["polar"], "state.workspace.model.polar", 0, 80)
        _number(model["zoom"], "state.workspace.model.zoom", 0.5, 8)
    _number(ws["compareSplit"], "state.workspace.compareSplit", 25, 75)
    layers = _object(ws["layers"], "state.workspace.layers", set(LAYERS))
    for layer in LAYERS:
        if type(layers[layer]) is not bool:
            raise _invalid(f"state.workspace.layers.{layer} must be true or false.")
    _choice(ws["colourBy"], "state.workspace.colourBy", COLOUR_BY)
    if state["review"] is not None:
        review = _object(state["review"], "state.review", {"topology"})
        if not isinstance(review["topology"], dict):
            raise _invalid("state.review.topology must be an object.")
    try:
        text = json.dumps(state, ensure_ascii=False, separators=(",", ":"), allow_nan=False)
    except ValueError:  # NaN or Infinity anywhere, including inside the topology
        raise _invalid("state contains a number that is not finite.") from None
    try:
        size = len(text.encode())
    except UnicodeEncodeError:
        raise _invalid("state contains text that is not valid Unicode.") from None
    if size > MAX_STATE_BYTES:
        raise _invalid(f"state is larger than {MAX_STATE_BYTES // 1024:,} KB.")
    return state, text


def _findings(body: dict[str, Any], state: dict[str, Any]) -> int | None:
    """openFindings, the dashboard's count for the library list: a count with a review, else null."""
    value = body.get("openFindings")
    if state["review"] is None:
        if value is not None:
            raise _invalid("openFindings must be null when the state has no review.")
        return None
    if value is None:
        raise _invalid("openFindings is required when the state has a review.")
    return _whole(value, "openFindings")


def _file_name(value: Any) -> tuple[str, str, str]:
    """An uploaded drawing's file name, its lower-case extension, and the project name it gives."""
    name = _name(value, "name", MAX_FILE_NAME)
    stem, dot, extension = name.rpartition(".")
    if not dot or extension.lower() not in EXTENSIONS:
        raise ServiceError("UNSUPPORTED", "Only DWG and DXF drawings (.dwg, .dxf) can be uploaded.")
    if not stem.strip():
        raise _invalid("name must be a file name such as plant.dwg.")
    return name, extension.lower(), stem.strip()[:MAX_NAME].strip()


def _looks_like(extension: str, head: bytes) -> bool:
    """The file signature: DWG starts AC10 and two digits; DXF is binary, or text whose
    first non-empty lines are 0 and SECTION. It shows only that a file looks like one."""
    if extension == "dwg":
        return DWG_SIGNATURE.match(head) is not None
    if head.startswith(DXF_BINARY):
        return True
    lines = [line.strip() for line in head.removeprefix(b"\xef\xbb\xbf").splitlines()]
    return [line for line in lines if line][:2] == [b"0", b"SECTION"]


def _default_state() -> dict[str, Any]:
    """An uploaded drawing's first state: no review, the view fitted by the dashboard."""
    workspace = {"view": "drawing", "selection": None, "compareSplit": 50, "layers": dict.fromkeys(LAYERS, True), "colourBy": "medium"}
    return {"schemaVersion": SCHEMA_VERSION, "workspace": workspace, "review": None}


class CadProjectService:
    def __init__(self, store: Any, *, clock: Callable[[], str] = utcnow):
        self.store = store
        self.clock = clock

    def status(self) -> dict[str, Any]:
        return {
            "available": True,
            "schemaVersion": SCHEMA_VERSION,
            "limits": {"maxUploadBytes": MAX_UPLOAD_BYTES, "maxStateBytes": MAX_STATE_BYTES, "maxNameLength": MAX_NAME, "extensions": list(EXTENSIONS)},
        }

    def _summary(self, row: dict[str, Any]) -> dict[str, Any]:
        if row["source_kind"] == "upload":
            original = {
                "name": row["original_name"],
                "extension": row["original_extension"],
                "sizeBytes": row["original_size"],
                "sha256": row["original_sha256"],
                "available": self.store.has_original(row["original_sha256"]),
            }
            source: dict[str, Any] = {"kind": "upload", "original": original}
        else:
            source = {"kind": "sample", "sampleId": row["sample_id"], "sceneRevision": row["scene_revision"], "configRevision": row["config_revision"]}
        return {
            "id": row["id"],
            "name": row["name"],
            "createdAt": row["created_at"],
            "modifiedAt": row["modified_at"],
            "lastOpenedAt": row["last_opened_at"],
            "revision": row["revision"],
            "source": source,
            "review": None if row["open_findings"] is None else {"openFindings": row["open_findings"]},
        }

    @staticmethod
    def _known(project_id: Any) -> str:
        # Checked before any lookup: a malformed ID is simply not a project.
        if not isinstance(project_id, str) or not PROJECT_ID.fullmatch(project_id):
            raise ServiceError("NOT_FOUND", "There is no CAD project with this ID.")
        return project_id

    def _new(self, name: str, **fields: Any) -> dict[str, Any]:
        now = self.clock()
        row = {"id": f"cadp_{secrets.token_hex(8)}", "name": name, "created_at": now, "modified_at": now, "last_opened_at": now, "revision": 1}
        return {**row, **fields}

    # --- Operations -----------------------------------------------------------------------

    def list(self) -> dict[str, Any]:
        return {"projects": [self._summary(r) for r in self.store.list()]}

    def create(self, body: Any) -> dict[str, Any]:
        """A project from the prepared sample, with the initial state the dashboard supplies."""
        body = _body(body)
        name = _name(body.get("name"))
        if body.get("sampleId") != SAMPLE_ID:
            raise _invalid(f"sampleId must be {SAMPLE_ID}.")
        scene = _whole(body.get("sceneRevision"), "sceneRevision")
        config = _whole(body.get("configRevision"), "configRevision")
        state, text = _state(body.get("state"))
        row = self._new(
            name, source_kind="sample", sample_id=SAMPLE_ID, scene_revision=scene, config_revision=config,
            open_findings=_findings(body, state), state=text,
        )
        self.store.insert(row)
        return {"project": self._summary(row), "state": state}

    def upload(self, file_name: Any, stream: Any) -> dict[str, Any]:
        """A project from a drawing's bytes, streamed and hashed, capped at MAX_UPLOAD_BYTES."""
        name, extension, project_name = _file_name(file_name)
        staged = self.store.stage(stream, MAX_UPLOAD_BYTES)
        try:
            if not staged.size:
                raise _invalid("The file is empty.")
            if not _looks_like(extension, staged.head):
                raise ServiceError("UNSUPPORTED", f"The file does not look like a {extension.upper()} drawing.")
            state = _default_state()
            row = self._new(
                project_name, source_kind="upload", original_name=name, original_extension=extension,
                original_size=staged.size, original_sha256=staged.sha256, open_findings=None, state=json.dumps(state, separators=(",", ":")),
            )
            self.store.insert(row, staged)
        finally:
            self.store.discard(staged)
        return {"project": self._summary(row), "state": state}

    def open(self, project_id: Any) -> dict[str, Any]:
        row = self.store.opened(self._known(project_id), self.clock())
        if row is None:
            raise ServiceError("NOT_FOUND", "There is no CAD project with this ID.")
        return {"project": self._summary(row), "state": json.loads(row["state"])}

    def _update(self, project_id: str, revision: int, fields: dict[str, Any]) -> dict[str, Any]:
        row = self.store.update(project_id, revision, fields)
        if row is not None:
            return {"project": self._summary(row)}
        current = self.store.get(project_id)
        if current is None:
            raise ServiceError("NOT_FOUND", "There is no CAD project with this ID.")
        raise ServiceError(
            "CONFLICT",
            f"This project changed elsewhere (it is at revision {current['revision']}, not {revision}). Reopen it to continue from the saved version.",
            details={"project": self._summary(current)},
        )

    def save(self, project_id: Any, body: Any) -> dict[str, Any]:
        project_id = self._known(project_id)
        body = _body(body)
        revision = _whole(body.get("expectedRevision"), "expectedRevision", 1)
        state, text = _state(body.get("state"))
        findings = _findings(body, state)
        return self._update(project_id, revision, {"state": text, "open_findings": findings, "modified_at": self.clock()})

    def rename(self, project_id: Any, body: Any) -> dict[str, Any]:
        project_id = self._known(project_id)
        body = _body(body)
        name = _name(body.get("name"))
        revision = _whole(body.get("expectedRevision"), "expectedRevision", 1)
        return self._update(project_id, revision, {"name": name, "modified_at": self.clock()})

    def copy(self, project_id: Any, body: Any) -> dict[str, Any]:
        """Save As with `state` (the dashboard's unsaved state and its openFindings), Duplicate
        without it (the saved state). The copy shares the original file."""
        project_id = self._known(project_id)
        body = _body(body)
        fields = self._new(_name(body.get("name")))
        if body.get("state") is not None:
            state, text = _state(body["state"])
            fields.update(state=text, open_findings=_findings(body, state))
        row = self.store.copy(project_id, fields)
        if row is None:
            raise ServiceError("NOT_FOUND", "There is no CAD project with this ID.")
        return {"project": self._summary(row), "state": json.loads(row["state"])}

    def delete(self, project_id: Any) -> dict[str, Any]:
        project_id = self._known(project_id)
        if not self.store.delete(project_id):
            raise ServiceError("NOT_FOUND", "There is no CAD project with this ID.")
        return {"deleted": project_id}

    def original(self, project_id: Any) -> tuple[BinaryIO, str]:
        """The original drawing, open for reading, and its file name. The caller closes it."""
        row = self.store.get(self._known(project_id))
        if row is None:
            raise ServiceError("NOT_FOUND", "There is no CAD project with this ID.")
        if row["source_kind"] != "upload":
            raise ServiceError("NOT_FOUND", "This project was made from the prepared sample; it has no original drawing.")
        f = self.store.open_original(row["original_sha256"])
        if f is None:
            raise ServiceError("NOT_FOUND", "The original drawing is missing from the CAD folder.")
        return f, row["original_name"]
