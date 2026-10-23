"""One site's definition: what the plant is, read from configuration.

The reference projects hold this in Python. Eleven sites, one hand-written module each,
twenty-nine thousand lines between them, and because a configuration file could contain
logic it eventually did. This module is the alternative: the site is data, the code that
assembles a plant from it is written once, and a new site is a directory of files rather
than a new class.

What the split into files buys is described in `configs/site/README.md`. What this module
adds is the part a file format cannot provide:

**Every reference is checked.** A link naming a device that does not exist, a device
naming equipment the catalogue does not carry, a fit naming a parameter that is not
there — each is an error at load time, naming the file and the entry. The reference
implementation resolves such names with `dict.get(key, default)`, so a typo silently
becomes a default and the plant quietly models something else.

**All problems are reported at once.** Fixing a configuration one exception at a time is
miserable, and an operator correcting an extracted topology usually has several things to
fix. `SiteConfigError` carries the whole list.

**Evidence survives loading.** A link that was inferred rather than confirmed stays marked
as inferred all the way to the result, because a number produced from a guessed topology
must not be presented as site fidelity.

**Calibration is an overlay, not an edit.** `equipment.yaml` always holds nameplate data;
fitted values live in `calibration/` with provenance and are applied on top at load time.
That is what makes an uncalibrated site self-declaring rather than something discovered by
comparing its numbers against another plant's.
"""

from __future__ import annotations

import copy
from dataclasses import dataclass
from enum import StrEnum
from pathlib import Path, PurePosixPath
from typing import Any, Mapping, Sequence

from hvac_agent.core.metrics import DeviceFamily, family_of

__all__ = [
    "Bus",
    "Calibration",
    "Device",
    "Endpoint",
    "EndpointKind",
    "Evidence",
    "Fit",
    "Link",
    "Medium",
    "Provenance",
    "SCHEMA_VERSION",
    "SiteConfigError",
    "SiteDefinition",
    "Terminal",
    "Topology",
    "TopologyFamily",
    "Valve",
    "load_site",
]

SCHEMA_VERSION = 1


class Evidence(StrEnum):
    """How well supported a piece of topology is.

    `INFERRED` and `UNKNOWN` do not prevent a site from running. They are carried so that
    a result can say which parts of the plant behind it were assumed.
    """

    CONFIRMED = "confirmed"
    DRAWING = "drawing"
    INFERRED = "inferred"
    UNKNOWN = "unknown"

    @property
    def is_evidence(self) -> bool:
        """Whether this rests on an observation rather than on a convention."""
        return self in (Evidence.CONFIRMED, Evidence.DRAWING)


class Medium(StrEnum):
    """What flows through a bus or a link."""

    CONDENSER_WATER = "cw"
    CHILLED_WATER = "chw"


class TopologyFamily(StrEnum):
    """The plant shapes this product can assemble.

    A family fixes the bus set, the port names and the hydraulic branch names; a site
    varies only by how many of each machine it has and by how they are linked. Adding a
    family is a deliberate act, which is why this is an enumeration rather than a free
    string: a typo must not quietly produce a plant nothing can assemble.
    """

    WATER_COOLED_CHILLER_PLANT_V1 = "water_cooled_chiller_plant_v1"


TERMINAL_FAMILY = "terminal"

# Which ports each family has. A port is a named place where water enters or leaves a
# machine; where it is drawn belongs to the scene, not here.
_PORTS: Mapping[str, frozenset[str]] = {
    DeviceFamily.CHILLER: frozenset({"cond_in", "cond_out", "evap_in", "evap_out"}),
    DeviceFamily.CHILLED_WATER_PUMP: frozenset({"suction", "discharge"}),
    DeviceFamily.COOLING_WATER_PUMP: frozenset({"suction", "discharge"}),
    DeviceFamily.COOLING_TOWER: frozenset({"water_in", "water_out"}),
    TERMINAL_FAMILY: frozenset({"water_in", "water_out"}),
}

# The headers every plant in a family has, and what flows through each.
_REQUIRED_BUSES: Mapping[TopologyFamily, Mapping[str, Medium]] = {
    TopologyFamily.WATER_COOLED_CHILLER_PLANT_V1: {
        "cw_supply": Medium.CONDENSER_WATER,
        "cw_return": Medium.CONDENSER_WATER,
        "chw_supply": Medium.CHILLED_WATER,
        "chw_return": Medium.CHILLED_WATER,
    },
}

