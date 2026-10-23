"""Assembling a runnable plant from a site definition.

This is where configuration becomes objects. It reads the six files, builds the engine's
chillers, pumps, towers and valves, wires them into the branches the hydraulic solver
works on, and hands back one object holding all of it.

It replaces `_build_devices`, `_build_hydraulics` and `_init_states` on the reference
plant class, which do the same work but read a hand-written module rather than a
configuration, and are written for one site's machine counts. Three differences matter:

**Connections come from the topology, not from position.** The reference pairs pump `i`
with chiller `i` and clamps the index when it runs out (`chillers[min(i, count - 1)]`),
so a third pump silently borrows the second chiller's resistance. Here the pairing is
read from the links the operator confirmed, into a `Roster` that decides which pump runs
with which chiller; a pump with no partner is a header pump rather than quietly given
one. The loader has already refused links the family cannot assemble, so the roster is
built from wiring that is complete.

**Calibration is applied through the overlay.** The builder reads `resolved_equipment()`
and `resolved_physics()`, so a fitted pump curve reaches the engine by the same path as a
nameplate one and nothing downstream needs to know which it got.

**The engine is kept quiet in one place.** `CoolingTower.__init__` prints a warning about
its uncalibrated UA on every construction, so a plant with twelve towers emits twelve
lines while being assembled. One `redirect_stdout` around the whole assembly handles it;
wrapping each class instead would have to be maintained per class, and a shim that
silenced it permanently would hide a genuine warning from anyone running the engine
directly.
"""

from __future__ import annotations

import io
from contextlib import redirect_stdout
from dataclasses import dataclass
from typing import Any, Mapping, Sequence

from hvac_agent.core.metrics import DeviceFamily
from hvac_agent.core.site import SiteDefinition, Topology
from hvac_agent.integrations.phyvac import vendor as pv
from hvac_agent.simulation.baseline import MachineRatings, PlantLayout
from hvac_agent.simulation.dispatch import PUMP_FAMILIES, Roster

__all__ = ["Header", "Plant", "PlantBuildError", "build_plant"]


class PlantBuildError(ValueError):
    """Raised when a valid configuration still cannot be turned into a plant.

    Separate from `SiteConfigError`, which is about the files being wrong. This is about
    the engine refusing what the files describe — a performance workbook that is missing
    or unreadable, most often.
    """


@dataclass(frozen=True, slots=True)
class Header:
    """The branches on one header, split into what feeds it and what draws from it.

    Exactly the shape `solve_header` takes. A `None` entry is a branch out of service,
    and the positions line up with the device order so a solved flow maps back to the
    machine it belongs to.
    """

    sources: tuple[Any, ...]
    sinks: tuple[Any, ...]
    source_devices: tuple[str, ...]
    sink_names: tuple[str, ...]


@dataclass(frozen=True, slots=True)
class Plant:
    """An assembled plant: the engine objects, and what the controller needs to know."""

    chillers: tuple[Any, ...]
    chilled_water_pumps: tuple[Any, ...]
    cooling_water_pumps: tuple[Any, ...]
    cooling_towers: tuple[Any, ...]
    terminal: Any
    valves: Mapping[str, Any]
    chilled_header: Header
    condenser_header: Header
    layout: PlantLayout
    ratings: MachineRatings
    device_ids: Mapping[DeviceFamily, tuple[str, ...]]
    caveats: tuple[str, ...]
    roster: Roster


def build_plant(site: SiteDefinition) -> Plant:
    """Turn a loaded site definition into engine objects.

    Raises:
        PlantBuildError: if the engine cannot accept what the configuration describes.
    """
    equipment = site.resolved_equipment()
    physics = site.resolved_physics()
    topology = site.topology

    # One place, for the whole assembly. See the module docstring.
    noise = io.StringIO()
    with redirect_stdout(noise):
        chillers = _chillers(site, topology, equipment)
        pumps_chw = _pumps(topology, equipment, DeviceFamily.CHILLED_WATER_PUMP)
        pumps_cw = _pumps(topology, equipment, DeviceFamily.COOLING_WATER_PUMP)
        towers = _towers(topology, equipment, physics)
        terminal = pv.AHU_simple(kr=float(_at(physics, "hydraulics.terminal.kr_eq", 0.08)))
        valves = _valves(topology, equipment)

    chilled = _chilled_header(topology, physics, pumps_chw, valves, terminal)
    condenser = _condenser_header(topology, physics, pumps_cw, towers, valves)

    return Plant(
        chillers=chillers,
        chilled_water_pumps=pumps_chw,
        cooling_water_pumps=pumps_cw,
        cooling_towers=towers,
        terminal=terminal,
        valves=valves,
        chilled_header=chilled,
        condenser_header=condenser,
        layout=_layout(topology),
        ratings=_ratings(chillers),
        device_ids={
            family: tuple(d.id for d in topology.devices_of(family)) for family in DeviceFamily
        },
        caveats=site.caveats(),
        roster=_roster(topology),
    )


