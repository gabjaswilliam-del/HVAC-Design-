"""The baseline controller, tested without building a plant.

That is the point of the module and so it is the point of this file: every case below is
numbers in and numbers out. In the reference implementation the same logic lives on the
plant class and reads its machines through `getattr`, so checking what happens when the
load hovers on a staging threshold means building a plant, stepping it, and arranging for
the physics to produce that load. None of these tests do any of that, which is why they
can walk a hundred steps of demand in a millisecond and reach states a plant would need
a bad day to arrive at.

The configuration is the shipped example, so a threshold renamed in `control.yaml`
without being renamed here fails rather than silently falling back to a default.
"""

from __future__ import annotations

import pathlib

import pytest

yaml = pytest.importorskip("yaml")

from hvac_agent.core.site import load_site
from hvac_agent.simulation.baseline import (
    BaselineController,
    Conditions,
    MachineRatings,
    PlantLayout,
    stage_count,
)

EXAMPLE = pathlib.Path(__file__).resolve().parents[2] / "configs" / "site"

RATED_KW = 700.0
RATED_FLOW = 2.0

LAYOUT = PlantLayout(
    chillers=2,
    chilled_water_pumps=3,
    chilled_water_pumps_duty=2,
    cooling_water_pumps=3,
    cooling_water_pumps_duty=2,
    cooling_towers=2,
)
RATINGS = MachineRatings(
    chiller_capacity_kw=RATED_KW,
    chiller_chilled_flow_m3_per_min=RATED_FLOW,
    chiller_condenser_flow_m3_per_min=2.5,
)


@pytest.fixture(scope="module")
def control() -> dict:
    return dict(load_site(EXAMPLE).control)


@pytest.fixture
def controller(control) -> BaselineController:
    return BaselineController(
        control, LAYOUT, RATINGS, step_minutes=10.0, heat_rejection_ratio=1.25
    )


def conditions(load_kw: float, **overrides) -> Conditions:
    defaults = dict(
        cooling_load_kw=load_kw,
        required_flow_m3_per_min=load_kw / 350.0,
        chilled_water_return_temp_c=12.0,
        condenser_return_temp_c=32.0,
        wet_bulb_temp_c=28.0,
        chilled_flow_per_chiller_m3_per_min=(2.0, 2.0),
    )
    defaults.update(overrides)
    return Conditions(**defaults)


def settle(controller: BaselineController, load_kw: float, steps: int, start: int = 0) -> int:
    """Hold a load steady for a while and return how many chillers end up running."""
    command = None
    for step in range(start, start + steps):
        command = controller.step(conditions(load_kw), step)
    assert command is not None
    return command.chillers_running


# --- the staging law, as a pure function ---------------------------------------------


@pytest.mark.parametrize(
    "running, demand_units, expected",
    [
        (0, 0.0, 0),     # nothing asked for, nothing runs
        (0, 0.01, 1),    # any load at all starts the first machine
        (1, 0.5, 1),     # comfortably inside one machine
        (1, 0.82, 2),    # at the stage-up threshold
        (1, 0.2, 0),     # below 0.5 * 0.45, the last machine stops
        (1, 0.3, 1),     # above it, the last machine stays
        (2, 0.44, 1),    # below the stage-down threshold
        (2, 0.46, 2),    # above it
        (2, 1.64, 2),    # would stage up, but there are only two machines
    ],
)
def test_the_law_matches_the_reference_site_at_two_machines(running, demand_units, expected):
    assert (
        stage_count(
            running=running,
            demand_units=demand_units,
            unit_count=2,
            up_at=0.82,
            down_at=0.45,
            last_unit_shutdown_factor=0.5,
        )
        == expected
    )


@pytest.mark.parametrize("unit_count", [1, 2, 3, 5, 12])
def test_the_law_generalises_to_any_number_of_machines(unit_count):
    # The reference is written for exactly two: `cur == 1` implies `want = 2`, and there
    # is no branch that could ever produce a third.
    at_capacity = stage_count(
        running=unit_count,
        demand_units=unit_count * 5.0,
        unit_count=unit_count,
        up_at=0.82,
        down_at=0.45,
        last_unit_shutdown_factor=0.5,
    )
    assert at_capacity == unit_count


def test_staging_moves_one_machine_at_a_time():
    # A demand spike must not start four chillers in one step. Each step moves by one,
    # which is what gives the auxiliaries time to follow.
    running = 0
    for _ in range(10):
        running = stage_count(
            running=running,
            demand_units=5.0,
            unit_count=5,
            up_at=0.82,
            down_at=0.45,
            last_unit_shutdown_factor=0.5,
        )
    assert running == 5