# The kinds of connection a family is assembled from. An end is a bus by name, or a
# device family and port; anything outside this table is a plant the family cannot
# assemble, and is rejected rather than simulated as something it is not.
#
# In water_cooled_chiller_plant_v1 each pump is in series with the chiller the links pair
# it with: chilled-water pumps downstream of the evaporator, condenser pumps upstream of
# the condenser. A chiller with no pump of its own opens onto the header instead, and is
# fed by a header pump — one that is linked to a header and to no chiller.
_Shape = tuple[str, str]
_CHW, _CW = Medium.CHILLED_WATER, Medium.CONDENSER_WATER
_CHILLER = str(DeviceFamily.CHILLER)
_CHW_PUMP = str(DeviceFamily.CHILLED_WATER_PUMP)
_CW_PUMP = str(DeviceFamily.COOLING_WATER_PUMP)
_TOWER = str(DeviceFamily.COOLING_TOWER)

_FAMILY_CONNECTIONS: Mapping[TopologyFamily, Mapping[tuple[_Shape, _Shape], Medium]] = {
    TopologyFamily.WATER_COOLED_CHILLER_PLANT_V1: {
        (("bus", "chw_return"), (_CHILLER, "evap_in")): _CHW,
        ((_CHILLER, "evap_out"), (_CHW_PUMP, "suction")): _CHW,
        ((_CHILLER, "evap_out"), ("bus", "chw_supply")): _CHW,
        ((_CHW_PUMP, "discharge"), ("bus", "chw_supply")): _CHW,
        (("bus", "chw_supply"), (TERMINAL_FAMILY, "water_in")): _CHW,
        ((TERMINAL_FAMILY, "water_out"), ("bus", "chw_return")): _CHW,
        (("bus", "cw_supply"), (_CW_PUMP, "suction")): _CW,
        ((_CW_PUMP, "discharge"), (_CHILLER, "cond_in")): _CW,
        ((_CW_PUMP, "discharge"), ("bus", "cw_supply")): _CW,
        (("bus", "cw_supply"), (_CHILLER, "cond_in")): _CW,
        ((_CHILLER, "cond_out"), ("bus", "cw_return")): _CW,
        (("bus", "cw_return"), (_TOWER, "water_in")): _CW,
        ((_TOWER, "water_out"), ("bus", "cw_supply")): _CW,
    },
}

# How many connections each port takes, as (fewest, most). A port with none leaves a
# machine with no flow path; one with two would be a parallel arrangement the family
# does not model. A chilled-water pump's suction may be unconnected: that is a header
# pump, which serves whichever chillers have no pump of their own.
_PORT_CONNECTIONS: Mapping[TopologyFamily, Mapping[str, Mapping[str, tuple[int, int]]]] = {
    TopologyFamily.WATER_COOLED_CHILLER_PLANT_V1: {
        _CHILLER: {"evap_in": (1, 1), "evap_out": (1, 1), "cond_in": (1, 1), "cond_out": (1, 1)},
        _CHW_PUMP: {"suction": (0, 1), "discharge": (1, 1)},
        _CW_PUMP: {"suction": (1, 1), "discharge": (1, 1)},
        _TOWER: {"water_in": (1, 1), "water_out": (1, 1)},
        TERMINAL_FAMILY: {"water_in": (1, 1), "water_out": (1, 1)},
    },
}

_FILE_ROLES = (
    "topology",
    "equipment",
    "control",
    "boundary",
    "calibration_physics",
    "calibration_display",
)


class SiteConfigError(ValueError):
    """Raised when a site configuration is unusable.

    Carries every problem found rather than the first, because a configuration under
    correction usually has more than one.
    """

    def __init__(self, problems: Sequence[str]) -> None:
        self.problems = tuple(problems)
        listed = "\n".join(f"  - {problem}" for problem in self.problems)
        super().__init__(
            f"{len(self.problems)} problem(s) in the site configuration:\n{listed}"
        )


class EndpointKind(StrEnum):
    DEVICE = "device"
    BUS = "bus"


@dataclass(frozen=True, slots=True)
class Endpoint:
    """One end of a link: a named port on a device, or a header."""

    kind: EndpointKind
    name: str
    port: str | None = None

    def __str__(self) -> str:
        return self.name if self.port is None else f"{self.name}.{self.port}"


@dataclass(frozen=True, slots=True)
class Device:
    id: str
    family: DeviceFamily
    equipment: str
    evidence: Evidence
    role: str | None = None

    @property
    def is_standby(self) -> bool:
        return self.role == "standby"