# --- devices --------------------------------------------------------------------------


def _chillers(
    site: SiteDefinition, topology: Topology, equipment: Mapping[str, Any]
) -> tuple[Any, ...]:
    built = []
    for device in topology.devices_of(DeviceFamily.CHILLER):
        table = equipment[device.equipment].get("performance_table", {})
        # The loader has already refused a path leaving the site directory, so this
        # resolves inside it or not at all.
        workbook = site.directory / table.get("workbook", "")
        if not workbook.is_file():
            raise PlantBuildError(
                f"{device.id}: performance workbook {workbook.name!r} is not in "
                f"{site.directory}. It is customer data and is never committed, so it "
                f"sits beside the configuration it belongs to."
            )
        try:
            built.append(pv.Chiller(filename=str(workbook), sheet_name=table.get("sheet")))
        except Exception as error:  # openpyxl and the engine raise a variety of these
            raise PlantBuildError(
                f"{device.id}: the engine could not read sheet {table.get('sheet')!r} "
                f"of {workbook.name}: {error}"
            ) from error
    return tuple(built)


def _pumps(
    topology: Topology, equipment: Mapping[str, Any], family: DeviceFamily
) -> tuple[Any, ...]:
    built = []
    for device in topology.devices_of(family):
        entry = equipment[device.equipment]
        curve = entry.get("curve", {})
        rated = entry.get("rated", {})
        built.append(
            pv.Pump(
                pg=list(curve.get("pressure", [])) or None,
                eg=list(curve.get("efficiency", [])) or None,
                r_ef=float(curve.get("rated_efficiency", 0.8)),
                g_d=float(rated.get("flow_m3_per_min", 0.25)),
                # The engine's `figure` argument opens a matplotlib window of the pump
                # curve. Never, in a product.
                figure=0,
            )
        )
    return tuple(built)


def _towers(
    topology: Topology, equipment: Mapping[str, Any], physics: Mapping[str, Any]
) -> tuple[Any, ...]:
    # A tower's own resistance and static head are calibration, not nameplate: across the
    # reference sites they differ by a factor of thirty-five for towers of the same duty,
    # which means they were absorbing pipework. They come from physics, not equipment.
    resistance = float(_at(physics, "tower_hydraulics.resistance_kr", 1.0))
    head = float(_at(physics, "tower_hydraulics.static_head_m", 2.0))

    built = []
    for device in topology.devices_of(DeviceFamily.COOLING_TOWER):
        design = equipment[device.equipment].get("design", {})
        built.append(
            pv.CoolingTower(
                tin_w_d=float(design.get("water_in_temp_c", 36.0)),
                tout_w_d=float(design.get("water_out_temp_c", 31.0)),
                twb_d=float(design.get("wet_bulb_temp_c", 28.0)),
                g_w_d=float(design.get("water_flow_m3_per_min", 6.0)),
                g_a_d=float(design.get("air_flow_m3_per_min", 123.0)),
                pw_d=float(design.get("fan_power_kw", 11.0)),
                actual_head=head,
                kr=resistance,
            )
        )
    return tuple(built)


def _valves(topology: Topology, equipment: Mapping[str, Any]) -> dict[str, Any]:
    built = {}
    for valve in topology.valves:
        entry = equipment[valve.equipment]
        built[valve.id] = pv.Valve(
            cv_max=float(entry.get("cv_max", 800.0)),
            r=float(entry.get("rangeability", 100.0)),
        )
    return built


# --- wiring ---------------------------------------------------------------------------


def _roster(topology: Topology) -> Roster:
    """Which pump each chiller runs with, from the links rather than from its position.

    The reference assumes pump `i` serves chiller `i` and clamps the index past the end,
    so a standby pump borrows a chiller's resistance without anything saying so. The
    topology records these links explicitly, marked `inferred` where they were assumed,
    and a pump with no partner is a header pump.
    """

    def ids(family: DeviceFamily) -> tuple[str, ...]:
        return tuple(device.id for device in topology.devices_of(family))

    return Roster(
        chillers=ids(DeviceFamily.CHILLER),
        cooling_towers=ids(DeviceFamily.COOLING_TOWER),
        pumps={family: ids(family) for family in PUMP_FAMILIES},
        paired={family: topology.paired_pumps(family) for family in PUMP_FAMILIES},
    )


