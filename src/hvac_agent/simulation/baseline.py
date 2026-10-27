"""The baseline controller: what the plant does when no agent is driving it.

This is a model of the site's own PLC — how many chillers to run, how many pumps and
towers with them, what chilled-water temperature to ask for, and how fast to turn the
tower fans. It is the thing an agent's proposals get compared against, so it has to be
recognisably the plant's existing practice rather than our idea of good control.

**It touches no physics.** Numbers in, numbers out: nothing here imports the engine,
constructs a plant or knows what a branch is. In the reference implementation the same
logic lives on the plant class, reads machine objects through `getattr` and mutates
instance state as it goes, so exercising a staging rule means building and stepping a
whole plant. Here a staging decision is a function call, which is why this module's tests
run in milliseconds and cover the cases a plant would rarely reach.

**Its thresholds are configuration, not literals.** The rules are taken from the
reference site, including the arbitrary parts, but every constant that was buried in the
code is named here and carried in `control.yaml`. Two in particular were invisible
before: the factor that decides when the last chiller stops, and the weights on the two
tower-fan trims. Naming them does not make them right — it makes them reviewable.

**Staging generalises to any number of machines.** The reference version is written for
exactly two chillers (`cur == 1` implies `want = 2`) and exactly two towers (`return 2 if
frac >= thr else 1`). The rules here reduce to those at two and keep working at five.
"""

from __future__ import annotations

import math
from dataclasses import dataclass
from typing import Any, Mapping, Sequence

from hvac_agent.core.metrics import DeviceFamily
from hvac_agent.core.units import BASE_FREQUENCY_HZ, water_heat_flow_kw

__all__ = [
    "BaselineController",
    "Command",
    "Conditions",
    "MachineRatings",
    "PlantLayout",
    "StagingState",
    "stage_count",
]


@dataclass(frozen=True, slots=True)
class PlantLayout:
    """How many machines there are, and how many of each are duty rather than standby.

    Comes from the topology: a device with `role: standby` is not counted as duty.
    """

    chillers: int
    chilled_water_pumps: int
    chilled_water_pumps_duty: int
    cooling_water_pumps: int
    cooling_water_pumps_duty: int
    cooling_towers: int

    def __post_init__(self) -> None:
        for name in ("chillers", "chilled_water_pumps", "cooling_water_pumps", "cooling_towers"):
            if getattr(self, name) < 1:
                raise ValueError(f"{name} must be at least 1, got {getattr(self, name)}")
        if self.chilled_water_pumps_duty > self.chilled_water_pumps:
            raise ValueError("more duty chilled-water pumps than pumps")
        if self.cooling_water_pumps_duty > self.cooling_water_pumps:
            raise ValueError("more duty cooling-water pumps than pumps")


@dataclass(frozen=True, slots=True)
class MachineRatings:
    """One machine's nameplate figures, which the staging thresholds are relative to."""

    chiller_capacity_kw: float
    chiller_chilled_flow_m3_per_min: float
    chiller_condenser_flow_m3_per_min: float


@dataclass(frozen=True, slots=True)
class Conditions:
    """What the controller sees at the start of a step.

    `chilled_flow_per_chiller_m3_per_min` is last step's flow through each machine,
    including zeros for the ones that were off. The controller needs it to know what
    supply temperature is actually reachable, not merely desirable.
    """

    cooling_load_kw: float
    required_flow_m3_per_min: float
    chilled_water_return_temp_c: float
    condenser_return_temp_c: float
    wet_bulb_temp_c: float
    chilled_flow_per_chiller_m3_per_min: Sequence[float] = ()
    # Last step's measured header flows. The pump-speed loops need what the plant is
    # actually moving, not what it was last asked to move.
    chilled_flow_m3_per_min: float = 0.0
    condenser_flow_m3_per_min: float = 0.0
    # Machines set by hand. `None` available means all of them. A machine stopped by hand
    # is not available to stage; one started by hand counts towards the staged number and
    # cannot be staged off. Nothing set by hand leaves the baseline exactly as it was.
    chillers_available: int | None = None
    chillers_forced_on: int = 0
    cooling_towers_available: int | None = None
    cooling_towers_forced_on: int = 0