@dataclass(frozen=True, slots=True)
class Bus:
    id: str
    medium: Medium


@dataclass(frozen=True, slots=True)
class Terminal:
    """The lumped load. One aggregate, not modelled floor by floor."""

    id: str
    evidence: Evidence


@dataclass(frozen=True, slots=True)
class Link:
    source: Endpoint
    target: Endpoint
    medium: Medium
    evidence: Evidence
    note: str | None = None

    def __str__(self) -> str:
        return f"{self.source} -> {self.target}"


@dataclass(frozen=True, slots=True)
class Valve:
    """A valve, either in one line or between two headers.

    Sizing lives in the equipment catalogue; this records only where it sits.
    """

    id: str
    equipment: str
    evidence: Evidence
    at: Endpoint | None = None
    across: tuple[Endpoint, Endpoint] | None = None


@dataclass(frozen=True, slots=True)
class Topology:
    family: TopologyFamily
    devices: tuple[Device, ...]
    buses: tuple[Bus, ...]
    terminal: Terminal
    links: tuple[Link, ...]
    valves: tuple[Valve, ...]

    def devices_of(self, family: DeviceFamily) -> tuple[Device, ...]:
        return tuple(device for device in self.devices if device.family is family)

    def counts(self) -> Mapping[DeviceFamily, int]:
        """How many of each family, which is what the builder is parameterised by."""
        return {family: len(self.devices_of(family)) for family in DeviceFamily}

    def device_ids(self) -> tuple[str, ...]:
        return tuple(device.id for device in self.devices)

    def paired_pumps(self, pump_family: DeviceFamily) -> dict[str, str]:
        """Which pump of `pump_family` each chiller is in series with, from the links.

        A chiller with no pump of its own is absent; it is fed by the header pumps. The
        loader has already refused a chiller linked to two pumps or a pump linked to two
        chillers, so each entry is unambiguous.
        """
        pairs: dict[str, str] = {}
        for link in self.links:
            ends = (link.source, link.target)
            if any(end.kind is not EndpointKind.DEVICE for end in ends):
                continue
            by_family = {family_of(end.name): end.name for end in ends}
            if DeviceFamily.CHILLER in by_family and pump_family in by_family:
                pairs[by_family[DeviceFamily.CHILLER]] = by_family[pump_family]
        return pairs

    def assumptions(self) -> tuple[str, ...]:
        """Everything in the topology resting on a convention rather than on evidence.

        Reported alongside a result. A plant assembled from guessed connections may well
        be right, but it must not be presented as though they had been verified.
        """
        assumed: list[str] = []
        for device in self.devices:
            if not device.evidence.is_evidence:
                assumed.append(f"device {device.id} [{device.evidence}]")
        for link in self.links:
            if not link.evidence.is_evidence:
                detail = f" ({link.note})" if link.note else ""
                assumed.append(f"link {link} [{link.evidence}]{detail}")
        for valve in self.valves:
            if not valve.evidence.is_evidence:
                assumed.append(f"valve {valve.id} [{valve.evidence}]")
        if not self.terminal.evidence.is_evidence:
            assumed.append(f"terminal {self.terminal.id} [{self.terminal.evidence}]")
        return tuple(assumed)


@dataclass(frozen=True, slots=True)
class Provenance:
    """Where a set of fitted values came from.

    Required on every fit. In the reference implementation one plant's fitted constants
    were copied verbatim into at least five others, which nothing could detect because a
    fitted value and a nameplate value look identical in a file. `fitted_from` names the
    site the data came from, which may be a different one: borrowing another plant's
    calibration is allowed, hiding it is not.
    """

    fitted_from: str
    fitted_at: str
    method: str
    data_window: tuple[str, str] | None = None
    residual_pct: float | None = None
    notes: str | None = None

    @property
    def is_borrowed(self) -> bool:
        return self.fitted_from != "this_site"


@dataclass(frozen=True, slots=True)
class Fit:
    """One fitting run: its provenance and the values it produced.

    A run is the unit rather than a single value because that is how fitting actually
    happens — one search moves thirty parameters together, and they share a window, a
    method and a residual.
    """

    provenance: Provenance
    values: Mapping[str, Any]


