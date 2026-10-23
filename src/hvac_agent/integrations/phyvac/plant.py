"""One control step of a whole plant: the seven stages, coupled.

Everything before this module does part of a step. `builder` assembles the machines,
`hydraulics` closes a header, `simulation.baseline` decides what to run. This is where
they become a simulation: boundary conditions, a control decision, the hydraulic
closure, the machines, the mixing nodes, the temperature dynamics, and an observation.

    1  boundary      wet bulb from dry bulb and humidity; the flow the load asks for
    2  control       the baseline policy around whatever is held by hand, then which
                     machines run, from the topology's wiring
    3  hydraulics    one bisection per header — the only iteration in the step
    4  machines      chillers, towers and pumps, each from the engine
    5  mixing        streams join in proportion to their flow
    6  dynamics      a condenser loop does not reach steady state in ten minutes
    7  observation   about a hundred points, named as the site's vocabulary names them

**Inlet temperatures lag one step, explicitly.** A chiller's condenser inlet is the
temperature the towers produced during the previous step, not one solved simultaneously
with it. The upstream engine's own examples are built this way and so is the reference,
and at a ten-minute step the lag is smaller than the transport delay it stands in for.
Saying so here matters because it is the one place where the plant's arithmetic is not
what a steady-state reading of the diagram would suggest.

**What is not modelled.** The terminal is one lumped load, not air handlers. There is no
thermal storage, no free cooling and no heat recovery, which is what confines this to the
one topology family. A machine is either on or off within a step; nothing models the
minute or two a chiller takes to come up.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from datetime import datetime, timedelta
from typing import Any, Mapping, Sequence

from hvac_agent.core.actions import RUNNING_STATE_METRIC, Action, ControlMode
from hvac_agent.core.metrics import DeviceFamily, SiteMetrics, point_name, split_point
from hvac_agent.core.observation import Observation, Origin, Quality, build_observation
from hvac_agent.core.site import SiteDefinition
from hvac_agent.core.units import (
    BASE_FREQUENCY_HZ,
    m3_per_min_to_m3_per_h,
    water_flow_m3_per_min,
    water_heat_flow_kw,
)
from hvac_agent.integrations.phyvac import vendor as pv
from hvac_agent.integrations.phyvac.builder import Plant, build_plant
from hvac_agent.integrations.phyvac.hydraulics import mix_temperature, solve_header
from hvac_agent.simulation.baseline import BaselineController, Conditions
from hvac_agent.simulation.dispatch import (
    Forced,
    available_chillers,
    available_towers,
    chiller_order,
    dispatch,
)
from hvac_agent.simulation.run import PlantInputs

__all__ = ["OperatingEnvelopeError", "PhyvacPlant", "PlantState"]

_CHW_SETPOINT = "chilled_water_temp_set"
_FREQUENCY_SETPOINT = "frequency_setpoint"


@dataclass(slots=True)
class PlantState:
    """What one step hands to the next.

    Small on purpose. Everything here is either a temperature that cannot change
    instantly or a flow the next step's controller needs in order to decide.
    """

    chilled_water_supply_temp_c: float
    chilled_water_return_temp_c: float
    condenser_water_supply_temp_c: float
    condenser_water_return_temp_c: float
    chilled_flow_per_chiller_m3_per_min: tuple[float, ...] = ()
    terminal_flow_m3_per_min: float = 0.0
    chilled_flow_m3_per_min: float = 0.0
    condenser_flow_m3_per_min: float = 0.0
    chillers_running: int = 0


class PhyvacPlant:
    """A plant that satisfies the run's `PlantEngine` protocol.

    Built from a site definition, so the same class is every site in the family.
    """

    def __init__(self, site: SiteDefinition, *, step_minutes: float = 10.0) -> None:
        self.site = site
        self.step_minutes = float(step_minutes)

        self.plant: Plant = build_plant(site)
        self.metrics = SiteMetrics.from_device_ids(
            [device.id for family in DeviceFamily for device in site.topology.devices_of(family)]
        )

        # Engine objects by device ID. The builder assembles them in topology order, and
        # that order says nothing else: a device is found by its ID, never by its place in
        # a list or by the number at the end of its name. Reordering topology.yaml must
        # not move a correction from one machine to another.
        self._machines: dict[str, Any] = {}
        for family, machines in (
            (DeviceFamily.CHILLER, self.plant.chillers),
            (DeviceFamily.CHILLED_WATER_PUMP, self.plant.chilled_water_pumps),
            (DeviceFamily.COOLING_WATER_PUMP, self.plant.cooling_water_pumps),
            (DeviceFamily.COOLING_TOWER, self.plant.cooling_towers),
        ):
            self._machines.update(zip(self.plant.device_ids[family], machines, strict=True))
        # Which machine each isolation valve belongs to, from where the topology says it
        # sits rather than from how it is named.
        self._isolation_valves = {
            valve.id: valve.at.name
            for valve in site.topology.valves
            if valve.at is not None and valve.at.name in self._machines
        }
        # What each commandable point was asked for in the last step, after corrections,
        # keyed by point name. This is the request; what a machine actually did is read
        # back from the engine.
        self._requested: dict[str, float] = {}

        boundary = site.boundary
        self._nominal_delta_t_c = float(
            boundary.get("terminal", {}).get("nominal_delta_t_c", 5.0)
        )
        self._heat_rejection_ratio = float(boundary.get("heat_rejection_ratio", 1.25))
        self._zero_load_rise_c = float(boundary.get("zero_load_return_temp_rise_c", 0.3))

        self.controller = BaselineController(
            site.control,
            self.plant.layout,
            self.plant.ratings,
            step_minutes=self.step_minutes,
            heat_rejection_ratio=self._heat_rejection_ratio,
        )

        physics = site.resolved_physics()
        self._dynamics = physics.get("condenser_dynamics", {})
        self._envelope = physics.get("operating_envelope", {})

        control = site.control
        self._frequency_limits = control.get("frequency_limits_hz", {})
        pid = control.get("pid", {}).get("terminal_valve", {})
        self._terminal_pid = pv.PID(kp=float(pid.get("kp", 0.04)), ti=float(pid.get("ti", 400.0)))
        self._min_valve_opening = float(
            control.get("tower_fan", {}).get("min_valve_opening", 0.65)
        )

        setpoints = control.get("setpoints", {})
        self._cw_bypass_target_kpa = float(setpoints.get("cw_bypass_dp_kpa", 150.0))
        self._chw_bypass_target_kpa = float(setpoints.get("chw_bypass_dp_kpa", 150.0))
        self._chw_bypass_opening = 1.0
        self._cw_bypass_opening = 1.0
        self._chw_bypass_opening_last_dp = 0.0
        self._cw_bypass_opening_last_dp = 0.0

        self._run_id: str | None = None
        self._step_index = 0
        self._now: datetime | None = None
        self._state = self._initial_state()
        self._last: Observation | None = None

    # --- the engine protocol -------------------------------------------------------------

    def reset(self, start: datetime) -> Observation:
        """A plant at rest: nothing running, water at its configured initial temperatures."""
        self.controller.reset()
        self._terminal_pid = pv.PID(
            kp=self._terminal_pid.kp, ti=self._terminal_pid.ti
        )
        self._step_index = 0
        self._now = start
        self._chw_bypass_opening = 1.0
        self._cw_bypass_opening = 1.0
        self._chw_bypass_opening_last_dp = 0.0
        self._cw_bypass_opening_last_dp = 0.0
        self._state = self._initial_state()
        self._requested = {}
        # At rest means at rest in the engine too: feedback is read from the inverters,
        # so a stopped plant must not carry the engine's constructor defaults.
        for machine in self._machines.values():
            if hasattr(machine, "inv"):
                machine.inv = 0.0
        self._last = self._observe_state(chiller_power=(), pump_power=(), tower_power=())
        return self._last

    def step(self, inputs: PlantInputs, action: Action | None = None) -> Observation:
        if self._now is None:
            raise RuntimeError("call reset() before step()")

        # 1 — boundary conditions.
        wet_bulb_c = float(pv.tdb_rh2twb(inputs.dry_bulb_temp_c, inputs.relative_humidity_percent))
        required_flow = (
            water_flow_m3_per_min(inputs.cooling_load_kw, self._nominal_delta_t_c)
            if inputs.cooling_load_kw > 0.0
            else 0.0
        )

        # 2 — control. Machines started or stopped by hand are read first, because the
        # baseline stages around them: one stopped by hand is not available to it, and one
        # started by hand counts towards what it stages.
        roster = self.plant.roster
        forced = _forced(action)
        order = chiller_order(roster, forced)
        chillers_available = available_chillers(roster, forced)
        towers_available = available_towers(roster, forced)
        last_flow = dict(
            zip(self.plant.device_ids[DeviceFamily.CHILLER],
                self._state.chilled_flow_per_chiller_m3_per_min)
        )
        command = self.controller.step(
            Conditions(
                cooling_load_kw=inputs.cooling_load_kw,
                required_flow_m3_per_min=required_flow,
                chilled_water_return_temp_c=self._state.chilled_water_return_temp_c,
                condenser_return_temp_c=self._state.condenser_water_return_temp_c,
                wet_bulb_temp_c=wet_bulb_c,
                # The baseline decides per slot; `order` says which chiller each slot is.
                chilled_flow_per_chiller_m3_per_min=tuple(
                    last_flow.get(device, 0.0) for device in order
                ),
                chilled_flow_m3_per_min=self._state.chilled_flow_m3_per_min,
                condenser_flow_m3_per_min=self._state.condenser_flow_m3_per_min,
                chillers_available=len(chillers_available) if forced.off else None,
                chillers_forced_on=sum(1 for c in chillers_available if c in forced.on),
                cooling_towers_available=len(towers_available) if forced.off else None,
                cooling_towers_forced_on=sum(1 for t in towers_available if t in forced.on),
            ),
            self._step_index,
        )
        # Which machines, not merely how many: the topology decides which pump runs with
        # which chiller.
        running = dispatch(command, roster, forced)
        self._apply(command, action, required_flow, running, order)

        # 3 — hydraulics, one bisection per header.
        chilled_header = self.plant.chilled_header
        condenser_header = self.plant.condenser_header
        chilled = solve_header(
            [
                branch if device in running else None
                for device, branch in zip(chilled_header.source_devices, chilled_header.sources)
            ],
            list(chilled_header.sinks),
        )
        condenser = solve_header(
            [
                branch if device in running else None
                for device, branch in zip(
                    condenser_header.source_devices, condenser_header.sources
                )
            ],
            [
                # A tower draws only while it runs; the bypass is never shut.
                branch if name in running or name not in self._machines else None
                for name, branch in zip(condenser_header.sink_names, condenser_header.sinks)
            ],
        )

        terminal_flow = chilled.sink_flows[0]
        chilled_bypass_flow = chilled.sink_flows[1]
        chillers = self.plant.device_ids[DeviceFamily.CHILLER]
        chiller_count = sum(1 for device in chillers if device in running)
        chilled_through, chilled_passing = self._through_chillers(
            DeviceFamily.CHILLED_WATER_PUMP, chilled_header, chilled, running
        )
        condenser_through, condenser_passing = self._through_chillers(
            DeviceFamily.COOLING_WATER_PUMP, condenser_header, condenser, running
        )

        # 4 — machines. The condenser inlet is last step's tower outlet: see the module
        # docstring on the one-step lag.
        chiller_power: list[float] = []
        outlet_c: list[float] = []
        outlet_flows: list[float] = []
        condenser_outlet_c: list[float] = []
        condenser_flows: list[float] = []
        # What each chiller actually removed this step, from the engine's own inlet and
        # outlet, and whatever the engine flagged about how it got there.
        removed: dict[str, float] = {}
        flags: dict[str, tuple[int, ...]] = {}
        # The water either side of each machine during this step, which is what its own
        # temperature points report. The loop's mixed temperatures are the SYSTEM points.
        evaporators: dict[str, _Water] = {}
        condensers: dict[str, _Water] = {}
        # Chillers told to run that have no water on one side or both, and which.
        starved: dict[str, tuple[str, ...]] = {}
        chilled_inlet_c = self._state.chilled_water_return_temp_c
        condenser_inlet_c = self._state.condenser_water_supply_temp_c
        for device in chillers:
            flow = chilled_through.get(device, 0.0)
            condenser_flow = condenser_through.get(device, 0.0)
            if device not in running or flow <= 0.0 or condenser_flow <= 0.0:
                chiller_power.append(0.0)
                # A chiller needs water on both sides to cool: without evaporator flow
                # there is nothing to cool, and without condenser flow nowhere for the
                # heat to go. One running without either removes nothing.
                if device in running:
                    starved[device] = tuple(
                        part
                        for part, moving in (("evaporator", flow), ("condenser", condenser_flow))
                        if moving <= 0.0
                    )
                # A pump started by hand beside a stopped chiller still moves water
                # through it. Nothing is cooled, but the stream joins the header at the
                # temperature it arrived with, and leaving it out of the mixing would
                # lose that water from the balance.
                evaporators[device] = _Water.unchanged(chilled_inlet_c, flowing=flow > 0.0)
                condensers[device] = _Water.unchanged(
                    condenser_inlet_c, flowing=condenser_flow > 0.0
                )
                if flow > 0.0:
                    outlet_c.append(chilled_inlet_c)
                    outlet_flows.append(flow)
                if condenser_flow > 0.0:
                    condenser_outlet_c.append(condenser_inlet_c)
                    condenser_flows.append(condenser_flow)
                continue
            chiller = self._machines[device]
            chiller.cal(
                tout_ch_sp=self._requested[point_name(device, _CHW_SETPOINT)],
                tin_ch=chilled_inlet_c,
                g_ch=flow,
                tin_cd=condenser_inlet_c,
                g_cd=condenser_flow,
            )
            chiller_power.append(float(chiller.pw))
            removed[device] = max(0.0, float(chiller.q_ch))
            if codes := _engine_flags(chiller):
                flags[device] = codes
            if removed[device] > 0.0:
                evaporators[device] = _Water(chilled_inlet_c, float(chiller.tout_ch))
                condensers[device] = _Water(condenser_inlet_c, float(chiller.tout_cd))
            else:
                # A chiller that removes nothing leaves the water as it found it. The
                # engine still sets its outlet to the setpoint, warmer than the inlet when
                # it raises flag 5, and leaves its condenser outlet at the last value it
                # computed; mixing either in would add heat that no machine put there.
                evaporators[device] = _Water.unchanged(chilled_inlet_c)
                condensers[device] = _Water.unchanged(condenser_inlet_c)
            outlet_c.append(evaporators[device].outlet_c)
            outlet_flows.append(flow)
            condenser_outlet_c.append(condensers[device].outlet_c)
            condenser_flows.append(condenser_flow)
        # Water a header pump moves with no header chiller running to receive it passes
        # through uncooled, for the same reason.
        if chilled_passing > 0.0:
            outlet_c.append(chilled_inlet_c)
            outlet_flows.append(chilled_passing)
        if condenser_passing > 0.0:
            condenser_outlet_c.append(condenser_inlet_c)
            condenser_flows.append(condenser_passing)

        condenser_return_c = mix_temperature(
            condenser_outlet_c,
            condenser_flows,
            fallback=self._state.condenser_water_return_temp_c,
        )

        tower_power: list[float] = []
        # Two lists, and they are not the same length on purpose: the mixing node sees
        # only the streams that are actually flowing, while the observation reports every
        # tower including the stopped ones.
        tower_outlet_c: list[float] = []
        running_tower_flows: list[float] = []
        tower_flows: list[float] = []
        towers: dict[str, _Water] = {}
        tower_sink_flows = dict(zip(condenser_header.sink_names, condenser.sink_flows))
        for device in self.plant.device_ids[DeviceFamily.COOLING_TOWER]:
            tower = self._machines[device]
            flow = tower_sink_flows[device]
            if device not in running or flow <= 0.0:
                tower_power.append(0.0)
                tower_flows.append(0.0)
                towers[device] = _Water.unchanged(condenser_return_c, flowing=False)
                continue
            tower.cal(
                g_w=flow,
                tin_w=condenser_return_c,
                tdb=inputs.dry_bulb_temp_c,
                rh=inputs.relative_humidity_percent,
            )
            tower_power.append(float(tower.pw))
            towers[device] = _Water(condenser_return_c, float(tower.tout_w))
            tower_outlet_c.append(float(tower.tout_w))
            running_tower_flows.append(flow)
            tower_flows.append(flow)

        pump_power = self._pump_power(chilled, condenser)
        towers_running = any(
            device in running for device in self.plant.device_ids[DeviceFamily.COOLING_TOWER]
        )

        # 5 — mixing.
        chilled_supply_c = mix_temperature(
            outlet_c,
            outlet_flows,
            fallback=self._state.chilled_water_supply_temp_c,
        )
        condenser_supply_c = mix_temperature(
            tower_outlet_c,
            running_tower_flows,
            fallback=self._state.condenser_water_supply_temp_c,
        )

        # 6 — dynamics, then the return temperature the terminal produces.
        condenser_supply_c = self._damp(
            condenser_supply_c,
            self._state.condenser_water_supply_temp_c,
            rise="supply_max_rise_c_per_10min",
            drop="supply_max_drop_c_per_10min",
            alpha="supply_alpha",
            running=towers_running,
        )
        condenser_return_c = self._damp(
            condenser_return_c,
            self._state.condenser_water_return_temp_c,
            rise="return_max_rise_c_per_10min",
            drop="return_max_drop_c_per_10min",
            alpha="return_alpha",
            running=towers_running,
        )

        # The return the chillers will see next step is not the terminal's return: the
        # bypass puts supply water straight back into it. Leaving this node out makes the
        # chillers see a return that is too warm, so they are asked for a duty the load
        # never called for and the whole loop climbs.
        terminal_return_c = self._terminal_return(
            chilled_supply_c, terminal_flow, inputs.cooling_load_kw
        )
        chilled_return_c = mix_temperature(
            [terminal_return_c, chilled_supply_c],
            [terminal_flow, chilled_bypass_flow],
            fallback=terminal_return_c,
        )

        # Three quantities the reference reports as one. The demand is what the building
        # asked for; the chillers removed what the engine says they did; the terminal put
        # its heat into the water whether or not anything took it out again. When the
        # chillers fall short the difference stays in the loop and warms it.
        balance = _Balance(
            demand_kw=max(0.0, inputs.cooling_load_kw),
            removed_kw=sum(removed.values()),
            absorbed_kw=(
                water_heat_flow_kw(terminal_flow, terminal_return_c - chilled_supply_c)
                if terminal_flow > 1e-9
                else 0.0
            ),
        )
        # Each chiller's own outlets as well as the mixed loop: a machine on a trickle of
        # water can leave the range its performance data covers while the mix does not.
        self._check_envelope(
            {
                "chilled-water supply": chilled_supply_c,
                "chilled-water return": chilled_return_c,
                **{
                    f"{device} evaporator outlet": water.outlet_c
                    for device, water in evaporators.items()
                    if device in removed
                },
            },
            {
                "condenser-water supply": condenser_supply_c,
                "condenser-water return": condenser_return_c,
                **{
                    f"{device} condenser outlet": water.outlet_c
                    for device, water in condensers.items()
                    if device in removed
                },
            },
            balance,
        )

        # 7 — record the new state and report it.
        self._state = PlantState(
            chilled_water_supply_temp_c=chilled_supply_c,
            chilled_water_return_temp_c=chilled_return_c,
            condenser_water_supply_temp_c=condenser_supply_c,
            condenser_water_return_temp_c=condenser_return_c,
            chilled_flow_per_chiller_m3_per_min=tuple(
                chilled_through.get(device, 0.0) for device in chillers
            ),
            terminal_flow_m3_per_min=terminal_flow,
            chilled_flow_m3_per_min=chilled.total_source_flow,
            condenser_flow_m3_per_min=condenser.total_source_flow,
            chillers_running=chiller_count,
        )
        self._chw_bypass_opening_last_dp = chilled.delta_p_kpa
        self._cw_bypass_opening_last_dp = condenser.delta_p_kpa
        self._step_index += 1
        self._now = self._now + timedelta(minutes=self.step_minutes)
        self._last = self._observe_state(
            chiller_power=chiller_power,
            pump_power=pump_power,
            tower_power=tower_power,
            running=running,
            forced=forced,
            removed=removed,
            flags=flags,
            starved=starved,
            water={**evaporators, **towers},
            condensers=condensers,
            balance=balance,
            inputs=inputs,
            wet_bulb_c=wet_bulb_c,
            chilled=chilled,
            condenser=condenser,
            tower_flows=tower_flows,
        )
        return self._last

    def observe(self) -> Observation:
        """The last state reported, unchanged. Reading does not advance anything."""
        if self._last is None:
            raise RuntimeError("call reset() before observe()")
        return self._last

    def bind_run(self, run_id: str) -> None:
        """Name the run whose observations this plant is producing."""
        self._run_id = run_id

    # --- stages, in pieces ----------------------------------------------------------------

    def _initial_state(self) -> PlantState:
        # Physics, not display: these are the inlet temperatures the first step's
        # chillers see. `calibration/display.yaml` promises never to change a flow, a
        # temperature or a power, and reading initial conditions from it broke that.
        initial = self.site.resolved_physics().get("initial_conditions", {})
        return PlantState(
            chilled_water_supply_temp_c=float(initial.get("chw_supply_temp_c", 8.0)),
            chilled_water_return_temp_c=float(initial.get("chw_return_temp_c", 12.0)),
            condenser_water_supply_temp_c=float(initial.get("cw_supply_temp_c", 28.0)),
            condenser_water_return_temp_c=float(initial.get("cw_return_temp_c", 32.0)),
            chilled_flow_per_chiller_m3_per_min=tuple(
                0.0 for _ in self.site.topology.devices_of(DeviceFamily.CHILLER)
            ),
        )

    def _apply(
        self,
        command: Any,
        action: Action | None,
        required_flow: float,
        running: frozenset[str],
        order: Sequence[str],
    ) -> None:
        """Put the command onto the machines, with any correction on top.

        A manual action names only the points it changes; everything else keeps what the
        baseline decided. That is what makes a single correction to one machine
        distinguishable from a command to hold every other point where it is. Running
        states set by hand have already shaped `running`; the rest land here.

        The baseline commands one speed per pump family, but the request is spread onto
        every pump individually before a correction is laid over it. Storing it per family
        meant a correction to one pump moved every running pump of that family. Its
        chilled-water setpoints are per slot, and `order` says which chiller each slot is.

        Raises:
            ValueError: if the action names a point this plant cannot act on. Accepting
                a command and doing nothing with it would record a correction that never
                happened.
        """
        ids = self.plant.device_ids
        requested: dict[str, float] = {}
        for device, setpoint in zip(order, command.chilled_water_supply_setpoints_c, strict=True):
            requested[point_name(device, _CHW_SETPOINT)] = setpoint
        for family, hz in (
            (DeviceFamily.CHILLED_WATER_PUMP, command.chilled_water_pump_hz),
            (DeviceFamily.COOLING_WATER_PUMP, command.cooling_water_pump_hz),
            (DeviceFamily.COOLING_TOWER, command.tower_fan_hz),
        ):
            for device in ids[family]:
                # A machine started by hand while the baseline runs none of its family
                # has no speed from the baseline; it starts at its family's minimum.
                speed = self._limit(family, 0.0) if device in running and hz <= 0.0 else hz
                requested[point_name(device, _FREQUENCY_SETPOINT)] = speed

        if action is not None and action.mode is ControlMode.MANUAL:
            unhandled = sorted(
                point
                for point in action.setpoints
                if point not in requested and not point.endswith(f":{RUNNING_STATE_METRIC}")
            )
            if unhandled:
                raise ValueError(f"this plant cannot act on {unhandled}")
            requested.update(
                (point, value)
                for point, value in action.setpoints.items()
                if point in requested
            )
        self._requested = requested

        # Which pumps run was settled by `dispatch`, from the pairing in the topology; a
        # stopped machine's inverter is zero so that its feedback says so.
        for family in (
            DeviceFamily.CHILLED_WATER_PUMP,
            DeviceFamily.COOLING_WATER_PUMP,
            DeviceFamily.COOLING_TOWER,
        ):
            for device in ids[family]:
                hz = requested[point_name(device, _FREQUENCY_SETPOINT)]
                self._machines[device].inv = hz / BASE_FREQUENCY_HZ if device in running else 0.0

        self._set_valves(required_flow, running)

    def _set_valves(self, required_flow: float, running: frozenset[str]) -> None:
        """Open what should be open and close what should not.

        The terminal valve is the only one modulated, by the engine's own PI controller
        with the site's gains, because the terminal is what decides how much water the
        plant is asked for. Isolation valves are open or shut with their machine, which
        is how they are operated.
        """
        any_chiller = any(
            device in running for device in self.plant.device_ids[DeviceFamily.CHILLER]
        )
        terminal = self.plant.valves.get("terminal_valve")
        if terminal is not None:
            if required_flow <= 0.0 or not any_chiller:
                terminal.vlv = 0.0
            else:
                moved = self._terminal_pid.control(
                    sp=required_flow, mv=max(self._state.terminal_flow_m3_per_min, 1e-6)
                )
                terminal.vlv = _clamp(max(moved, 0.35), 0.0, 1.0)

        for valve_id, device in self._isolation_valves.items():
            self.plant.valves[valve_id].vlv = 1.0 if device in running else 0.0

        # The bypasses hold the header pressure down. Each one opens further when the
        # last step's pressure came out above its target and closes when it came out
        # below, which is how the plant itself runs them; using the previous step's
        # pressure is the same explicit lag as everywhere else, because this step's
        # pressure is what the valve position is about to decide.
        #
        # A bypass is never fully shut. A header nothing draws from has no determinate
        # pressure, and the solver refuses that rather than guessing at it.
        for name, target, attribute in (
            ("chw_bypass", self._chw_bypass_target_kpa, "_chw_bypass_opening"),
            ("cw_bypass", self._cw_bypass_target_kpa, "_cw_bypass_opening"),
        ):
            valve = self.plant.valves.get(name)
            if valve is None:
                continue
            if not any_chiller:
                setattr(self, attribute, 1.0)
            else:
                measured = getattr(self, f"{attribute}_last_dp")
                moved = getattr(self, attribute) + 0.5 * (measured - target) / max(target, 1.0)
                setattr(self, attribute, _clamp(moved, 0.05, 1.0))
            valve.vlv = getattr(self, attribute)

    def _through_chillers(
        self,
        family: DeviceFamily,
        header: Any,
        balance: Any,
        running: frozenset[str],
    ) -> tuple[dict[str, float], float]:
        """The flow through each chiller on one side, from the pump feeding it.

        A pump is in series with its paired chiller, so that chiller carries exactly what
        its pump delivers — whether or not the chiller itself is running, since a pump
        started by hand moves water through a stopped machine. Header pumps feed a common
        pool, shared equally among the running chillers that have no pump of their own.
        With every pump at one speed this is the equal share the plant used before; with
        a pump corrected faster or held at its highest head, the machine behind it
        carries more or less accordingly.

        Returns:
            Flow per chiller, and whatever the header pumps moved with no running header
            chiller to receive it, which passes through uncooled.
        """
        roster = self.plant.roster
        by_pump = dict(zip(header.source_devices, balance.source_flows))
        paired = roster.paired[family]
        unpaired = [d for d in roster.chillers if d in running and d not in paired]
        pooled = sum(by_pump.get(pump, 0.0) for pump in roster.header_pumps(family))

        flows: dict[str, float] = {}
        for device in roster.chillers:
            own = paired.get(device)
            if own is not None:
                if by_pump.get(own, 0.0) > 0.0:
                    flows[device] = by_pump[own]
            elif device in unpaired:
                flows[device] = pooled / len(unpaired)
        return flows, (0.0 if unpaired else pooled)

    def _pump_power(self, chilled: Any, condenser: Any) -> list[float]:
        power: list[float] = []
        for flows, pumps in (
            (chilled.source_flows, self.plant.chilled_water_pumps),
            (condenser.source_flows, self.plant.cooling_water_pumps),
        ):
            for index, pump in enumerate(pumps):
                if flows[index] <= 0.0:
                    power.append(0.0)
                    continue
                pump.f2p(flows[index])
                pump.cal()
                power.append(float(pump.pw))
        return power

    def _damp(
        self, target: float, previous: float, *, rise: str, drop: str, alpha: str, running: bool
    ) -> float:
        """A first-order lag and a per-step limit on how far a temperature may move.

        A condenser loop holds enough water that ten minutes does not take it to steady
        state, and without this a plant that has just started its towers reports a step
        change no real loop could make.
        """
        if not self._dynamics.get("enabled", False):
            return target

        scale = self.step_minutes / 10.0
        blended = previous + float(self._dynamics.get(alpha, 0.3)) * (target - previous)
        if not running:
            limit = float(self._dynamics.get("no_tower_max_rise_c_per_10min", 3.0)) * scale
            return min(blended, previous + limit)

        up = float(self._dynamics.get(rise, 6.0)) * scale
        down = float(self._dynamics.get(drop, 4.0)) * scale
        return _clamp(blended, previous - down, previous + up)

    def _terminal_return(
        self, supply_c: float, flow_m3_per_min: float, load_kw: float
    ) -> float:
        """What comes back from the building.

        With water moving, the rise follows from the load it absorbed. With none, the
        water sitting in the pipework drifts up by a configured amount rather than
        staying at supply temperature forever.
        """
        if flow_m3_per_min <= 1e-9:
            return self._state.chilled_water_return_temp_c + self._zero_load_rise_c
        if load_kw <= 0.0:
            return supply_c + self._zero_load_rise_c
        per_kelvin_kw = water_heat_flow_kw(flow_m3_per_min, 1.0)
        return supply_c + load_kw / max(per_kelvin_kw, 1e-9)

    def _limit(self, family: DeviceFamily, wanted: float) -> float:
        bounds = self._frequency_limits.get(str(family), {})
        return _clamp(wanted, float(bounds.get("min", 0.0)), float(bounds.get("max", 50.0)))

    # --- the observation --------------------------------------------------------------------

    def _observe_state(
        self,
        *,
        chiller_power: Sequence[float],
        pump_power: Sequence[float],
        tower_power: Sequence[float],
        running: frozenset[str] = frozenset(),
        forced: Forced = Forced(),
        removed: Mapping[str, float] | None = None,
        flags: Mapping[str, tuple[int, ...]] | None = None,
        starved: Mapping[str, tuple[str, ...]] | None = None,
        water: Mapping[str, _Water] | None = None,
        condensers: Mapping[str, _Water] | None = None,
        balance: _Balance | None = None,
        inputs: PlantInputs | None = None,
        wet_bulb_c: float = 0.0,
        chilled: Any = None,
        condenser: Any = None,
        tower_flows: Sequence[float] = (),
    ) -> Observation:
        """Assemble the point values the site's vocabulary expects.

        `water` is the water through each chiller's evaporator and each tower during the
        step, and `condensers` through each chiller's condenser.
        """
        state = self._state
        values: dict[str, float] = {}
        removed = removed or {}
        flags = flags or {}
        starved = starved or {}
        water = water or {}
        condensers = condensers or {}
        quality: dict[str, Quality] = {}
        standing: dict[str, list[str]] = {}

        def report(device: str, through: _Water, inlet: str, outlet: str, part: str) -> None:
            # Each machine's own inlet and outlet. With nothing flowing there is no
            # machine reading to give; the header water it stands in is the best figure,
            # and it is flagged as that.
            values[point_name(device, inlet)] = through.inlet_c
            values[point_name(device, outlet)] = through.outlet_c
            if not through.flowing:
                quality[point_name(device, inlet)] = Quality.UNCERTAIN
                quality[point_name(device, outlet)] = Quality.UNCERTAIN
                standing.setdefault(device, []).append(part)

        # A machine that took no part in a step, as at reset, stands in the header water.
        idle_evaporator = _Water.unchanged(state.chilled_water_return_temp_c, flowing=False)
        idle_condenser = _Water.unchanged(state.condenser_water_supply_temp_c, flowing=False)
        idle_tower = _Water.unchanged(state.condenser_water_return_temp_c, flowing=False)
        balance = balance or _Balance(demand_kw=0.0, removed_kw=0.0, absorbed_kw=0.0)

        chillers = self.plant.device_ids[DeviceFamily.CHILLER]
        for index, device in enumerate(chillers):
            values[point_name(device, RUNNING_STATE_METRIC)] = 1.0 if device in running else 0.0
            values[point_name(device, "total_active_power")] = _at(chiller_power, index)
            values[point_name(device, _CHW_SETPOINT)] = self._requested.get(
                point_name(device, _CHW_SETPOINT), state.chilled_water_supply_temp_c
            )
            report(
                device,
                water.get(device, idle_evaporator),
                "evaporator_inlet_temp",
                "evaporator_outlet_temp",
                "evaporator",
            )
            report(
                device,
                condensers.get(device, idle_condenser),
                "condenser_inlet_temp",
                "condenser_outlet_temp",
                "condenser",
            )
            flow = _at(state.chilled_flow_per_chiller_m3_per_min, index)
            values[point_name(device, "plant_chw_current_flow")] = m3_per_min_to_m3_per_h(flow)
            # What the engine says this machine removed, against its own rating. This was
            # once reconstructed from the loop temperatures, and the return temperature
            # is derived from the demand, so a chiller at capacity reported the demand.
            duty = removed.get(device, 0.0)
            rated = float(getattr(self._machines[device], "q_ch_d", 0.0))
            values[point_name(device, "plant_chw_current_cooling")] = duty
            values[point_name(device, "operating_load_percentage")] = (
                100.0 * duty / rated if rated > 0 else 0.0
            )

        # A setpoint is what was asked for, after any correction; feedback is what the
        # machine's inverter is actually running at, read from the engine. They are
        # separate points so that a correction accepted but not achieved shows as one.
        offset = 0
        for family in (DeviceFamily.CHILLED_WATER_PUMP, DeviceFamily.COOLING_WATER_PUMP):
            for index, device in enumerate(self.plant.device_ids[family]):
                on = device in running
                values[point_name(device, RUNNING_STATE_METRIC)] = 1.0 if on else 0.0
                values[point_name(device, "total_active_power")] = _at(pump_power, offset + index)
                values.update(self._frequencies(device, on))
            offset += len(self.plant.device_ids[family])

        for index, device in enumerate(self.plant.device_ids[DeviceFamily.COOLING_TOWER]):
            on = device in running
            values[point_name(device, RUNNING_STATE_METRIC)] = 1.0 if on else 0.0
            values[point_name(device, "total_active_power")] = _at(tower_power, index)
            values.update(self._frequencies(device, on))
            # A tower takes in the condenser return and gives back its own outlet, which
            # is not the mixed supply when the towers run differently.
            report(
                device,
                water.get(device, idle_tower),
                "ctwr_temp",
                "ctws_temp",
                "tower",
            )
            values[point_name(device, "ctw_current_flow")] = m3_per_min_to_m3_per_h(
                _at(tower_flows, index)
            )

        chilled_flow = sum(state.chilled_flow_per_chiller_m3_per_min)
        delta_t = state.chilled_water_return_temp_c - state.chilled_water_supply_temp_c
        condenser_delta_t = (
            state.condenser_water_return_temp_c - state.condenser_water_supply_temp_c
        )
        values.update(
            {
                "SYSTEM:outdoor_temperature": inputs.dry_bulb_temp_c if inputs else 0.0,
                "SYSTEM:outdoor_humidity": inputs.relative_humidity_percent if inputs else 0.0,
                "SYSTEM:wet_bulb_temperature": wet_bulb_c,
                "SYSTEM:wet_bulb_temperature_approach": (
                    state.condenser_water_supply_temp_c - wet_bulb_c
                ),
                "SYSTEM:terminal_current_flow": m3_per_min_to_m3_per_h(
                    state.terminal_flow_m3_per_min
                ),
                "SYSTEM:terminal_current_cooling": max(0.0, balance.absorbed_kw),
                "SYSTEM:cooling_demand": balance.demand_kw,
                "SYSTEM:cooling_unmet": balance.unmet_kw,
                "SYSTEM:chw_loop_heat_accumulation": balance.accumulation_kw,
                "SYSTEM:chws_main_temp": state.chilled_water_supply_temp_c,
                "SYSTEM:chwr_main_temp": state.chilled_water_return_temp_c,
                "SYSTEM:chw_main_temp_diff": delta_t,
                "SYSTEM:chw_main_current_flow": m3_per_min_to_m3_per_h(chilled_flow),
                "SYSTEM:chw_main_current_cooling": balance.removed_kw,
                "SYSTEM:cws_main_temp": state.condenser_water_supply_temp_c,
                "SYSTEM:cwr_main_temp": state.condenser_water_return_temp_c,
                "SYSTEM:cw_main_temp_diff": condenser_delta_t,
                "SYSTEM:cw_main_current_flow": m3_per_min_to_m3_per_h(sum(tower_flows)),
                "SYSTEM:cw_main_current_cooling": max(
                    0.0, water_heat_flow_kw(sum(tower_flows), condenser_delta_t)
                ),
                "SYSTEM:chw_bypass_opening": _opening(self.plant.valves.get("chw_bypass")),
                "SYSTEM:cw_bypass_opening": _opening(self.plant.valves.get("cw_bypass")),
            }
        )
        values.update(self._gauge_pressures(chilled, condenser, chilled_flow, tower_flows))

        # A chiller the engine flagged was computed outside what its data supports, or
        # by a rule standing in for behaviour the engine does not model. Its output is
        # still the engine's best figure, so it is reported, but not as a good one.
        notes: list[str] = []
        for device, codes in sorted(flags.items()):
            for metric in _FLAGGED_METRICS:
                quality[point_name(device, metric)] = Quality.UNCERTAIN
            quality["SYSTEM:chw_main_current_cooling"] = Quality.UNCERTAIN
            for code in codes:
                reason = _ENGINE_FLAGS.get(code, f"flagged by the engine with code {code}")
                notes.append(f"{device}: {reason}")
        # A chiller told to run with no water on a side cannot cool, and the model says
        # nothing about how a real one would protect itself; its zero is the model's.
        for device, parts in sorted(starved.items()):
            for metric in _FLAGGED_METRICS:
                quality[point_name(device, metric)] = Quality.UNCERTAIN
            reason = (
                "nowhere to reject its heat"
                if parts == ("condenser",)
                else "no water to cool"
            )
            notes.append(
                f"{device}: told to run with no water through its {' and '.join(parts)}, so "
                f"it has {reason} and removes nothing; a real machine would trip"
            )
        # A machine started by hand that is not running could not be: its own pump is
        # stopped, or no header pump is free. Saying so is the difference between a
        # command that failed and one that was ignored.
        for device in sorted(forced.on - running):
            notes.append(
                f"{device}: started by hand but cannot run; there is no pump free to move "
                "its water"
            )
        # A running pump the others overpower: shut behind its check valve, or on the
        # rising part of its curve, where a real pump hunts. Both are what the curves give,
        # but its power is not a figure to rely on in either.
        for header, balance_of in (
            (self.plant.chilled_header, chilled),
            (self.plant.condenser_header, condenser),
        ):
            if balance_of is None:
                continue
            for index, (device, flow) in enumerate(
                zip(header.source_devices, balance_of.source_flows)
            ):
                if device not in running:
                    continue
                if index in balance_of.rising:
                    quality[point_name(device, "total_active_power")] = Quality.UNCERTAIN
                    notes.append(
                        f"{device}: overpowered by the faster pumps beside it, running below "
                        "the flow of its highest head, where a real pump is unstable"
                    )
                elif flow <= 0.0:
                    quality[point_name(device, "total_active_power")] = Quality.UNCERTAIN
                    notes.append(
                        f"{device}: running but delivering nothing; the faster pumps beside "
                        "it hold its check valve shut, and its power at shutoff is not "
                        "modelled"
                    )
        for device, parts in sorted(standing.items()):
            where = "it" if parts == ["tower"] else "its " + " and ".join(parts)
            notes.append(
                f"{device}: no water is moving through {where}; its temperatures there are "
                "the header water it stands in, not a reading of the machine"
            )
        if balance.unmet_kw > 0.0:
            notes.append(
                f"{balance.unmet_kw:.0f} kW of the {balance.demand_kw:.0f} kW demand was not "
                "removed; it stays in the chilled-water loop and warms it"
            )

        return build_observation(
            self.metrics,
            timestamp=self._now,
            origin=Origin.SIMULATED,
            config_revision=self.site.config_revision,
            run_id=self._run_id or "unbound",
            values=values,
            quality=quality,
            notes=tuple(notes),
        )

    def _check_envelope(
        self,
        chilled: Mapping[str, float],
        condenser: Mapping[str, float],
        balance: _Balance,
    ) -> None:
        """Refuse a state the model cannot describe, before it is recorded.

        Raises:
            OperatingEnvelopeError: naming the temperature, its limit, and what the plant
                was being asked for when it got there.
        """
        envelope = self._envelope
        for readings, key in ((chilled, "chilled_water_c"), (condenser, "condenser_water_c")):
            bounds = envelope.get(key, {})
            low, high = float(bounds.get("min", -1e9)), float(bounds.get("max", 1e9))
            for name, value in readings.items():
                if low <= value <= high:
                    continue
                raise OperatingEnvelopeError(
                    f"{name} would reach {value:.1f} C, outside the {low:g} to {high:g} C "
                    f"this model is valid for (operating_envelope.{key} in "
                    f"calibration/physics.yaml). The chillers removed "
                    f"{balance.removed_kw:.0f} kW against a demand of "
                    f"{balance.demand_kw:.0f} kW; results past this point would not "
                    f"describe a plant."
                )

    def _frequencies(self, device: str, running: bool) -> dict[str, float]:
        setpoint = point_name(device, _FREQUENCY_SETPOINT)
        return {
            setpoint: self._requested.get(setpoint, 0.0) if running else 0.0,
            point_name(device, "frequency_feedback"): (
                float(self._machines[device].inv) * BASE_FREQUENCY_HZ
            ),
        }

    def _gauge_pressures(
        self, chilled: Any, condenser: Any, chilled_flow: float, tower_flows: Sequence[float]
    ) -> dict[str, float]:
        """Header pressures as a gauge on site would read them.

        The solver produces differences; the gauges read against a datum nobody recorded.
        This mapping is fitted, which is why it lives in `calibration/display.yaml` and
        why changing it can never change a flow or a temperature.
        """
        mapping = self.site.resolved_display().get("pressure_mapping", {})
        chilled_dp = chilled.delta_p_kpa if chilled else 0.0
        condenser_dp = condenser.delta_p_kpa if condenser else 0.0
        condenser_flow = sum(tower_flows)

        chilled_return = float(mapping.get("chw_return_base_kpa", 350.0)) + float(
            mapping.get("chw_return_flow_kpa_per_g2", 0.0)
        ) * chilled_flow**2
        condenser_return = float(mapping.get("cw_return_base_kpa", 1240.0)) + float(
            mapping.get("cw_return_flow_kpa_per_g2", 0.0)
        ) * condenser_flow**2

        return {
            "SYSTEM:chwr_main_pressure": chilled_return,
            "SYSTEM:chws_main_pressure": chilled_return
            + float(mapping.get("chw_dp_gain", 0.56)) * chilled_dp,
            "SYSTEM:cwr_main_pressure": condenser_return,
            "SYSTEM:cws_main_pressure": condenser_return
            + float(mapping.get("cw_dp_gain", 2.94)) * condenser_dp,
        }


class OperatingEnvelopeError(RuntimeError):
    """Raised when a step would take the plant outside the range the model describes.

    Not a numerical failure: the engine would go on producing numbers. They would not be a
    plant's, so the run stops here and says why instead of recording them.
    """


@dataclass(frozen=True, slots=True)
class _Balance:
    """One step's heat, kept as the three things it is."""

    demand_kw: float
    """What the building asked for."""
    removed_kw: float
    """What the chillers took out of the water, from the engine."""
    absorbed_kw: float
    """What the terminal put into the water."""

    @property
    def unmet_kw(self) -> float:
        """Demand the chillers did not remove. Zero within rounding, not merely close to it:
        a shortfall of 1e-13 kW is arithmetic, and reporting it would raise a note on
        every balanced step."""
        shortfall = self.demand_kw - self.removed_kw
        return shortfall if shortfall > 1e-6 * max(self.demand_kw, 1.0) else 0.0

    @property
    def accumulation_kw(self) -> float:
        """Heat left in the chilled-water loop this step; negative while it cools down."""
        return self.absorbed_kw - self.removed_kw


