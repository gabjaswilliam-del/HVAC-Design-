"""Checks for the action contract.

The two properties worth testing are the two the reference lacks: an action is partial,
and it can be checked against a site before anything applies it.
"""

from __future__ import annotations

import math
from datetime import datetime, timezone

import pytest

from hvac_agent.core import metrics as m
from hvac_agent.core.actions import Action, ControlMode

WHEN = datetime(2026, 8, 4, 13, 30, tzinfo=timezone.utc)


@pytest.fixture
def site() -> m.SiteMetrics:
    return m.SiteMetrics.from_counts(
        {m.DeviceFamily.CHILLER: 2, m.DeviceFamily.COOLING_TOWER: 2}
    )


# --- Partiality --------------------------------------------------------------------


def test_an_action_names_only_what_it_changes(site):
    action = Action(
        mode=ControlMode.MANUAL,
        setpoints={"chiller_plant_1:chilled_water_temp_set": 8.5},
    )
    action.validate_against(site)
    # One point set out of a vocabulary with many commandable ones. The reference had to
    # re-send every device's full state because its backend had no partial support.
    assert len(action.setpoints) == 1
    assert len(site.commandable_points) > 1


def test_an_empty_manual_action_is_valid(site):
    # "Change nothing this step" is a meaningful instruction.
    Action(mode=ControlMode.MANUAL).validate_against(site)


def test_a_plc_action_sets_nothing():
    with pytest.raises(ValueError, match="PLC action sets nothing"):
        Action(mode=ControlMode.PLC, setpoints={"chiller_plant_1:running_state": 1.0})


def test_an_empty_plc_action_is_valid(site):
    Action(mode=ControlMode.PLC).validate_against(site)


# --- Validation against a site -----------------------------------------------------


def test_unknown_points_are_rejected(site):
    action = Action(mode=ControlMode.MANUAL, setpoints={"boiler_1:running_state": 1.0})
    with pytest.raises(m.UnknownPointError):
        action.validate_against(site)


def test_readings_cannot_be_commanded(site):
    action = Action(
        mode=ControlMode.MANUAL,
        setpoints={"chiller_plant_1:total_active_power": 300.0},
    )
    with pytest.raises(ValueError, match="readings, not handles"):
        action.validate_against(site)


def test_feedback_cannot_be_commanded(site):
    # Writing the feedback rather than the setpoint would hide a command the plant
    # accepted but did not achieve.
    action = Action(
        mode=ControlMode.MANUAL,
        setpoints={"cooling_towers_1:frequency_feedback": 40.0},
    )
    with pytest.raises(ValueError, match="readings, not handles"):
        action.validate_against(site)


@pytest.mark.parametrize("value", [0.0, 1.0])
def test_running_state_accepts_zero_and_one(site, value):
    Action(
        mode=ControlMode.MANUAL, setpoints={"chiller_plant_1:running_state": value}
    ).validate_against(site)


@pytest.mark.parametrize("value", [0.5, 2.0, -1.0])
def test_running_state_rejects_anything_else(site, value):
    action = Action(
        mode=ControlMode.MANUAL, setpoints={"chiller_plant_1:running_state": value}
    )
    with pytest.raises(ValueError, match="must be 0 or 1"):
        action.validate_against(site)


@pytest.mark.parametrize("value", [math.nan, math.inf, -math.inf])
def test_non_finite_setpoints_are_rejected(value):
    with pytest.raises(ValueError, match="not finite"):
        Action(
            mode=ControlMode.MANUAL,
            setpoints={"chiller_plant_1:chilled_water_temp_set": value},
        )


@pytest.mark.parametrize("value", ["9.5", None, True])
def test_a_setpoint_that_is_not_a_number_is_rejected(value):
    # A string that happens to parse, or a bool that happens to equal 1, is a caller's
    # mistake; converting it quietly would hide that.
    with pytest.raises(ValueError, match="not a number"):
        Action(
            mode=ControlMode.MANUAL,
            setpoints={"chiller_plant_1:chilled_water_temp_set": value},
        )


# --- A snapshot, not a view --------------------------------------------------------


def test_changing_the_callers_dictionary_afterwards_does_not_change_the_action():
    # The gate checks an action, the run queues it and the ledger records it, all as one
    # object. Holding the caller's dictionary let a value changed after the check reach
    # the plant and rewrite the proposal in the history.
    setpoints = {"chiller_plant_1:chilled_water_temp_set": 9.5}
    action = Action(mode=ControlMode.MANUAL, setpoints=setpoints)

    setpoints["chiller_plant_1:chilled_water_temp_set"] = 20.0
    setpoints["chiller_plant_2:chilled_water_temp_set"] = 20.0

    assert action.setpoints == {"chiller_plant_1:chilled_water_temp_set": 9.5}