@dataclass(frozen=True, slots=True)
class Calibration:
    """Engineering defaults, plus overlays fitted from measurements.

    `defaults` is what a site has on day one: not measured, and good enough to answer
    staging and capacity questions. `fits` is what two to four weeks of BMS data buys.
    An empty `fits` is not an incomplete configuration; it is a Tier 1 site, and saying
    so in the file is the point.
    """

    defaults: Mapping[str, Any]
    fits: tuple[Fit, ...]

    @property
    def is_calibrated(self) -> bool:
        return bool(self.fits)

    def borrowed_from(self) -> tuple[str, ...]:
        """Sites other than this one whose data these values were fitted from."""
        return tuple(
            dict.fromkeys(
                fit.provenance.fitted_from for fit in self.fits if fit.provenance.is_borrowed
            )
        )

    def resolved(self, prefix: str = "") -> dict[str, Any]:
        """`defaults` with every fit applied in order, later fits winning.

        Fits whose path starts with `prefix` are applied with the prefix stripped, which
        is how an overlay onto the equipment catalogue is kept in the same list as one
        onto the hydraulics: a fitting run touches whatever it touches.
        """
        resolved = copy.deepcopy(dict(self.defaults))
        for fit in self.fits:
            for path, value in fit.values.items():
                if prefix:
                    if not path.startswith(prefix):
                        continue
                    path = path[len(prefix) :]
                elif path.startswith("equipment."):
                    continue
                _assign(resolved, path.split("."), value)
        return resolved


@dataclass(frozen=True, slots=True)
class SiteDefinition:
    """Everything needed to assemble and run one plant."""

    directory: Path
    revision: int
    topology: Topology
    equipment: Mapping[str, Any]
    control: Mapping[str, Any]
    boundary: Mapping[str, Any]
    physics: Calibration
    display: Calibration

    @property
    def config_revision(self) -> str:
        """What an observation reports, so a recorded result names the configuration.

        Calibration is part of it: a refit changes computed numbers, and history has to
        be able to tell the two apart.
        """
        tier = "calibrated" if self.is_calibrated else "nameplate"
        return f"rev{self.revision}-{tier}"

    @property
    def is_calibrated(self) -> bool:
        return self.physics.is_calibrated or self.display.is_calibrated

    def resolved_equipment(self) -> dict[str, Any]:
        """The catalogue with any fitted curves applied over the nameplate values."""
        catalogue = copy.deepcopy(dict(self.equipment))
        for calibration in (self.physics, self.display):
            for fit in calibration.fits:
                for path, value in fit.values.items():
                    if path.startswith("equipment."):
                        _assign(catalogue, path[len("equipment.") :].split("."), value)
        return catalogue

    def resolved_physics(self) -> dict[str, Any]:
        return self.physics.resolved()

    def resolved_display(self) -> dict[str, Any]:
        return self.display.resolved()

    def caveats(self) -> tuple[str, ...]:
        """What a reader of a result from this site needs to be told.

        Assumed topology, missing calibration and borrowed calibration all limit what a
        number means. Collecting them here means a caller cannot forget one.
        """
        caveats = list(self.topology.assumptions())
        if not self.is_calibrated:
            caveats.append(
                "not calibrated: nameplate model, so pressures and absolute energy "
                "are not expected to reproduce measurements"
            )
        for calibration, what in ((self.physics, "physics"), (self.display, "display")):
            for site in calibration.borrowed_from():
                caveats.append(f"{what} calibration fitted from {site}, not this site")
        return tuple(caveats)


# --- loading ------------------------------------------------------------------------


def load_site(directory: Path | str) -> SiteDefinition:
    """Read and validate a site configuration directory.

    Raises:
        SiteConfigError: listing every problem found, not just the first.
    """
    directory = Path(directory)
    problems: list[str] = []

    manifest = _read_yaml(directory / "site.yaml", problems)
    if manifest is None:
        raise SiteConfigError(problems)

    _check_manifest(manifest, problems)
    documents = _read_listed_files(directory, manifest, problems)
    if problems:
        raise SiteConfigError(problems)

    family = _topology_family(manifest, problems)
    topology = _build_topology(documents["topology"], family, problems)
    equipment = _equipment_catalogue(documents["equipment"], problems)

    if topology is not None:
        _check_equipment_references(topology, equipment, problems)
        _check_required_buses(topology, family, problems)
        _check_connections(topology, problems)

    physics = _build_calibration(documents["calibration_physics"], "physics", problems)
    display = _build_calibration(documents["calibration_display"], "display", problems)
    for calibration, what in ((physics, "physics"), (display, "display")):
        _check_fit_paths(calibration, equipment, what, problems)

    if problems:
        raise SiteConfigError(problems)

    assert topology is not None  # guaranteed by the check above
    return SiteDefinition(
        directory=directory,
        revision=int(manifest["revision"]),
        topology=topology,
        equipment=equipment,
        control=documents["control"],
        boundary=documents["boundary"],
        physics=physics,
        display=display,
    )