@dataclass(frozen=True, slots=True)
class Command:
    """What the baseline asks the plant to do this step."""

    chillers_running: int
    chilled_water_pumps_running: int
    cooling_water_pumps_running: int
    cooling_towers_running: int
    chilled_water_supply_setpoints_c: tuple[float, ...]
    tower_fan_hz: float
    heat_rejection_estimate_kw: float
    chilled_water_pump_hz: float = 0.0
    cooling_water_pump_hz: float = 0.0


class _VelocityPI:
    """A velocity-form PI controller, matching the one inside the engine.

    Re-implemented rather than imported: this module decides, and deciding must not
    require a plant. The algorithm is the engine's, including its two unusual parts —
    there is no derivative term, and the change per step is hard-limited to 0.05 of the
    output range. That limit is why the reference plants' gains look so small and why
    their loops take twenty minutes to settle; reproducing it is the difference between
    a baseline that behaves like the site's and one that merely aims at the same place.

    The integral resets after `reset_after` consecutive steps of same-signed error, which
    is the engine's way of shedding wind-up when a target cannot be reached at all.
    """

    MAX_CHANGE = 0.05

    def __init__(
        self,
        kp: float,
        ti: float,
        *,
        minimum: float = 0.0,
        maximum: float = 1.0,
        reset_after: int = 30,
    ) -> None:
        self.kp = float(kp)
        self.ti = float(ti)
        self.minimum = float(minimum)
        self.maximum = float(maximum)
        self._reset_after = int(reset_after)
        self.output = 0.0
        self._integral = 0.0
        self._same_sign = 0

    def reset(self) -> None:
        self.output = 0.0
        self._integral = 0.0
        self._same_sign = 0

    def control(self, setpoint: float, measured: float) -> float:
        error = setpoint - measured
        self._integral += error
        change = self.kp * (error + self._integral / max(self.ti, 1e-9))
        change = _clamp(change, -self.MAX_CHANGE, self.MAX_CHANGE)
        self.output = _clamp(self.output + change, self.minimum, self.maximum)

        if error > 0:
            self._same_sign = max(1, self._same_sign + 1)
        elif error < 0:
            self._same_sign = min(-1, self._same_sign - 1)
        else:
            self._same_sign = 0
        if abs(self._same_sign) >= self._reset_after:
            self._integral = 0.0
            self._same_sign = 0
        return self.output


@dataclass(slots=True)
class StagingState:
    """What the controller has to remember between steps.

    How many machines are running, when that last changed, and what change is currently
    being asked for and for how long. Keeping it in a small mutable object rather than
    scattered across the plant is what lets a test put the controller into any history it
    likes and check one decision.
    """

    running: int = 0
    last_change_step: int = -10_000
    pending: int | None = None
    pending_steps: int = 0

    def steps_since_change(self, step_index: int) -> int:
        return step_index - self.last_change_step


def stage_count(
    *,
    running: int,
    demand_units: float,
    unit_count: int,
    up_at: float,
    down_at: float,
    last_unit_shutdown_factor: float,
) -> int:
    """How many machines the load calls for, ignoring any minimum switch interval.

    `demand_units` is the demand measured in whole machines: a load of 1.4 means one and
    a bit machines' worth. Thresholds are per machine, so `n` running stage up once
    demand passes `n * up_at` and stage down once it falls below `(n - 1) * down_at`.
    At two machines that is exactly the reference site's rule.

    The gap between those two is what stops the count oscillating. Because `down_at` is
    below `up_at`, the level that would add the n-th machine is always above the level
    that would remove it, so no steady demand can sit on both sides at once.

    The last machine is the exception, since `(n - 1) * down_at` is zero at one machine
    and would keep it running on any load at all. The reference stops it below
    `0.5 * down_at`; that factor is `last_unit_shutdown_factor` here. Setting it to zero
    means the last machine stops only when the load does.
    """
    if unit_count < 1:
        raise ValueError(f"unit_count must be at least 1, got {unit_count}")
    running = max(0, min(running, unit_count))

    if demand_units <= 0.0:
        return 0
    if running <= 0:
        return 1

    if demand_units >= running * up_at:
        return min(running + 1, unit_count)
    if running >= 2:
        return running - 1 if demand_units < (running - 1) * down_at else running
    return 0 if demand_units < down_at * last_unit_shutdown_factor else 1