def test_a_machine_count_beyond_the_plant_is_clamped_rather_than_trusted():
    assert (
        stage_count(
            running=99,
            demand_units=1.0,
            unit_count=3,
            up_at=0.82,
            down_at=0.45,
            last_unit_shutdown_factor=0.5,
        )
        <= 3
    )


def test_an_empty_plant_is_rejected():
    with pytest.raises(ValueError):
        stage_count(
            running=0,
            demand_units=1.0,
            unit_count=0,
            up_at=0.82,
            down_at=0.45,
            last_unit_shutdown_factor=0.5,
        )


# --- hysteresis: it must not chatter --------------------------------------------------


@pytest.mark.parametrize("running", [1, 2, 3, 4])
def test_the_thresholds_never_overlap(running):
    # The property that makes chatter impossible: the demand that would add the next
    # machine is always above the demand that would drop back. If these ever crossed,
    # some load would ask for both at once.
    up_at, down_at = 0.82, 0.45
    adds_a_machine = running * up_at
    drops_back = (running + 1 - 1) * down_at
    assert drops_back < adds_a_machine


def test_a_load_between_the_thresholds_does_not_oscillate(controller):
    # 0.6 of a machine sits above the stage-down threshold and below the stage-up one:
    # exactly where a controller without hysteresis would hunt.
    settle(controller, 0.6 * RATED_KW, steps=20)
    counts = [
        controller.step(conditions(0.6 * RATED_KW), step).chillers_running
        for step in range(20, 60)
    ]
    assert len(set(counts)) == 1


def test_noise_around_a_threshold_does_not_start_a_machine(controller):
    # Load jittering across the stage-up threshold every other step. `confirm_steps`
    # requires the request to persist, so a single step above it never acts.
    settle(controller, 0.7 * RATED_KW, steps=10)
    before = controller.chillers.running
    for step in range(10, 40):
        load = (0.85 if step % 2 else 0.70) * RATED_KW
        controller.step(conditions(load), step)
    assert controller.chillers.running == before


def test_a_sustained_rise_does_start_a_machine(controller):
    # The other half of the previous test: the protection must not be a blanket refusal.
    settle(controller, 0.7 * RATED_KW, steps=10)
    assert settle(controller, 0.9 * RATED_KW, steps=10, start=10) == 2


# --- the minimum switch interval ------------------------------------------------------


def test_a_chiller_may_not_start_and_stop_within_the_hold(controller):
    # Thirty minutes at ten-minute steps is three steps. Without this a simulation will
    # cycle a chiller every step and report the saving.
    settle(controller, 0.9 * RATED_KW, steps=10)
    assert controller.chillers.running == 2
    started_at = controller.chillers.last_change_step

    # Demand collapses immediately afterwards.
    counts = [
        controller.step(conditions(0.1 * RATED_KW), step).chillers_running
        for step in range(started_at + 1, started_at + 3)
    ]
    assert counts == [2, 2], "the second chiller stopped inside its hold"


def test_the_hold_expires_and_the_change_goes_through(controller):
    settle(controller, 0.9 * RATED_KW, steps=10)
    started_at = controller.chillers.last_change_step
    counts = [
        controller.step(conditions(0.1 * RATED_KW), step).chillers_running
        for step in range(started_at + 1, started_at + 8)
    ]
    assert counts[-1] < 2, "the hold never released"


def test_a_shorter_step_needs_more_steps_for_the_same_hold(control):
    # The hold is thirty minutes whatever the step length, so a one-minute step must wait
    # thirty of them. Getting this wrong makes protection depend on the step size.
    fast = BaselineController(
        control, LAYOUT, RATINGS, step_minutes=1.0, heat_rejection_ratio=1.25
    )
    slow = BaselineController(
        control, LAYOUT, RATINGS, step_minutes=10.0, heat_rejection_ratio=1.25
    )
    assert fast._chiller_hold_steps == 30
    assert slow._chiller_hold_steps == 3


def test_a_hold_shorter_than_one_step_still_blocks_consecutive_changes(control):
    slow = BaselineController(
        {**control, "protection": {"chiller_min_switch_interval_minutes": 0.0}},
        LAYOUT,
        RATINGS,
        step_minutes=10.0,
        heat_rejection_ratio=1.25,
    )
    assert slow._chiller_hold_steps == 1


# --- pumps and towers -----------------------------------------------------------------


def test_no_chiller_means_nothing_else_runs(controller):
    command = controller.step(conditions(0.0), 0)
    assert command.chillers_running == 0
    assert command.chilled_water_pumps_running == 0
    assert command.cooling_water_pumps_running == 0
    assert command.cooling_towers_running == 0
    assert command.tower_fan_hz == 0.0