def _read_yaml(path: Path, problems: list[str]) -> dict[str, Any] | None:
    try:
        import yaml
    except ModuleNotFoundError:  # pragma: no cover - declared in pyproject
        raise

    if not path.is_file():
        problems.append(f"{path.name}: missing")
        return None
    try:
        document = yaml.safe_load(path.read_text(encoding="utf-8"))
    except yaml.YAMLError as error:
        problems.append(f"{path.name}: not valid YAML: {error}")
        return None
    if not isinstance(document, dict):
        problems.append(f"{path.name}: expected a mapping at the top level")
        return None
    return document


def _check_manifest(manifest: Mapping[str, Any], problems: list[str]) -> None:
    version = manifest.get("schema_version")
    if version != SCHEMA_VERSION:
        problems.append(
            f"site.yaml: schema_version is {version!r}, this build reads {SCHEMA_VERSION}"
        )
    revision = manifest.get("revision")
    if not isinstance(revision, int) or revision < 1:
        problems.append(f"site.yaml: revision must be a positive integer, got {revision!r}")
    files = manifest.get("files")
    if not isinstance(files, dict):
        problems.append("site.yaml: files must be a mapping of role to filename")
        return
    for role in _FILE_ROLES:
        if role not in files:
            problems.append(f"site.yaml: files is missing {role!r}")


def _read_listed_files(
    directory: Path, manifest: Mapping[str, Any], problems: list[str]
) -> dict[str, dict[str, Any]]:
    documents: dict[str, dict[str, Any]] = {}
    files = manifest.get("files")
    if not isinstance(files, dict):
        return documents
    for role in _FILE_ROLES:
        name = files.get(role)
        if not isinstance(name, str):
            continue
        relative = PurePosixPath(name)
        if relative.is_absolute() or ".." in relative.parts:
            problems.append(f"site.yaml: {role} path {name!r} must stay inside the directory")
            continue
        document = _read_yaml(directory / relative, problems)
        documents[role] = document if document is not None else {}
    return documents


def _topology_family(manifest: Mapping[str, Any], problems: list[str]) -> TopologyFamily | None:
    raw = manifest.get("topology_family")
    try:
        return TopologyFamily(raw)
    except ValueError:
        known = ", ".join(sorted(TopologyFamily))
        problems.append(f"site.yaml: unknown topology_family {raw!r}; known families: {known}")
        return None


def _enum(value: Any, enum: type[StrEnum], where: str, problems: list[str]) -> Any:
    try:
        return enum(value)
    except ValueError:
        allowed = ", ".join(sorted(enum))
        problems.append(f"{where}: {value!r} is not one of: {allowed}")
        return None


def _build_topology(
    document: Mapping[str, Any], family: TopologyFamily | None, problems: list[str]
) -> Topology | None:
    if family is None:
        return None

    devices: list[Device] = []
    seen: set[str] = set()
    for entry in document.get("devices") or []:
        device_id = entry.get("id")
        where = f"topology.yaml: device {device_id!r}"
        if device_id in seen:
            problems.append(f"{where}: duplicate id")
            continue
        seen.add(device_id)

        declared = _enum(entry.get("family"), DeviceFamily, where, problems)
        evidence = _enum(entry.get("evidence"), Evidence, where, problems)
        if declared is None or evidence is None:
            continue
        # The point vocabulary derives a device's family from its id, so a device whose
        # id says one thing and whose family field says another would produce points
        # nothing downstream could interpret.
        if family_of(device_id) is not declared:
            problems.append(
                f"{where}: id does not match family {declared!r}; "
                f"expected an id like '{declared}_1'"
            )
            continue
        if not isinstance(entry.get("equipment"), str):
            problems.append(f"{where}: equipment must name an entry in the catalogue")
            continue
        devices.append(
            Device(
                id=device_id,
                family=declared,
                equipment=entry["equipment"],
                evidence=evidence,
                role=entry.get("role"),
            )
        )

    buses: list[Bus] = []
    for entry in document.get("buses") or []:
        where = f"topology.yaml: bus {entry.get('id')!r}"
        medium = _enum(entry.get("medium"), Medium, where, problems)
        if medium is not None:
            buses.append(Bus(id=entry["id"], medium=medium))

    terminal = _build_terminal(document, problems)

    known_devices = {device.id: device.family for device in devices}
    known_buses = {bus.id for bus in buses}
    if terminal is not None:
        known_devices[terminal.id] = TERMINAL_FAMILY

    links = _build_links(document, known_devices, known_buses, problems)
    valves = _build_valves(document, known_devices, known_buses, problems)

    if terminal is None:
        return None
    return Topology(
        family=family,
        devices=tuple(devices),
        buses=tuple(buses),
        terminal=terminal,
        links=tuple(links),
        valves=tuple(valves),
    )


