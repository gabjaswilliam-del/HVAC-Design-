"""From how many machines the baseline asks for to which ones run.

No plant is built here. A dispatch decision is a function of the command and of who is
connected to whom, so each rule is one call against a hand-written roster.
"""

from __future__ import annotations

from hvac_agent.core.metrics import DeviceFamily
from hvac_agent.simulation.baseline import Command
from hvac_agent.simulation.dispatch import (
    Forced,
    Roster,
    available_chillers,
    chiller_order,
    dispatch,
)

CHW, CW = DeviceFamily.CHILLED_WATER_PUMP, DeviceFamily.COOLING_WATER_PUMP


def roster(
    *,
    chw_paired: dict[str, str] | None = None,
    cw_paired: dict[str, str] | None = None,
) -> Roster:
    """Two chillers, three pumps a side, two towers. Paired n-to-n unless told otherwise."""
    return Roster(
        chillers=("chiller_plant_1", "chiller_plant_2"),
        cooling_towers=("cooling_towers_1", "cooling_towers_2"),
        pumps={
            CHW: tuple(f"chilled_water_pump_pri_{n}" for n in (1, 2, 3)),
            CW: tuple(f"cooling_water_pump_{n}" for n in (1, 2, 3)),
        },
        paired={
            CHW: chw_paired if chw_paired is not None else {
                "chiller_plant_1": "chilled_water_pump_pri_1",
                "chiller_plant_2": "chilled_water_pump_pri_2",
            },
            CW: cw_paired if cw_paired is not None else {
                "chiller_plant_1": "cooling_water_pump_1",
                "chiller_plant_2": "cooling_water_pump_2",
            },
        },
    )


def command(chillers: int, pumps: int | None = None, towers: int = 1) -> Command:
    pumps = chillers if pumps is None else pumps
    return Command(
        chillers_running=chillers,
        chilled_water_pumps_running=pumps,
        cooling_water_pumps_running=pumps,
        cooling_towers_running=towers,
        chilled_water_supply_setpoints_c=(10.0, 10.0),
        tower_fan_hz=30.0,
        heat_rejection_estimate_kw=0.0,
    )


def test_a_chiller_runs_with_its_own_pumps():
    assert dispatch(command(1), roster()) == {
        "chiller_plant_1", "chilled_water_pump_pri_1", "cooling_water_pump_1", "cooling_towers_1",
    }


def test_the_pump_that_runs_is_the_one_the_links_pair():
    # Wired the other way round, chiller 1 brings pump 2. Running "the first n pumps"
    # would have started pump 1 whatever the links said.
    swapped = roster(
        chw_paired={
            "chiller_plant_1": "chilled_water_pump_pri_2",
            "chiller_plant_2": "chilled_water_pump_pri_1",
        },
    )
    running = dispatch(command(1), swapped)
    assert "chilled_water_pump_pri_2" in running
    assert "chilled_water_pump_pri_1" not in running


def test_a_chiller_on_the_header_takes_a_header_pump():
    on_header = roster(chw_paired={"chiller_plant_1": "chilled_water_pump_pri_1"})
    running = dispatch(command(2), on_header)
    # Chiller 2 has no pump of its own; the first pump paired with nothing feeds it.
    assert "chiller_plant_2" in running
    assert "chilled_water_pump_pri_2" in running
    assert "chilled_water_pump_pri_3" not in running


def test_header_pumps_are_not_started_for_chillers_that_have_their_own():
    running = dispatch(command(2, pumps=3), roster())
    assert "chilled_water_pump_pri_3" not in running
    assert "cooling_water_pump_3" not in running


def test_a_chiller_with_no_pump_to_move_its_water_does_not_run():
    # Two chillers asked for, but only one pump a side: chiller 1 takes it, and chiller 2
    # is left with no flow path, so it is not started on the count alone.
    running = dispatch(command(2, pumps=1), roster())
    assert "chiller_plant_1" in running
    assert "chiller_plant_2" not in running


def test_nothing_runs_when_no_chiller_is_asked_for():
    assert dispatch(command(0, pumps=2, towers=0), roster()) == frozenset()


def test_towers_run_in_duty_order():
    running = dispatch(command(1, towers=2), roster())
    assert {"cooling_towers_1", "cooling_towers_2"} <= running


# --- a shared header ----------------------------------------------------------------------


def shared(pumps: int = 1) -> Roster:
    """Two chillers with no pumps of their own, fed from one header a side."""
    return Roster(
        chillers=("chiller_plant_1", "chiller_plant_2"),
        cooling_towers=("cooling_towers_1", "cooling_towers_2"),
        pumps={
            CHW: tuple(f"chilled_water_pump_pri_{n}" for n in range(1, pumps + 1)),
            CW: tuple(f"cooling_water_pump_{n}" for n in range(1, pumps + 1)),
        },
        paired={CHW: {}, CW: {}},
    )