def test_pumps_never_drop_below_the_duty_count(controller):
    # The reference runs max(duty, staged) whenever a chiller is on, so duty is a floor.
    # The plant's pressures and terminal valve authority are set around it.
    settle(controller, 0.4 * RATED_KW, steps=10)
    command = controller.step(conditions(0.4 * RATED_KW), 10)
    assert command.chillers_running == 1
    assert command.chilled_water_pumps_running == LAYOUT.chilled_water_pumps_duty


def test_the_last_chiller_stops_at_a_load_the_building_still_has(controller):
    # Recorded, not endorsed. `last_unit_shutdown_factor` of 0.5 against a stage-down
    # threshold of 0.45 means the plant shuts down entirely below 22.5% of one machine —
    # with a real load still on the building. It is reproduced because the reference does
    # it and D3 compares against the reference, and it is pinned here because it was a
    # bare 0.5 in the middle of a staging function and nobody could see it.
    #
    # Setting the factor to zero holds the last machine until the load reaches zero.
    assert settle(controller, 0.30 * RATED_KW, steps=10) == 1
    assert settle(controller, 0.20 * RATED_KW, steps=10, start=10) == 0


def test_condenser_pumps_follow_the_chilled_side(controller):
    settle(controller, 0.9 * RATED_KW, steps=10)
    command = controller.step(conditions(0.9 * RATED_KW), 10)
    assert command.cooling_water_pumps_running == command.chilled_water_pumps_running


def test_towers_stage_on_rejected_heat(controller):
    # Above the last-machine shutdown threshold, so a chiller is running and the towers
    # have something to reject. Below it the plant stops entirely, which the test above
    # covers.
    settle(controller, 0.4 * RATED_KW, steps=10)
    light = controller.step(conditions(0.4 * RATED_KW), 10)

    heavy_controller_load = 0.9 * RATED_KW
    settle(controller, heavy_controller_load, steps=10, start=11)
    heavy = controller.step(conditions(heavy_controller_load), 21)

    assert light.cooling_towers_running == 1
    assert heavy.cooling_towers_running == 2


def test_tower_staging_generalises_past_two(control):
    # The reference returns two or one and cannot return three.
    layout = PlantLayout(
        chillers=4,
        chilled_water_pumps=4,
        chilled_water_pumps_duty=3,
        cooling_water_pumps=4,
        cooling_water_pumps_duty=3,
        cooling_towers=6,
    )
    controller = BaselineController(
        control, layout, RATINGS, step_minutes=10.0, heat_rejection_ratio=1.25
    )
    for step in range(60):
        command = controller.step(conditions(3.0 * RATED_KW), step)
    assert command.cooling_towers_running > 2


# --- tower fan speed ------------------------------------------------------------------


def test_fan_speed_stays_within_its_frequency_limits(controller):
    settle(controller, 0.9 * RATED_KW, steps=10)
    for load in (0.1, 0.5, 1.0, 4.0):
        command = controller.step(conditions(load * RATED_KW), 20)
        assert 25.0 <= command.tower_fan_hz <= 50.0


def test_a_hot_condenser_raises_the_fans(controller):
    settle(controller, 0.5 * RATED_KW, steps=10)
    cool = controller.step(conditions(0.5 * RATED_KW, condenser_return_temp_c=30.0), 20)
    hot = controller.step(conditions(0.5 * RATED_KW, condenser_return_temp_c=42.0), 21)
    assert hot.tower_fan_hz > cool.tower_fan_hz


def test_a_high_wet_bulb_raises_the_fans(controller):
    settle(controller, 0.5 * RATED_KW, steps=10)
    mild = controller.step(conditions(0.5 * RATED_KW, wet_bulb_temp_c=26.0), 20)
    humid = controller.step(conditions(0.5 * RATED_KW, wet_bulb_temp_c=32.0), 21)
    assert humid.tower_fan_hz > mild.tower_fan_hz


def test_a_trim_can_be_switched_off(control):
    off = {
        **control,
        "tower_fan": {
            **control["tower_fan"],
            "return_temp_trim": {**control["tower_fan"]["return_temp_trim"], "enabled": False},
        },
    }
    controller = BaselineController(
        off, LAYOUT, RATINGS, step_minutes=10.0, heat_rejection_ratio=1.25
    )
    settle(controller, 0.5 * RATED_KW, steps=10)
    cool = controller.step(conditions(0.5 * RATED_KW, condenser_return_temp_c=30.0), 20)
    hot = controller.step(conditions(0.5 * RATED_KW, condenser_return_temp_c=42.0), 21)
    assert hot.tower_fan_hz == pytest.approx(cool.tower_fan_hz)