def _build_terminal(document: Mapping[str, Any], problems: list[str]) -> Terminal | None:
    entry = document.get("terminal")
    if not isinstance(entry, dict) or not isinstance(entry.get("id"), str):
        problems.append("topology.yaml: terminal must declare an id")
        return None
    evidence = _enum(entry.get("evidence"), Evidence, "topology.yaml: terminal", problems)
    if evidence is None:
        return None
    return Terminal(id=entry["id"], evidence=evidence)


def _endpoint(
    raw: Any,
    where: str,
    known_devices: Mapping[str, Any],
    known_buses: set[str],
    problems: list[str],
) -> Endpoint | None:
    if not isinstance(raw, (list, tuple)) or len(raw) != 2:
        problems.append(f"{where}: expected [device_id, port] or [bus, bus_id], got {raw!r}")
        return None
    owner, name = raw
    if owner == "bus":
        if name not in known_buses:
            problems.append(f"{where}: unknown bus {name!r}")
            return None
        return Endpoint(EndpointKind.BUS, name)

    device_family = known_devices.get(owner)
    if device_family is None:
        problems.append(f"{where}: unknown device {owner!r}")
        return None
    ports = _PORTS.get(device_family, frozenset())
    if name not in ports:
        allowed = ", ".join(sorted(ports))
        problems.append(f"{where}: {owner} has no port {name!r}; it has: {allowed}")
        return None
    return Endpoint(EndpointKind.DEVICE, owner, name)


def _build_links(
    document: Mapping[str, Any],
    known_devices: Mapping[str, Any],
    known_buses: set[str],
    problems: list[str],
) -> list[Link]:
    links: list[Link] = []
    for index, entry in enumerate(document.get("links") or []):
        where = f"topology.yaml: link {index}"
        source = _endpoint(entry.get("from"), f"{where} from", known_devices, known_buses, problems)
        target = _endpoint(entry.get("to"), f"{where} to", known_devices, known_buses, problems)
        medium = _enum(entry.get("medium"), Medium, where, problems)
        evidence = _enum(entry.get("evidence"), Evidence, where, problems)
        if source is None or target is None or medium is None or evidence is None:
            continue
        links.append(
            Link(
                source=source,
                target=target,
                medium=medium,
                evidence=evidence,
                note=entry.get("note"),
            )
        )
    return links


def _build_valves(
    document: Mapping[str, Any],
    known_devices: Mapping[str, Any],
    known_buses: set[str],
    problems: list[str],
) -> list[Valve]:
    valves: list[Valve] = []
    seen: set[str] = set()
    for entry in document.get("valves") or []:
        valve_id = entry.get("id")
        where = f"topology.yaml: valve {valve_id!r}"
        if valve_id in seen:
            problems.append(f"{where}: duplicate id")
            continue
        seen.add(valve_id)

        evidence = _enum(entry.get("evidence"), Evidence, where, problems)
        if evidence is None or not isinstance(entry.get("equipment"), str):
            if evidence is not None:
                problems.append(f"{where}: equipment must name an entry in the catalogue")
            continue

        has_at, has_across = "at" in entry, "across" in entry
        if has_at == has_across:
            problems.append(f"{where}: needs exactly one of 'at' or 'across'")
            continue

        if has_at:
            at = _endpoint(entry["at"], f"{where} at", known_devices, known_buses, problems)
            if at is None:
                continue
            valves.append(Valve(valve_id, entry["equipment"], evidence, at=at))
            continue

        pair = entry["across"]
        if not isinstance(pair, (list, tuple)) or len(pair) != 2:
            problems.append(f"{where}: across expects two endpoints, got {pair!r}")
            continue
        ends = [
            _endpoint(end, f"{where} across[{i}]", known_devices, known_buses, problems)
            for i, end in enumerate(pair)
        ]
        if any(end is None for end in ends):
            continue
        valves.append(
            Valve(valve_id, entry["equipment"], evidence, across=(ends[0], ends[1]))
        )
    return valves