def test_two_chillers_on_one_header_pump_both_run():
    # A header pump was once taken out of the pool by the first chiller it fed, so the
    # second chiller on the same header never ran and the plant was capped at one rating.
    running = dispatch(command(2), shared(pumps=1))
    assert {"chiller_plant_1", "chiller_plant_2"} <= running
    assert {"chilled_water_pump_pri_1", "cooling_water_pump_1"} <= running


def test_header_pumps_follow_the_pump_count_not_the_chiller_count():
    one_chiller = dispatch(command(1, pumps=2), shared(pumps=3))
    assert "chiller_plant_2" not in one_chiller
    assert {"chilled_water_pump_pri_1", "chilled_water_pump_pri_2"} <= one_chiller
    assert "chilled_water_pump_pri_3" not in one_chiller

    two_chillers = dispatch(command(2, pumps=1), shared(pumps=3))
    assert {"chiller_plant_1", "chiller_plant_2"} <= two_chillers
    assert "chilled_water_pump_pri_1" in two_chillers
    assert "chilled_water_pump_pri_2" not in two_chillers


def test_a_paired_pump_counts_towards_the_pump_count_and_the_header_gets_the_rest():
    # Chiller 1 has its own pump; chiller 2 is on the header with pumps 2 and 3.
    mixed = roster(chw_paired={"chiller_plant_1": "chilled_water_pump_pri_1"})
    running = dispatch(command(2, pumps=3), mixed)
    assert {"chilled_water_pump_pri_1", "chilled_water_pump_pri_2",
            "chilled_water_pump_pri_3"} <= running


def test_a_header_pump_started_by_hand_is_one_of_those_the_header_runs():
    forced = Forced(on=frozenset({"chilled_water_pump_pri_3"}))
    running = dispatch(command(2, pumps=1), shared(pumps=3), forced)
    assert "chilled_water_pump_pri_3" in running
    assert "chilled_water_pump_pri_1" not in running


def test_header_pumps_stopped_by_hand_are_passed_over():
    forced = Forced(off=frozenset({"chilled_water_pump_pri_1"}))
    running = dispatch(command(2, pumps=1), shared(pumps=3), forced)
    assert {"chiller_plant_1", "chiller_plant_2", "chilled_water_pump_pri_2"} <= running
    assert "chilled_water_pump_pri_1" not in running


def test_a_header_with_every_pump_stopped_runs_no_chiller():
    forced = Forced(off=frozenset({"chilled_water_pump_pri_1"}))
    assert available_chillers(shared(pumps=1), forced) == ()
    assert not {"chiller_plant_1", "chiller_plant_2"} & dispatch(
        command(2), shared(pumps=1), forced
    )


# --- machines set by hand -----------------------------------------------------------------


def test_a_chiller_stopped_by_hand_is_not_available():
    forced = Forced(off=frozenset({"chiller_plant_1"}))
    assert available_chillers(roster(), forced) == ("chiller_plant_2",)
    running = dispatch(command(1), roster(), forced)
    assert "chiller_plant_1" not in running
    assert {"chiller_plant_2", "chilled_water_pump_pri_2", "cooling_water_pump_2"} <= running


def test_stopping_a_chillers_own_pump_leaves_it_no_flow_path():
    # Chiller 1 opens only into pump 1. With pump 1 stopped by hand, chiller 1 cannot run,
    # and the count goes to chiller 2 rather than to a chiller with no water.
    forced = Forced(off=frozenset({"chilled_water_pump_pri_1"}))
    assert available_chillers(roster(), forced) == ("chiller_plant_2",)
    running = dispatch(command(1), roster(), forced)
    assert "chiller_plant_2" in running
    assert "chilled_water_pump_pri_1" not in running


def test_a_chiller_started_by_hand_takes_the_first_slot():
    forced = Forced(on=frozenset({"chiller_plant_2"}))
    assert chiller_order(roster(), forced) == ("chiller_plant_2", "chiller_plant_1")
    running = dispatch(command(1), roster(), forced)
    assert "chiller_plant_2" in running
    assert "chiller_plant_1" not in running


def test_a_pump_started_by_hand_runs_with_its_chiller_stopped():
    forced = Forced(on=frozenset({"chilled_water_pump_pri_2"}))
    running = dispatch(command(1), roster(), forced)
    assert "chilled_water_pump_pri_2" in running
    assert "chiller_plant_2" not in running


def test_towers_set_by_hand():
    forced = Forced(on=frozenset({"cooling_towers_2"}), off=frozenset({"cooling_towers_1"}))
    running = dispatch(command(1, towers=1), roster(), forced)
    assert "cooling_towers_2" in running
    assert "cooling_towers_1" not in running


def test_nothing_stopped_by_hand_ever_runs():
    forced = Forced(off=frozenset({"cooling_water_pump_1", "cooling_towers_2"}))
    running = dispatch(command(2, towers=2), roster(), forced)
    assert not running & forced.off


def test_with_nothing_set_by_hand_the_order_is_duty_order():
    assert chiller_order(roster()) == ("chiller_plant_1", "chiller_plant_2")