# --- chilled-water supply setpoints ---------------------------------------------------


def test_the_setpoint_never_exceeds_the_return_temperature(controller):
    # The defect this rule exists to prevent: a setpoint above the return temperature
    # asks the machine for negative cooling.
    settle(controller, 0.9 * RATED_KW, steps=10)
    for return_temp in (7.5, 9.0, 12.0, 16.0):
        command = controller.step(
            conditions(0.9 * RATED_KW, chilled_water_return_temp_c=return_temp), 20
        )
        for setpoint in command.chilled_water_supply_setpoints_c[: command.chillers_running]:
            assert setpoint <= return_temp - 0.15 + 1e-9


def test_the_setpoint_never_goes_below_the_configured_floor(controller):
    settle(controller, 2.0 * RATED_KW, steps=10)
    command = controller.step(conditions(2.0 * RATED_KW), 20)
    assert all(
        setpoint >= 7.0 - 1e-9
        for setpoint in command.chilled_water_supply_setpoints_c
    )


def test_a_lighter_load_is_served_at_a_warmer_temperature(controller):
    # Load reset: a warmer supply costs the chiller less, and a lightly loaded plant can
    # afford one.
    settle(controller, 0.9 * RATED_KW, steps=10)
    heavy = controller.step(conditions(0.9 * RATED_KW), 20)
    light = controller.step(conditions(0.3 * RATED_KW), 21)
    assert light.chilled_water_supply_setpoints_c[0] > heavy.chilled_water_supply_setpoints_c[0]


def test_less_flow_demands_a_colder_supply_for_the_same_duty(controller):
    # The same duty carried by less water means a larger temperature drop, so the outlet
    # the machine must reach is colder. This is the hydraulic half of the rule: the
    # setpoint follows what the flow implies rather than what the load reset would like.
    settle(controller, 0.9 * RATED_KW, steps=10)
    plenty = controller.step(
        conditions(0.9 * RATED_KW, chilled_flow_per_chiller_m3_per_min=(2.0, 2.0)), 20
    )
    starved = controller.step(
        conditions(0.9 * RATED_KW, chilled_flow_per_chiller_m3_per_min=(0.2, 0.2)), 21
    )
    assert starved.chilled_water_supply_setpoints_c[0] < plenty.chilled_water_supply_setpoints_c[0]
    # And it still respects the floor rather than asking for something impossible.
    assert starved.chilled_water_supply_setpoints_c[0] >= 7.0


def test_a_stopped_chiller_keeps_its_previous_setpoint(controller):
    settle(controller, 0.9 * RATED_KW, steps=10)
    assert controller.chillers.running == 2
    while controller.chillers.running > 1:
        command = controller.step(conditions(0.1 * RATED_KW), 30)
    assert len(command.chilled_water_supply_setpoints_c) == LAYOUT.chillers


# --- structure ------------------------------------------------------------------------


def test_the_controller_carries_no_physics():
    # The acceptance criterion for this step, checked rather than asserted in prose: a
    # baseline that imports the engine cannot be tested without building a plant.
    source = (
        pathlib.Path(__file__).resolve().parents[2]
        / "src" / "hvac_agent" / "simulation" / "baseline.py"
    ).read_text(encoding="utf-8")
    for forbidden in ("phyvac", "integrations", "import numpy", "import scipy"):
        assert forbidden not in source


def test_reset_returns_the_controller_to_its_initial_state(controller):
    settle(controller, 0.9 * RATED_KW, steps=10)
    assert controller.chillers.running == 2
    controller.reset()
    assert controller.chillers.running == 0
    assert controller.towers.running == 0


def test_a_non_positive_step_length_is_rejected(control):
    with pytest.raises(ValueError):
        BaselineController(
            control, LAYOUT, RATINGS, step_minutes=0.0, heat_rejection_ratio=1.25
        )


def test_a_layout_with_more_duty_pumps_than_pumps_is_rejected():
    with pytest.raises(ValueError, match="more duty"):
        PlantLayout(
            chillers=2,
            chilled_water_pumps=2,
            chilled_water_pumps_duty=3,
            cooling_water_pumps=2,
            cooling_water_pumps_duty=2,
            cooling_towers=2,
        )


# --- pump speed ---------------------------------------------------------------------------