def _equipment_catalogue(document: Mapping[str, Any], problems: list[str]) -> dict[str, Any]:
    catalogue = document.get("equipment")
    if not isinstance(catalogue, dict):
        problems.append("equipment.yaml: expected an 'equipment' mapping")
        return {}
    for key, entry in catalogue.items():
        where = f"equipment.yaml: {key}"
        if not isinstance(entry, dict) or "family" not in entry:
            problems.append(f"{where}: must declare a family")
            continue
        table = entry.get("performance_table")
        if isinstance(table, dict):
            _check_workbook(table.get("workbook"), where, problems)
    return catalogue


def _check_workbook(workbook: Any, where: str, problems: list[str]) -> None:
    """A performance workbook is customer data and resolves inside the site directory.

    The reference implementation falls back to a workbook under another customer's data
    directory when a site's own is missing, so one plant silently simulates with another
    plant's chiller curves. An escaping path is rejected rather than resolved.
    """
    if not isinstance(workbook, str):
        problems.append(f"{where}: performance_table needs a workbook filename")
        return
    relative = PurePosixPath(workbook)
    if relative.is_absolute() or ".." in relative.parts:
        problems.append(
            f"{where}: workbook {workbook!r} must stay inside the site directory; "
            "a site never reads another site's equipment data"
        )


def _check_equipment_references(
    topology: Topology, catalogue: Mapping[str, Any], problems: list[str]
) -> None:
    for device in topology.devices:
        entry = catalogue.get(device.equipment)
        if entry is None:
            problems.append(
                f"topology.yaml: device {device.id} names equipment "
                f"{device.equipment!r}, which the catalogue does not contain"
            )
        elif entry.get("family") != device.family:
            problems.append(
                f"topology.yaml: device {device.id} is a {device.family}, but equipment "
                f"{device.equipment!r} is for {entry.get('family')!r}"
            )
    for valve in topology.valves:
        if valve.equipment not in catalogue:
            problems.append(
                f"topology.yaml: valve {valve.id} names equipment "
                f"{valve.equipment!r}, which the catalogue does not contain"
            )


def _check_required_buses(
    topology: Topology, family: TopologyFamily | None, problems: list[str]
) -> None:
    if family is None:
        return
    declared = {bus.id: bus.medium for bus in topology.buses}
    for bus_id, medium in _REQUIRED_BUSES[family].items():
        if bus_id not in declared:
            problems.append(f"topology.yaml: {family} requires a bus {bus_id!r}")
        elif declared[bus_id] is not medium:
            problems.append(
                f"topology.yaml: bus {bus_id!r} carries {medium}, not {declared[bus_id]}"
            )


def _check_connections(topology: Topology, problems: list[str]) -> None:
    """Every link is a kind the family assembles, and every machine is fully connected.

    Without this, the links were read for pump pairing and nothing else: a topology with
    every link deleted loaded and simulated the same plant as the complete one, so a
    site's wiring could be missing or wrong and the result would not change.
    """
    family = topology.family
    allowed = _FAMILY_CONNECTIONS[family]
    families = {device.id: str(device.family) for device in topology.devices}
    families[topology.terminal.id] = TERMINAL_FAMILY

    def shape(end: Endpoint) -> _Shape:
        if end.kind is EndpointKind.BUS:
            return ("bus", end.name)
        return (families[end.name], end.port or "")

    used: dict[tuple[str, str], int] = {}
    for index, link in enumerate(topology.links):
        where = f"topology.yaml: link {index} ({link})"
        kind = (shape(link.source), shape(link.target))
        medium = allowed.get(kind)
        if medium is None:
            problems.append(f"{where}: {family} has no connection of this kind")
            continue
        if link.medium is not medium:
            problems.append(
                f"{where}: declared as {link.medium}, but this connection carries {medium}"
            )
        for end in (link.source, link.target):
            if end.kind is EndpointKind.DEVICE:
                used[(end.name, end.port or "")] = used.get((end.name, end.port or ""), 0) + 1

    ports = _PORT_CONNECTIONS[family]
    for device_id, device_family in families.items():
        for port, (fewest, most) in ports.get(device_family, {}).items():
            count = used.get((device_id, port), 0)
            if not fewest <= count <= most:
                wanted = str(fewest) if fewest == most else f"{fewest} to {most}"
                problems.append(
                    f"topology.yaml: {device_id}.{port} has {count} connection(s); "
                    f"{family} needs {wanted}"
                )

    # A chiller that opens onto a header rather than into a pump of its own needs a pump
    # on that header to move its water.
    for pump_family, port in (
        (DeviceFamily.CHILLED_WATER_PUMP, "evap_out"),
        (DeviceFamily.COOLING_WATER_PUMP, "cond_in"),
    ):
        paired = topology.paired_pumps(pump_family)
        pumps = {device.id for device in topology.devices_of(pump_family)}
        unpaired = [
            device.id
            for device in topology.devices_of(DeviceFamily.CHILLER)
            if device.id not in paired and used.get((device.id, port), 0) == 1
        ]
        if unpaired and not pumps - set(paired.values()):
            problems.append(
                f"topology.yaml: {', '.join(unpaired)} has no {pump_family} of its own "
                f"and there is no header {pump_family} to feed it"
            )