def _chilled_header(
    topology: Topology,
    physics: Mapping[str, Any],
    pumps: Sequence[Any],
    valves: Mapping[str, Any],
    terminal: Any,
) -> Header:
    # The evaporator's own pressure drop is NOT added here, and that needs saying because
    # the reference appears to add it: it writes
    # `kr_pipe + getattr(chillers[min(i, n - 1)], "kr_ch", 0.0)`. But `kr_ch` belongs to
    # the engine's air-source heat pump, not to `Chiller`, so the default fires every
    # time and the term is always zero. The exchanger drop is therefore inside whatever
    # branch resistance was fitted against measurements — adding it now would count it
    # twice. `Chiller.dp_ch_d` is there if a future model wants it explicitly, but that
    # has to come with a refit rather than on its own.
    pipe = float(_at(physics, "hydraulics.chw_pump_branch.kr_pipe", 0.30))
    sources = tuple(pv.BranchW(pump=pump, kr_pipe=pipe) for pump in pumps)

    terminal_branch = pv.BranchW(
        valve=valves.get("terminal_valve"),
        kr_eq=float(getattr(terminal, "kr", 0.08)),
        kr_pipe=float(_at(physics, "hydraulics.terminal_branch.kr_pipe", 0.05)),
    )
    bypass = pv.BranchW(
        valve=valves.get("chw_bypass"),
        kr_eq=float(_at(physics, "hydraulics.chw_bypass_branch.kr_eq", 0.0)),
        kr_pipe=float(_at(physics, "hydraulics.chw_bypass_branch.kr_pipe", 0.80)),
    )
    return Header(
        sources=sources,
        sinks=(terminal_branch, bypass),
        source_devices=tuple(
            d.id for d in topology.devices_of(DeviceFamily.CHILLED_WATER_PUMP)
        ),
        sink_names=("terminal", "chw_bypass"),
    )


def _condenser_header(
    topology: Topology,
    physics: Mapping[str, Any],
    pumps: Sequence[Any],
    towers: Sequence[Any],
    valves: Mapping[str, Any],
) -> Header:
    # As on the chilled side, the condenser's own drop is absorbed into the fitted branch
    # resistance rather than added: the reference's `kr_cd` lookup is inert for the same
    # reason.
    pipe = float(_at(physics, "hydraulics.cw_pump_branch.kr_pipe", 1.00))
    sources = tuple(pv.BranchW(pump=pump, kr_pipe=pipe) for pump in pumps)

    tower_devices = topology.devices_of(DeviceFamily.COOLING_TOWER)
    tower_eq = float(_at(physics, "hydraulics.tower_branch.kr_eq", 0.0))
    tower_pipe = float(_at(physics, "hydraulics.tower_branch.kr_pipe", 0.15))
    tower_branches = tuple(
        pv.BranchW(
            valve=valves.get(f"{device.id}_cw"),
            # The tower's own resistance is in series with the branch pipework.
            kr_eq=tower_eq + float(getattr(tower, "kr", 1.0)),
            kr_pipe=tower_pipe,
            actual_head=float(getattr(tower, "actual_head", 2.0)),
        )
        for device, tower in zip(tower_devices, towers)
    )
    bypass = pv.BranchW(
        valve=valves.get("cw_bypass"),
        kr_eq=float(_at(physics, "hydraulics.cw_bypass_branch.kr_eq", 0.0)),
        kr_pipe=float(_at(physics, "hydraulics.cw_bypass_branch.kr_pipe", 0.80)),
    )
    return Header(
        sources=sources,
        sinks=tower_branches + (bypass,),
        source_devices=tuple(d.id for d in topology.devices_of(DeviceFamily.COOLING_WATER_PUMP)),
        sink_names=tuple(d.id for d in tower_devices) + ("cw_bypass",),
    )


# --- what the controller needs ----------------------------------------------------------


def _layout(topology: Topology) -> PlantLayout:
    def duty(family: DeviceFamily) -> int:
        return sum(1 for d in topology.devices_of(family) if not d.is_standby)

    counts = topology.counts()
    return PlantLayout(
        chillers=counts[DeviceFamily.CHILLER],
        chilled_water_pumps=counts[DeviceFamily.CHILLED_WATER_PUMP],
        chilled_water_pumps_duty=duty(DeviceFamily.CHILLED_WATER_PUMP),
        cooling_water_pumps=counts[DeviceFamily.COOLING_WATER_PUMP],
        cooling_water_pumps_duty=duty(DeviceFamily.COOLING_WATER_PUMP),
        cooling_towers=counts[DeviceFamily.COOLING_TOWER],
    )


def _ratings(chillers: Sequence[Any]) -> MachineRatings:
    """The staging thresholds are relative to one machine, so they come from the engine.

    Taken from the first chiller, as the reference does. A plant of mixed machines would
    need this per group, which is a topology family this product does not yet assemble.
    """
    if not chillers:
        raise PlantBuildError("a plant needs at least one chiller")
    first = chillers[0]
    return MachineRatings(
        chiller_capacity_kw=float(getattr(first, "q_ch_d", 0.0)),
        chiller_chilled_flow_m3_per_min=float(getattr(first, "g_ch_d", 0.0)),
        chiller_condenser_flow_m3_per_min=float(getattr(first, "g_cd_d", 0.0)),
    )


def _at(mapping: Mapping[str, Any], path: str, default: Any) -> Any:
    node: Any = mapping
    for part in path.split("."):
        if not isinstance(node, Mapping) or part not in node:
            return default
        node = node[part]
    return node