def test_an_actions_setpoints_cannot_be_changed_through_it():
    action = Action(
        mode=ControlMode.MANUAL, setpoints={"chiller_plant_1:chilled_water_temp_set": 9.5}
    )
    with pytest.raises(TypeError):
        action.setpoints["chiller_plant_1:chilled_water_temp_set"] = 20.0  # type: ignore[index]


def test_setpoints_are_held_as_floats():
    action = Action(mode=ControlMode.MANUAL, setpoints={"chiller_plant_1:running_state": 1})
    assert type(action.setpoints["chiller_plant_1:running_state"]) is float


def test_equipment_limits_are_not_checked_here(site):
    # A 500 Hz fan is absurd, but the limit is per-site equipment data in the site
    # definition, not a property of the vocabulary. The simulation layer checks it
    # against the active run's equipment.
    Action(
        mode=ControlMode.MANUAL,
        setpoints={"cooling_towers_1:frequency_setpoint": 500.0},
    ).validate_against(site)


# --- Run targeting and staleness ---------------------------------------------------


def test_run_and_issue_time_are_carried(site):
    action = Action(
        mode=ControlMode.MANUAL,
        setpoints={"chiller_plant_1:running_state": 1.0},
        run_id="run-1",
        issued_at=WHEN,
    )
    action.validate_against(site)
    assert action.run_id == "run-1"
    assert action.issued_at == WHEN


def test_naive_issue_time_is_rejected():
    with pytest.raises(ValueError, match="timezone-aware"):
        Action(mode=ControlMode.MANUAL, issued_at=datetime(2026, 8, 4, 13, 30))


# --- Merging -----------------------------------------------------------------------


def test_a_correction_overrides_only_the_points_it_names():
    baseline = Action(
        mode=ControlMode.MANUAL,
        setpoints={
            "chiller_plant_1:running_state": 1.0,
            "chiller_plant_1:chilled_water_temp_set": 7.0,
        },
    )
    correction = Action(
        mode=ControlMode.MANUAL,
        setpoints={"chiller_plant_1:chilled_water_temp_set": 8.5},
        run_id="run-1",
    )
    merged = baseline.merged_with(correction)
    assert merged.setpoints == {
        "chiller_plant_1:running_state": 1.0,
        "chiller_plant_1:chilled_water_temp_set": 8.5,
    }
    assert merged.run_id == "run-1"


def test_merging_across_modes_is_rejected():
    with pytest.raises(ValueError, match="cannot merge"):
        Action(mode=ControlMode.PLC).merged_with(Action(mode=ControlMode.MANUAL))


# --- releasing a point back to the baseline -------------------------------------------


def test_a_manual_action_can_release_points(site):
    action = Action(mode=ControlMode.MANUAL, release={"cooling_towers_1:frequency_setpoint"})
    assert action.release == frozenset({"cooling_towers_1:frequency_setpoint"})
    action.validate_against(site)


def test_a_point_cannot_be_both_set_and_released():
    point = "chilled_water_pump_pri_1:frequency_setpoint"
    with pytest.raises(ValueError, match="both set and released"):
        Action(mode=ControlMode.MANUAL, setpoints={point: 40.0}, release={point})


def test_a_plc_action_releases_nothing_explicitly_because_it_releases_everything():
    with pytest.raises(ValueError, match="releases every point"):
        Action(mode=ControlMode.PLC, release={"chiller_plant_1:running_state"})


def test_releasing_a_reading_or_an_unknown_point_is_rejected(site):
    with pytest.raises(ValueError, match="readings, not handles"):
        Action(
            mode=ControlMode.MANUAL, release={"chiller_plant_1:evaporator_outlet_temp"}
        ).validate_against(site)
    with pytest.raises(m.UnknownPointError):
        Action(
            mode=ControlMode.MANUAL, release={"chiller_plant_9:running_state"}
        ).validate_against(site)


def test_merging_a_release_drops_the_point_and_a_later_setpoint_restores_it():
    a = "chilled_water_pump_pri_1:frequency_setpoint"
    b = "chiller_plant_1:chilled_water_temp_set"
    held = Action(mode=ControlMode.MANUAL, setpoints={a: 40.0, b: 9.0})
    released = held.merged_with(Action(mode=ControlMode.MANUAL, release={a}))
    assert released.setpoints == {b: 9.0}
    assert released.release == frozenset({a})
    again = released.merged_with(Action(mode=ControlMode.MANUAL, setpoints={a: 44.0}))
    assert again.setpoints == {a: 44.0, b: 9.0}
    assert again.release == frozenset()