def _build_calibration(
    document: Mapping[str, Any], what: str, problems: list[str]
) -> Calibration:
    defaults = document.get("defaults")
    if not isinstance(defaults, dict):
        problems.append(f"calibration/{what}.yaml: expected a 'defaults' mapping")
        defaults = {}

    raw_fits = document.get("fits")
    if raw_fits is None:
        problems.append(
            f"calibration/{what}.yaml: 'fits' is required; write 'fits: []' for a site "
            "that has not been calibrated, so that the absence is stated rather than "
            "left to be inferred"
        )
        raw_fits = []

    fits: list[Fit] = []
    for index, entry in enumerate(raw_fits):
        where = f"calibration/{what}.yaml: fit {index}"
        provenance = _build_provenance(entry.get("provenance"), where, problems)
        values = entry.get("values")
        if not isinstance(values, dict) or not values:
            problems.append(f"{where}: values must be a non-empty mapping of path to value")
            continue
        if provenance is not None:
            fits.append(Fit(provenance=provenance, values=values))
    return Calibration(defaults=defaults, fits=tuple(fits))


def _build_provenance(raw: Any, where: str, problems: list[str]) -> Provenance | None:
    if not isinstance(raw, dict):
        problems.append(
            f"{where}: provenance is required. A fitted value without it cannot be told "
            "apart from one borrowed from another plant."
        )
        return None
    missing = [key for key in ("fitted_from", "fitted_at", "method") if not raw.get(key)]
    if missing:
        problems.append(f"{where}: provenance is missing {', '.join(missing)}")
        return None

    window = raw.get("data_window")
    if window is not None:
        if not isinstance(window, (list, tuple)) or len(window) != 2:
            problems.append(f"{where}: data_window expects [start, end]")
            return None
        window = (str(window[0]), str(window[1]))

    return Provenance(
        fitted_from=str(raw["fitted_from"]),
        fitted_at=str(raw["fitted_at"]),
        method=str(raw["method"]),
        data_window=window,
        residual_pct=raw.get("residual_pct"),
        notes=raw.get("notes"),
    )


def _check_fit_paths(
    calibration: Calibration,
    catalogue: Mapping[str, Any],
    what: str,
    problems: list[str],
) -> None:
    """A fit must name something that exists.

    Without this, a renamed parameter turns a calibration into a no-op: the overlay
    writes a key nothing reads, the defaults stay in force, and the site reports itself
    as calibrated while behaving as though it were not.
    """
    for index, fit in enumerate(calibration.fits):
        for path in fit.values:
            where = f"calibration/{what}.yaml: fit {index}"
            if path.startswith("equipment."):
                root: Mapping[str, Any] = catalogue
                parts = path[len("equipment.") :].split(".")
            else:
                root = calibration.defaults
                parts = path.split(".")
            if not _resolves(root, parts):
                problems.append(f"{where}: {path!r} does not name an existing parameter")


def _resolves(node: Any, parts: Sequence[str]) -> bool:
    for part in parts:
        if not isinstance(node, Mapping) or part not in node:
            return False
        node = node[part]
    return True


def _assign(node: dict[str, Any], parts: Sequence[str], value: Any) -> None:
    for part in parts[:-1]:
        node = node.setdefault(part, {})
    node[parts[-1]] = value