class BaselineController:
    """The site's own control practice, driven by `control.yaml`.

    One instance per run. `reset()` returns it to its initial state; nothing else mutates
    it except `step`, and the only mutation is the staging history.
    """

    def __init__(
        self,
        control: Mapping[str, Any],
        layout: PlantLayout,
        ratings: MachineRatings,
        *,
        step_minutes: float,
        heat_rejection_ratio: float,
    ) -> None:
        if step_minutes <= 0.0:
            raise ValueError(f"step_minutes must be positive, got {step_minutes}")

        self._layout = layout
        self._ratings = ratings
        self._step_minutes = float(step_minutes)
        self._heat_rejection_ratio = float(heat_rejection_ratio)

        staging = control.get("staging", {})
        self._chiller_staging = staging.get("chiller", {})
        self._pump_staging = staging.get("chilled_water_pump_pri", {})
        self._tower_staging = staging.get("cooling_towers", {})
        self._tower_confirm_steps = int(self._tower_staging.get("confirm_steps", 1))

        setpoints = control.get("setpoints", {})
        bounds = setpoints.get("chw_supply_temp_c", {})
        self._supply_min_c = float(bounds.get("min", 7.0))
        self._supply_max_c = float(bounds.get("max", 12.0))
        self._min_evaporator_delta_t_c = float(setpoints.get("min_evaporator_delta_t_c", 0.15))

        self._tower_fan = control.get("tower_fan", {})
        self._frequency_limits = control.get("frequency_limits_hz", {})
        limits = self._frequency_limits.get("cooling_towers", {})
        self._tower_min_hz = float(limits.get("min", 25.0))
        self._tower_max_hz = float(limits.get("max", 50.0))

        protection = control.get("protection", {})
        self._chiller_hold_steps = self._as_steps(
            protection.get("chiller_min_switch_interval_minutes", 30.0)
        )
        self._tower_hold_steps = self._as_steps(
            protection.get("cooling_tower_min_switch_interval_minutes", 0.0)
        )

        pid = control.get("pid", {})
        self._chilled_pump_pi = self._speed_loop(
            pid.get("chilled_water_pump", {}), DeviceFamily.CHILLED_WATER_PUMP
        )
        self._condenser_pump_pi = self._speed_loop(
            pid.get("cooling_water_pump", {}), DeviceFamily.COOLING_WATER_PUMP
        )

        self.chillers = StagingState()
        self.towers = StagingState()
        self._supply_setpoints_c = tuple(
            self._supply_max_c for _ in range(layout.chillers)
        )

    def _speed_loop(self, gains: Mapping[str, Any], family: DeviceFamily) -> _VelocityPI:
        limits = self._limits_for(family)
        return _VelocityPI(
            kp=float(gains.get("kp", 0.01)),
            ti=float(gains.get("ti", 400.0)),
            minimum=limits[0] / BASE_FREQUENCY_HZ,
            maximum=limits[1] / BASE_FREQUENCY_HZ,
        )

    def _limits_for(self, family: DeviceFamily) -> tuple[float, float]:
        entry = self._frequency_limits.get(str(family), {})
        return float(entry.get("min", 30.0)), float(entry.get("max", 50.0))

    def _as_steps(self, minutes: float) -> int:
        """A hold expressed in minutes, as whole steps.

        Always at least one step: a hold shorter than the step length still means the
        machine may not change twice in a row.
        """
        return max(1, round(float(minutes) / self._step_minutes))

    def reset(self) -> None:
        self._chilled_pump_pi.reset()
        self._condenser_pump_pi.reset()
        self.chillers = StagingState()
        self.towers = StagingState()
        self._supply_setpoints_c = tuple(
            self._supply_max_c for _ in range(self._layout.chillers)
        )

    # --- the step ---------------------------------------------------------------------

    def step(self, conditions: Conditions, step_index: int) -> Command:
        """Decide what the plant should do, given what it is being asked for."""
        chillers = self._by_hand(
            self.chillers,
            self._stage_chillers(conditions, step_index),
            available=conditions.chillers_available,
            forced_on=conditions.chillers_forced_on,
            step_index=step_index,
        )
        heat_rejection_kw = max(0.0, conditions.cooling_load_kw) * self._heat_rejection_ratio

        pumps = self._pumps_running(conditions, chillers)
        towers = self._by_hand(
            self.towers,
            self._stage_towers(heat_rejection_kw, chillers, step_index, conditions),
            available=conditions.cooling_towers_available,
            forced_on=conditions.cooling_towers_forced_on,
            step_index=step_index,
        )

        self._supply_setpoints_c = self._supply_setpoints(conditions, chillers)
        fan_hz = (
            self._tower_fan_hz(heat_rejection_kw, conditions) if towers > 0 else 0.0
        )

        return Command(
            chillers_running=chillers,
            chilled_water_pump_hz=self._pump_speed_hz(
                self._chilled_pump_pi,
                DeviceFamily.CHILLED_WATER_PUMP,
                # Slightly above what the load asks for, so the terminal valve has
                # authority left rather than sitting wide open.
                target=conditions.required_flow_m3_per_min * 1.02,
                measured=conditions.chilled_flow_m3_per_min,
                running=pumps,
            ),
            cooling_water_pump_hz=self._pump_speed_hz(
                self._condenser_pump_pi,
                DeviceFamily.COOLING_WATER_PUMP,
                # The condenser side has no flow demand of its own; it follows the
                # machines, at the fraction of design flow the site runs them at.
                target=chillers
                * self._ratings.chiller_condenser_flow_m3_per_min
                * float(self._pump_staging.get("condenser_flow_fraction", 0.65)),
                measured=conditions.condenser_flow_m3_per_min,
                running=min(pumps, self._layout.cooling_water_pumps),
            ),
            # The condenser side follows the chilled side, machine for machine, which is
            # how the reference site runs and what its pairing of pump n to chiller n
            # assumes.
            chilled_water_pumps_running=pumps,
            cooling_water_pumps_running=min(pumps, self._layout.cooling_water_pumps),
            cooling_towers_running=towers,
            chilled_water_supply_setpoints_c=self._supply_setpoints_c,
            tower_fan_hz=fan_hz,
            heat_rejection_estimate_kw=heat_rejection_kw if chillers > 0 else 0.0,
        )

    # --- staging ----------------------------------------------------------------------

    def _by_hand(
        self,
        state: StagingState,
        staged: int,
        *,
        available: int | None,
        forced_on: int,
        step_index: int,
    ) -> int:
        """The staged count, adjusted for machines started or stopped by hand.

        Never fewer than were started by hand, never more than are available. A change
        made here is recorded as the latest change, so the baseline's own switch interval
        runs from it; the change itself is not held to that interval, because a person
        made it.
        """
        count = max(staged, forced_on)
        if available is not None:
            count = min(count, available)
        if count != state.running:
            state.running = count
            state.last_change_step = step_index
            state.pending, state.pending_steps = None, 0
        return count

    def _stage_chillers(self, conditions: Conditions, step_index: int) -> int:
        # Demand is whichever of duty and flow asks for more. A plant can be short of
        # capacity or short of flow, and either one calls for another machine.
        units = (
            self._layout.chillers
            if conditions.chillers_available is None
            else conditions.chillers_available
        )
        if units <= 0:
            return 0
        by_load = conditions.cooling_load_kw / max(self._ratings.chiller_capacity_kw, 1e-9)
        by_flow = conditions.required_flow_m3_per_min / max(
            self._ratings.chiller_chilled_flow_m3_per_min, 1e-9
        )
        wanted = stage_count(
            running=self.chillers.running,
            demand_units=max(by_load, by_flow),
            unit_count=units,
            up_at=float(self._chiller_staging.get("up_at_fraction_of_rated", 0.82)),
            down_at=float(self._chiller_staging.get("down_at_fraction_of_rated", 0.45)),
            last_unit_shutdown_factor=float(
                self._chiller_staging.get("last_unit_shutdown_factor", 0.5)
            ),
        )
        return self._hold(
            self.chillers, wanted, step_index, self._chiller_hold_steps,
            int(self._chiller_staging.get("confirm_steps", 1)),
        )

    def _stage_towers(
        self, heat_rejection_kw: float, chillers: int, step_index: int, conditions: Conditions
    ) -> int:
        units = (
            self._layout.cooling_towers
            if conditions.cooling_towers_available is None
            else conditions.cooling_towers_available
        )
        if chillers <= 0 or heat_rejection_kw <= 0.0 or units <= 0:
            return self._hold(
                self.towers, 0, step_index, self._tower_hold_steps, self._tower_confirm_steps
            )

        # Rejected heat as a fraction of what one chiller's worth of towers handles.
        capacity_kw = self._ratings.chiller_capacity_kw * self._heat_rejection_ratio
        fraction = heat_rejection_kw / max(capacity_kw, 1e-9)
        threshold = float(self._tower_staging.get("up_at_fraction_of_design", 0.42))

        # One tower, plus one more for each further threshold crossed. At two towers and
        # the reference threshold this is exactly its "two if above 0.42, else one".
        wanted = min(units, 1 + int(math.floor(fraction / max(threshold, 1e-9))))
        return self._hold(
            self.towers, wanted, step_index, self._tower_hold_steps, self._tower_confirm_steps
        )

    def _hold(
        self,
        state: StagingState,
        wanted: int,
        step_index: int,
        hold_steps: int,
        confirm_steps: int,
    ) -> int:
        """Let a staging decision through only once it has earned it.

        Two separate protections, and they answer different problems:

        `confirm_steps` requires the demand to keep asking for the change, so a single
        step of noisy load does not start a machine.

        `hold_steps` is the minimum time between two changes of the same machine, which
        is the plant's own protection. Modelling it matters: without it a simulation will
        happily start and stop a chiller every ten minutes and report the saving.
        """
        if wanted == state.running:
            state.pending, state.pending_steps = None, 0
            return state.running

        # Starting the first machine is not a marginal staging decision, so it does not
        # wait to be confirmed. Making it wait is not conservatism: the auxiliaries stage
        # on the chillers, so a confirm window on the first tower leaves the condenser
        # pumps running into nothing for as many steps as the window is long, which is a
        # state with no hydraulic solution rather than a cautious one.
        if state.running == 0 and wanted > 0:
            confirm_steps = 1

        if state.pending == wanted:
            state.pending_steps += 1
        else:
            state.pending, state.pending_steps = wanted, 1

        if (
            state.pending_steps >= confirm_steps
            and state.steps_since_change(step_index) >= hold_steps
        ):
            state.running = wanted
            state.last_change_step = step_index
            state.pending, state.pending_steps = None, 0
        return state.running

    def _pumps_running(self, conditions: Conditions, chillers: int) -> int:
        """Pumps follow the chillers, never dropping below the duty count.

        The reference runs `max(duty, staged)` whenever any chiller is on, so the duty
        count is a floor rather than a target. Reproduced, because the plant's pressure
        and its terminal valve authority are set around it.
        """
        if chillers <= 0 or conditions.required_flow_m3_per_min <= 0.0:
            return 0
        by_flow = conditions.required_flow_m3_per_min / max(
            self._ratings.chiller_chilled_flow_m3_per_min, 1e-9
        )
        staged = stage_count(
            running=chillers,
            demand_units=by_flow,
            unit_count=self._layout.chilled_water_pumps,
            up_at=float(self._pump_staging.get("up_at_fraction_of_design", 0.90)),
            down_at=float(self._pump_staging.get("down_at_fraction_of_design", 0.60)),
            last_unit_shutdown_factor=0.0,
        )
        return max(self._layout.chilled_water_pumps_duty, staged)

    def _pump_speed_hz(
        self,
        loop: _VelocityPI,
        family: DeviceFamily,
        *,
        target: float,
        measured: float,
        running: int,
    ) -> float:
        """How fast to run the pumps that are in service.

        Without this the pumps run flat out whenever they run, which is what the first
        version of this controller did: comparison against the reference plant showed the
        same staging and the same delivered cooling, but 43% more water moved and 71%
        more energy over a day. A variable-speed pump that is never varied is most of a
        chiller plant's avoidable consumption.
        """
        if running <= 0 or target <= 0.0:
            loop.reset()
            return 0.0
        return loop.control(target, measured) * BASE_FREQUENCY_HZ

    # --- setpoints --------------------------------------------------------------------

    def _supply_setpoints(self, conditions: Conditions, chillers: int) -> tuple[float, ...]:
        """Chilled-water supply temperature per machine: load reset, capped by hydraulics.

        Two things decide it. A load reset raises the setpoint as the plant unloads,
        because a warmer supply costs the chiller less. Against that, the temperature has
        to be one the flow can actually deliver: with a given flow through a machine, the
        outlet follows from the duty it is asked for, and asking for something colder than
        that achieves nothing.

        The hard floor is the return temperature less `min_evaporator_delta_t_c`. Without
        it a setpoint can land above the return temperature, which asks the machine for
        negative cooling — the defect this rule exists to prevent in the reference.
        """
        if chillers <= 0 or conditions.cooling_load_kw <= 0.0:
            return tuple(
                self._supply_max_c if index < chillers else self._supply_setpoints_c[index]
                for index in range(self._layout.chillers)
            )

        return_temp = conditions.chilled_water_return_temp_c
        reachable_cap = return_temp - self._min_evaporator_delta_t_c

        running_capacity = max(chillers * self._ratings.chiller_capacity_kw, 1.0)
        load_fraction = _clamp(conditions.cooling_load_kw / running_capacity, 0.0, 1.0)
        reset_temp = self._supply_min_c + (self._supply_max_c - self._supply_min_c) * (
            1.0 - load_fraction
        )
        share_kw = conditions.cooling_load_kw / chillers

        setpoints: list[float] = []
        for index in range(self._layout.chillers):
            if index >= chillers:
                setpoints.append(self._supply_setpoints_c[index])
                continue

            flow = _at(conditions.chilled_flow_per_chiller_m3_per_min, index, 0.0)
            if flow > 1e-9 and return_temp > self._supply_min_c + self._min_evaporator_delta_t_c:
                # Heat carried per kelvin at this flow, so the drop the duty implies.
                per_kelvin_kw = water_heat_flow_kw(flow, 1.0)
                reachable = return_temp - share_kw / max(per_kelvin_kw, 1e-9)
                target = reset_temp if reachable > reset_temp else reachable
                setpoints.append(_clamp(target, self._supply_min_c, reachable_cap))
            else:
                setpoints.append(
                    _clamp(reset_temp, self._supply_min_c, min(self._supply_max_c, reachable_cap))
                )
        return tuple(setpoints)

    def _tower_fan_hz(self, heat_rejection_kw: float, conditions: Conditions) -> float:
        """Tower fan speed from estimated rejected heat, raised by two trims.

        There is no measured heat-rejection signal to follow, so the baseline estimates it
        from the cooling load and an assumed COP. The two trims then push the fans harder
        when the condenser is running hot or the wet bulb is high, both of which mean the
        towers are struggling to hold their approach.

        The trim weights were bare literals in the reference. They are configuration here,
        with its values as the defaults.
        """
        fan = self._tower_fan
        assumed_cop = float(fan.get("assumed_cop_for_heat_rejection", 5.0))
        capacity_kw = self._ratings.chiller_capacity_kw * (1.0 + 1.0 / max(assumed_cop, 1e-9))
        ratio = _clamp(heat_rejection_kw / max(capacity_kw, 1.0), 0.0, 1.0)

        minimum = self._tower_min_hz / BASE_FREQUENCY_HZ
        maximum = self._tower_max_hz / BASE_FREQUENCY_HZ
        inverter = minimum + (maximum - minimum) * ratio

        trim = fan.get("return_temp_trim", {})
        if trim.get("enabled", True):
            inverter += _trim(
                inverter,
                maximum,
                value=conditions.condenser_return_temp_c,
                start=float(trim.get("start_c", 38.5)),
                full=float(trim.get("full_c", 43.0)),
                weight=float(trim.get("weight", 0.35)),
            )

        trim = fan.get("wet_bulb_trim", {})
        if trim.get("enabled", True):
            inverter += _trim(
                inverter,
                maximum,
                value=conditions.wet_bulb_temp_c,
                start=float(trim.get("reference_c", 28.0)),
                full=float(trim.get("high_c", 32.0)),
                weight=float(trim.get("weight", 0.2)),
            )

        return _clamp(inverter * BASE_FREQUENCY_HZ, self._tower_min_hz, self._tower_max_hz)


def _trim(
    inverter: float, maximum: float, *, value: float, start: float, full: float, weight: float
) -> float:
    """How much of the remaining headroom a trim takes up."""
    if value <= start:
        return 0.0
    severity = _clamp((value - start) / max(full - start, 1e-9), 0.0, 1.0)
    return (maximum - inverter) * severity * weight


def _clamp(value: float, low: float, high: float) -> float:
    return max(low, min(high, value))


def _at(values: Sequence[float], index: int, default: float) -> float:
    return float(values[index]) if index < len(values) else default