@dataclass(frozen=True, slots=True)
class _Water:
    """The water either side of one machine during one step."""

    inlet_c: float
    outlet_c: float
    flowing: bool = True
    """False when nothing moves through it, so both sides are the header water it stands
    in rather than anything the machine did."""

    @classmethod
    def unchanged(cls, temperature_c: float, *, flowing: bool = True) -> _Water:
        """Water a machine leaves as it found it."""
        return cls(temperature_c, temperature_c, flowing)


# The points of a chiller whose values depend on how the engine computed it.
_FLAGGED_METRICS = ("total_active_power", "plant_chw_current_cooling", "operating_load_percentage")

# What the engine's `Chiller.flag` codes mean, in words an operator can act on.
_ENGINE_FLAGS = {
    1: "overloaded: asked for more than its rated capacity, so its output is capped at "
    "rating and its outlet runs warmer than its setpoint",
    2: "below the lowest part load in its performance table; efficiency taken from the "
    "table's edge",
    3: "condenser water colder than its performance table covers; efficiency taken from "
    "the table's edge",
    4: "condenser water warmer than its performance table covers; efficiency taken from "
    "the table's edge",
    5: "asked for a supply warmer than its return, which the engine does not model: it "
    "reports no cooling and no power, and the water passes through unchanged",
    6: "no usable efficiency in its performance table at this point; the engine "
    "substituted the table's lowest",
}