def test_pumps_do_not_simply_run_flat_out(controller):
    # The finding D3 produced. The first version of this controller commanded counts and
    # setpoints but never a pump speed, so the plant ran its pumps at full frequency
    # whenever they ran. Compared against the reference plant over a day that showed the
    # same staging and the same delivered cooling, but 43% more water moved and 71% more
    # energy. A variable-speed pump that is never varied is most of a chiller plant's
    # avoidable consumption.
    settle(controller, 0.5 * RATED_KW, steps=20)
    command = controller.step(conditions(0.5 * RATED_KW), 20)
    assert 0.0 < command.chilled_water_pump_hz < 50.0


def test_pump_speed_rises_with_the_flow_the_load_asks_for(controller):
    settle(controller, 0.3 * RATED_KW, steps=30)
    light = controller.step(conditions(0.3 * RATED_KW), 30).chilled_water_pump_hz
    settle(controller, 1.5 * RATED_KW, steps=30, start=31)
    heavy = controller.step(conditions(1.5 * RATED_KW), 61).chilled_water_pump_hz
    assert heavy > light


def test_pump_speed_stays_within_its_frequency_limits(controller):
    for step, load in enumerate([0.2, 0.5, 1.0, 3.0] * 15):
        command = controller.step(conditions(load * RATED_KW), step)
        if command.chilled_water_pumps_running:
            assert 30.0 <= command.chilled_water_pump_hz <= 50.0


def test_stopped_pumps_are_commanded_no_speed(controller):
    command = controller.step(conditions(0.0), 0)
    assert command.chilled_water_pumps_running == 0
    assert command.chilled_water_pump_hz == 0.0
    assert command.cooling_water_pump_hz == 0.0


def test_the_speed_loop_moves_no_faster_than_the_engine_s_own(controller):
    # The engine's PI hard-limits its change to 0.05 of the output range per step, which
    # is why the reference plants' gains look so small and their loops settle slowly.
    # Reproducing that limit is what makes this baseline behave like the site's rather
    # than merely aim at the same place.
    # Measured once the pumps are already turning. Starting is a step change by design:
    # a pump does not run below its minimum frequency, so it starts at that floor.
    settle(controller, 0.5 * RATED_KW, steps=8)
    previous = controller.step(conditions(0.5 * RATED_KW), 8).chilled_water_pump_hz
    assert previous > 0.0

    for step in range(9, 30):
        current = controller.step(conditions(3.0 * RATED_KW), step).chilled_water_pump_hz
        assert abs(current - previous) <= 0.05 * 50.0 + 1e-9
        previous = current


# --- machines set by hand -----------------------------------------------------------------


def test_a_chiller_stopped_by_hand_is_not_staged(controller):
    # With one of two chillers stopped by hand, a load that calls for two gets one: the
    # baseline stages among the machines it has, not the ones it would like.
    for step in range(8):
        command = controller.step(conditions(1300.0, chillers_available=1), step)
    assert command.chillers_running == 1


def test_stopping_a_chiller_by_hand_takes_effect_at_once(controller):
    # The baseline's switch interval protects against its own flapping. A person stopping
    # a machine has decided, and the count drops on the next step.
    assert settle(controller, 1300.0, 8) == 2
    command = controller.step(conditions(1300.0, chillers_available=1), 8)
    assert command.chillers_running == 1


def test_a_chiller_started_by_hand_runs_even_with_no_load_to_carry(controller):
    command = controller.step(conditions(0.0, chillers_forced_on=1), 0)
    assert command.chillers_running == 1


def test_a_chiller_started_by_hand_counts_towards_the_staged_number(controller):
    # One chiller's worth of load and one chiller started by hand: one runs, not two.
    assert settle(controller, 400.0, 6) == 1
    command = controller.step(conditions(400.0, chillers_forced_on=1), 6)
    assert command.chillers_running == 1


def test_a_tower_stopped_by_hand_is_not_staged(controller):
    for step in range(8):
        command = controller.step(conditions(1300.0, cooling_towers_available=1), step)
    assert command.cooling_towers_running == 1


def test_nothing_set_by_hand_leaves_the_baseline_as_it_was(control):
    # The fields default to "no change", so a controller given them explicitly makes the
    # same decisions step for step as one that never heard of them.
    def fresh() -> BaselineController:
        return BaselineController(
            control, LAYOUT, RATINGS, step_minutes=10.0, heat_rejection_ratio=1.25
        )

    plain, told = fresh(), fresh()
    for step, load in enumerate([0, 300, 900, 1300, 1300, 700, 200, 0] * 3):
        assert plain.step(conditions(load), step) == told.step(
            conditions(load, chillers_available=None, chillers_forced_on=0,
                       cooling_towers_available=None, cooling_towers_forced_on=0),
            step,
        )