def _forced(action: Action | None) -> Forced:
    """The machines an action in force starts or stops by hand."""
    if action is None or action.mode is not ControlMode.MANUAL:
        return Forced()
    on: set[str] = set()
    off: set[str] = set()
    for point, value in action.setpoints.items():
        device, metric = split_point(point)
        if metric == RUNNING_STATE_METRIC:
            (on if value >= 0.5 else off).add(device)
    return Forced(on=frozenset(on), off=frozenset(off))


def _engine_flags(chiller: Any) -> tuple[int, ...]:
    """Everything the engine did to a chiller that its data does not support.

    `Chiller.flag` holds one code, and the engine overwrites it within a single `cal`: an
    overloaded machine is flagged 1, then its condenser temperature is checked and a table
    edge there replaces the 1 with a 3 or 4. So overload is read from its effect instead —
    the engine raises the outlet above setpoint only when it caps the output at rating.
    """
    codes: list[int] = []
    if float(chiller.tout_ch) > float(chiller.tout_ch_sp) + 1e-9:
        codes.append(1)
    if chiller.flag and chiller.flag != 1:
        codes.append(int(chiller.flag))
    return tuple(codes)


def _clamp(value: float, low: float, high: float) -> float:
    return max(low, min(high, value))


def _at(values: Sequence[float], index: int, default: float = 0.0) -> float:
    return float(values[index]) if index < len(values) else default


def _opening(valve: Any) -> float:
    return float(getattr(valve, "vlv", 0.0)) if valve is not None else 0.0
