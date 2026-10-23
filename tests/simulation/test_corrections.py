"""The correction gate: what it refuses, and what it records.

The plant here is the same deterministic fake the run tests use, extended to hold a
frequency and report it back. Every rejection under test is a check the reference
implementation does not make — it has no run identity, no notion of when an action was
computed, and no equipment limits between an action and the plant.
"""

from __future__ import annotations

from datetime import UTC, datetime, timedelta

import pytest

from hvac_agent.core.actions import Action, ControlMode
from hvac_agent.core.metrics import DeviceFamily, SiteMetrics, UnknownPointError
from hvac_agent.core.observation import Measurement, Observation, Origin
from hvac_agent.core.units import BASE_FREQUENCY_HZ
from hvac_agent.simulation.corrections import (
    CorrectionGate,
    CorrectionStatus,
    EquipmentLimits,
    Rejection,
)
from hvac_agent.simulation.run import PlantInputs, Run, RunState, Scenario

START = datetime(2026, 7, 1, 0, 0, tzinfo=UTC)
REVISION = "rev1-nameplate"
PUMP = "chilled_water_pump_pri_1"
CHILLER = "chiller_plant_1"

CONTROL = {
    "frequency_limits_hz": {
        "chilled_water_pump_pri": {"min": 30.0, "max": 50.0},
        "cooling_water_pump": {"min": 30.0, "max": 50.0},
        "cooling_towers": {"min": 25.0, "max": 50.0},
    },
    "setpoints": {"chw_supply_temp_c": {"min": 7.0, "max": 12.0}},
}

METRICS = SiteMetrics.from_counts(
    {
        DeviceFamily.CHILLER: 2,
        DeviceFamily.CHILLED_WATER_PUMP: 3,
        DeviceFamily.COOLING_WATER_PUMP: 3,
        DeviceFamily.COOLING_TOWER: 2,
    }
)
LIMITS = EquipmentLimits.from_control(CONTROL)


class FakeEngine:
    """A plant that holds a pump frequency and reports back what it settled at.

    `ceiling` is how high the plant will actually go, which is what makes an accepted but
    unachieved correction testable: the number is stored, the machine does not reach it.
    """

    step_minutes = 10.0

    def __init__(self, *, ceiling: float = 50.0) -> None:
        self.ceiling = ceiling
        self.run_id = "run-test"
        self.now = START
        self.frequency = 35.0
        self.actions: list[Action | None] = []

    def _observation(self) -> Observation:
        return Observation(
            timestamp=self.now,
            origin=Origin.SIMULATED,
            config_revision=REVISION,
            run_id=self.run_id,
            points={
                f"{PUMP}:frequency_feedback": Measurement(
                    self.frequency, METRICS.unit_of(f"{PUMP}:frequency_feedback")
                ),
                f"{PUMP}:frequency_setpoint": Measurement(
                    self.frequency, METRICS.unit_of(f"{PUMP}:frequency_setpoint")
                ),
            },
        )

    def reset(self, start: datetime) -> Observation:
        self.now = start
        self.frequency = 35.0
        return self._observation()

    def step(self, inputs: PlantInputs, action: Action | None = None) -> Observation:
        self.actions.append(action)
        if action is not None:
            requested = action.setpoints.get(f"{PUMP}:frequency_setpoint")
            if requested is not None:
                self.frequency = min(requested, self.ceiling)
        self.now = self.now + timedelta(minutes=self.step_minutes)
        return self._observation()

    def observe(self) -> Observation:
        return self._observation()


def scenario(steps: int = 8) -> Scenario:
    return Scenario(
        name="an afternoon",
        start=START,
        inputs=tuple(
            PlantInputs(cooling_load_kw=500.0, dry_bulb_temp_c=32.0, relative_humidity_percent=70.0)
            for _ in range(steps)
        ),
        step_minutes=10.0,
    )


@pytest.fixture
def engine() -> FakeEngine:
    return FakeEngine()


@pytest.fixture
def run(engine) -> Run:
    run = Run(engine, scenario(), config_revision=REVISION, run_id="run-test")
    run.start()
    return run


@pytest.fixture
def gate(run) -> CorrectionGate:
    return CorrectionGate(run, METRICS, LIMITS)


def correction(hz: float = 42.0, **overrides) -> Action:
    defaults = dict(
        mode=ControlMode.MANUAL,
        setpoints={f"{PUMP}:frequency_setpoint": hz},
        run_id="run-test",
        issued_at=START,
    )
    defaults.update(overrides)
    return Action(**defaults)


# --- limits from the site -------------------------------------------------------------


def test_limits_come_from_the_site_control_file():
    assert LIMITS.frequency_hz[DeviceFamily.CHILLED_WATER_PUMP] == (30.0, 50.0)
    assert LIMITS.frequency_hz[DeviceFamily.COOLING_TOWER] == (25.0, 50.0)
    assert LIMITS.chilled_water_temp_set_c == (7.0, 12.0)


def test_limits_name_every_setpoint_that_is_out_of_range():
    problems = LIMITS.check(
        {
            f"{PUMP}:frequency_setpoint": 55.0,
            f"{CHILLER}:chilled_water_temp_set": 4.0,
            "cooling_towers_1:frequency_setpoint": 40.0,
        }
    )
    assert len(problems) == 2
    assert any("55" in problem for problem in problems)
    assert any("chilled_water_temp_set" in problem for problem in problems)


def test_a_tower_may_run_slower_than_a_pump():
    # Different families have different floors, which is why the limit is per family and
    # not one number for the plant.
    assert LIMITS.check({"cooling_towers_1:frequency_setpoint": 27.0}) == ()
    assert LIMITS.check({f"{PUMP}:frequency_setpoint": 27.0}) != ()


# --- accepted -------------------------------------------------------------------------


def test_a_good_correction_is_accepted_then_applied_by_the_step_that_takes_it(
    gate, run, engine
):
    record = gate.submit(correction(42.0), rationale="condenser approach is widening",
                         based_on=START)

    # Accepted is not applied: nothing has run yet.
    assert record.accepted
    assert record.status is CorrectionStatus.QUEUED
    assert record.applied is None

    run.step()
    gate.collect_outcomes()
    assert engine.frequency == pytest.approx(42.0)
    assert record.status is CorrectionStatus.APPLIED
    assert record.applied.step_index == 0


def test_the_rationale_is_kept_verbatim(gate):
    reason = "chiller 2 is at 94% while chiller 1 sits at 40%; rebalancing"
    record = gate.submit(correction(), rationale=reason, based_on=START)
    assert record.proposal.rationale == reason


def test_a_correction_applies_to_the_next_step_whichever_way_it_comes(gate, run, engine):
    # A playing run cannot be stepped by hand but can still be corrected. This is the
    # path for that.
    run.step()
    gate.submit(correction(44.0), rationale="test", based_on=START + timedelta(minutes=10))
    run.play()
    assert run.wait(timeout=5.0)
    assert any(
        action is not None and action.setpoints for action in engine.actions
    )


def test_only_one_correction_can_be_pending(gate, run, engine):
    # Two corrections computed from the same observation are alternatives, not a
    # sequence. Applying both would apply a state nobody proposed.
    gate.submit(correction(40.0), rationale="first", based_on=START)
    gate.submit(correction(46.0), rationale="second", based_on=START)
    run.step()
    assert engine.frequency == pytest.approx(46.0)


# --- rejected -------------------------------------------------------------------------


def test_a_stale_correction_is_rejected(gate, run):
    # The normal case, not a fault: a decider that thinks about what it sees often
    # finishes after the plant has moved on.
    for _ in range(3):
        run.step()
    record = gate.submit(correction(), rationale="late", based_on=START)

    assert not record.accepted
    assert record.rejection is Rejection.STALE
    assert "moved on" in record.reason


def test_a_correction_one_step_behind_is_still_fresh_enough(gate, run):
    run.step()
    record = gate.submit(correction(), rationale="just in time", based_on=START)
    assert record.accepted


def test_a_correction_from_the_future_is_rejected(gate, run):
    run.step()
    record = gate.submit(
        correction(), rationale="from ahead", based_on=START + timedelta(hours=3)
    )
    assert record.rejection is Rejection.STALE
    assert "ahead of the run" in record.reason


def test_a_correction_for_another_run_is_rejected(gate):
    # Its observations describe a different plant state. The reference has no run
    # identity at all, so this cannot even be asked there.
    record = gate.submit(
        correction(run_id="run-somewhere-else"), rationale="wrong run", based_on=START
    )
    assert record.rejection is Rejection.WRONG_RUN
    assert "different plant state" in record.reason


def test_a_correction_beyond_an_equipment_limit_is_rejected(gate):
    record = gate.submit(correction(58.0), rationale="too fast", based_on=START)

    assert record.rejection is Rejection.OUT_OF_LIMITS
    assert "58" in record.reason
    assert "30" in record.reason and "50" in record.reason


def test_a_correction_below_a_minimum_frequency_is_rejected(gate):
    record = gate.submit(correction(12.0), rationale="too slow", based_on=START)
    assert record.rejection is Rejection.OUT_OF_LIMITS


def test_a_correction_to_an_unknown_point_is_rejected(gate):
    record = gate.submit(
        correction(setpoints={"chiller_plant_9:chilled_water_temp_set": 8.0}),
        rationale="no such machine",
        based_on=START,
    )
    assert record.rejection is Rejection.UNKNOWN_POINT


def test_a_correction_to_a_reading_is_rejected(gate):
    # A measurement is not a handle. Writing to one would silently do nothing.
    record = gate.submit(
        correction(setpoints={f"{CHILLER}:evaporator_outlet_temp": 6.0}),
        rationale="wishing",
        based_on=START,
    )
    assert record.rejection is Rejection.UNKNOWN_POINT
    assert "readings, not handles" in record.reason


def test_a_correction_that_sets_nothing_is_rejected(gate):
    record = gate.submit(
        correction(setpoints={}), rationale="empty", based_on=START
    )
    assert record.rejection is Rejection.MALFORMED


def test_a_correction_to_a_stopped_run_is_rejected(gate, run):
    run.stop()
    record = gate.submit(correction(), rationale="too late", based_on=START)

    assert record.rejection is Rejection.RUN_NOT_ACTIVE
    assert "stopped" in record.reason


def test_a_correction_to_a_failed_run_is_rejected(run, engine):
    gate = CorrectionGate(run, METRICS, LIMITS)
    run.stop()
    record = gate.submit(correction(), rationale="after the fact", based_on=START)
    assert record.rejection is Rejection.RUN_NOT_ACTIVE


def test_a_rejected_correction_changes_nothing(gate, run, engine):
    before = engine.frequency
    gate.submit(correction(58.0), rationale="too fast", based_on=START)
    run.step()
    assert engine.frequency == pytest.approx(before)


def test_changing_the_submitted_dictionary_after_acceptance_changes_nothing(
    gate, run, engine
):
    # The reviewer's reproduction, against the fake plant: accepted at 42 Hz, then the
    # caller's dictionary is pushed past the 50 Hz limit before the step runs.
    setpoints = {f"{PUMP}:frequency_setpoint": 42.0}
    record = gate.submit(
        Action(mode=ControlMode.MANUAL, setpoints=setpoints, run_id="run-test", issued_at=START),
        rationale="rebalancing",
        based_on=START,
    )
    assert record.accepted

    setpoints[f"{PUMP}:frequency_setpoint"] = 58.0
    run.step()
    gate.collect_outcomes()

    assert engine.actions[-1].setpoints[f"{PUMP}:frequency_setpoint"] == 42.0
    assert engine.frequency == pytest.approx(42.0)
    assert record.proposal.action.setpoints[f"{PUMP}:frequency_setpoint"] == 42.0
    assert record.outcome.achieved[f"{PUMP}:frequency_setpoint"] == pytest.approx(42.0)


# --- the three phases -------------------------------------------------------------------


def test_all_three_phases_are_recorded(gate, run, engine):
    record = gate.submit(correction(42.0), rationale="rebalancing", based_on=START)
    run.step()
    gate.collect_outcomes()

    assert record.proposal.action.setpoints[f"{PUMP}:frequency_setpoint"] == 42.0
    assert record.proposal.rationale == "rebalancing"
    assert record.proposal.based_on == START

    assert record.applied is not None
    assert record.applied.step_index == 0

    assert record.outcome is not None
    assert record.outcome.observed_at == START + timedelta(minutes=10)
    assert record.outcome.achieved[f"{PUMP}:frequency_setpoint"] == pytest.approx(42.0)
    assert record.outcome.fully_achieved


def test_an_outcome_that_falls_short_is_visible(run):
    # The case worth looking at: applied exactly as proposed, and the machine did not get
    # there. Collapsing the request and the result into one record would hide it.
    engine = run._engine
    engine.ceiling = 38.0
    gate = CorrectionGate(run, METRICS, LIMITS)

    record = gate.submit(correction(48.0), rationale="push the pump", based_on=START)
    run.step()
    gate.collect_outcomes()

    assert record.accepted
    assert not record.outcome.fully_achieved
    assert record.outcome.achieved[f"{PUMP}:frequency_setpoint"] == pytest.approx(38.0)
    assert record.outcome.shortfall[f"{PUMP}:frequency_setpoint"] == pytest.approx(10.0)


def test_an_outcome_reads_the_feedback_not_the_setpoint(run):
    # Reading the setpoint back would only confirm the number was stored. The feedback is
    # what the plant did, which is what an outcome is supposed to say.
    engine = run._engine
    engine.ceiling = 36.0
    gate = CorrectionGate(run, METRICS, LIMITS)
    record = gate.submit(correction(45.0), rationale="test", based_on=START)
    run.step()
    gate.collect_outcomes()
    assert record.outcome.achieved[f"{PUMP}:frequency_setpoint"] == pytest.approx(36.0)


def test_an_outcome_is_not_filled_in_before_its_step_has_run(gate, run):
    record = gate.submit(correction(), rationale="pending", based_on=START)
    assert gate.collect_outcomes() == ()
    assert record.outcome is None

    run.step()
    assert gate.collect_outcomes() == (record,)


def test_collecting_twice_does_not_refill(gate, run):
    gate.submit(correction(), rationale="once", based_on=START)
    run.step()
    assert len(gate.collect_outcomes()) == 1
    assert gate.collect_outcomes() == ()


# --- the ledger -------------------------------------------------------------------------


def test_rejected_proposals_are_recorded_too(gate, run):
    # What was proposed and refused is as much a part of the account as what was applied.
    gate.submit(correction(42.0), rationale="fine", based_on=START)
    gate.submit(correction(58.0), rationale="too fast", based_on=START)
    run.step()

    assert len(gate.records()) == 2
    assert len(gate.rejected()) == 1
    assert len(gate.applied()) == 1
    assert gate.rejected()[0].proposal.rationale == "too fast"


def test_the_ledger_keeps_proposals_in_order(gate):
    for index in range(4):
        gate.submit(correction(58.0), rationale=f"attempt {index}", based_on=START)
    assert [record.proposal.rationale for record in gate.records()] == [
        f"attempt {index}" for index in range(4)
    ]


def test_a_record_describes_itself(gate, run):
    rejected = gate.submit(correction(58.0), rationale="too fast", based_on=START)
    assert "rejected" in str(rejected)
    assert "out_of_limits" in str(rejected)

    accepted = gate.submit(correction(42.0), rationale="fine", based_on=START)
    assert "waiting for the next step" in str(accepted)
    run.step()
    gate.collect_outcomes()
    assert "applied at step 0, as asked" in str(accepted)


# --- what became of an accepted correction ----------------------------------------------


def test_a_correction_replaced_before_it_ran_is_recorded_as_superseded(gate, run, engine):
    # Two corrections before the next step: only the second runs. The first used to be
    # recorded as applied at that step too, alongside the one that actually ran.
    first = gate.submit(correction(40.0), rationale="first thought", based_on=START)
    second = gate.submit(correction(46.0), rationale="second thought", based_on=START)
    assert first.status is CorrectionStatus.SUPERSEDED

    run.step()
    gate.collect_outcomes()

    assert engine.actions == [second.proposal.action]
    assert first.status is CorrectionStatus.SUPERSEDED
    assert first.applied is None and first.outcome is None
    assert second.status is CorrectionStatus.APPLIED
    assert second.applied.step_index == 0
    assert gate.applied() == (second,)
    assert "replaced by a later correction" in str(first)


def test_a_correction_queued_during_a_step_is_tied_to_the_step_that_ran_it(run, engine):
    # A step is inside the plant when the correction arrives. That step has already taken
    # its action, so the correction runs in the next one — and its record and outcome must
    # say so. It used to be recorded against the step in progress and measured against
    # that step's result.
    import threading

    entered, release = threading.Event(), threading.Event()
    real_step = engine.step

    def slow_step(inputs, action=None):
        entered.set()
        assert release.wait(5.0)
        return real_step(inputs, action)

    engine.step = slow_step
    gate = CorrectionGate(run, METRICS, LIMITS)

    stepping = threading.Thread(target=run.step)
    stepping.start()
    assert entered.wait(5.0)
    record = gate.submit(correction(44.0), rationale="mid-step", based_on=START)
    release.set()
    stepping.join(5.0)

    gate.collect_outcomes()
    assert record.status is CorrectionStatus.QUEUED
    assert engine.actions == [None]

    engine.step = real_step
    run.step()
    gate.collect_outcomes()

    assert engine.actions == [None, record.proposal.action]
    assert record.applied.step_index == 1
    assert record.outcome.observed_at == START + timedelta(minutes=20)
    assert record.outcome.achieved[f"{PUMP}:frequency_setpoint"] == pytest.approx(44.0)


def test_a_correction_still_waiting_when_the_run_stops_is_recorded_as_expired(gate, run):
    record = gate.submit(correction(), rationale="never taken", based_on=START)
    run.stop()
    gate.collect_outcomes()

    assert record.status is CorrectionStatus.EXPIRED
    assert record.applied is None
    assert "run ended" in str(record)


def test_a_correction_still_waiting_when_the_scenario_ends_is_recorded_as_expired():
    # The last step is taken by hand with an action of its own, so the queued correction
    # is left waiting when the scenario runs out. It never ran, and the ledger says so.
    engine = FakeEngine()
    run = Run(engine, scenario(steps=1), config_revision=REVISION, run_id="run-test")
    run.start()
    gate = CorrectionGate(run, METRICS, LIMITS)

    waiting = gate.submit(correction(42.0), rationale="left waiting", based_on=START)
    run.step(correction(38.0))
    assert run.status().state is RunState.STOPPED

    gate.collect_outcomes()
    assert waiting.status is CorrectionStatus.EXPIRED
    assert gate.applied() == ()


# --- the boundary -------------------------------------------------------------------------


def test_nothing_here_reaches_real_equipment():
    # Stated in the module and checked here. An action applies to a simulated plant and
    # to nothing else; a path to physical equipment would be a separate design with its
    # own authorisation.
    import pathlib

    source = (
        pathlib.Path(__file__).resolve().parents[2]
        / "src" / "hvac_agent" / "simulation" / "corrections.py"
    ).read_text(encoding="utf-8")
    for forbidden in ("requests", "http", "modbus", "bacnet", "socket"):
        assert forbidden not in source.lower().replace("throughput", "")


def test_the_gate_does_not_decide_what_to_correct():
    # Deciding belongs to pilot/, which is not part of this work. A gate that also
    # proposed would have no independent standard to judge a proposal by.
    import inspect

    from hvac_agent.simulation import corrections

    names = [name for name, _ in inspect.getmembers(corrections, inspect.isfunction)]
    assert not any("propose" in name or "decide" in name for name in names)


# --- held until released ------------------------------------------------------------------


def test_a_correction_holds_at_every_later_step(gate, run, engine):
    gate.submit(correction(44.0), rationale="hold it", based_on=START)
    for _ in range(3):
        run.step()
    assert [a.setpoints for a in engine.actions] == [{f"{PUMP}:frequency_setpoint": 44.0}] * 3


def test_releasing_a_point_is_a_correction_the_gate_accepts(gate, run):
    gate.submit(correction(44.0), rationale="hold it", based_on=START)
    run.step()
    record = gate.submit(
        Action(mode=ControlMode.MANUAL, release={f"{PUMP}:frequency_setpoint"},
               run_id="run-test", issued_at=START),
        rationale="back to the baseline",
        based_on=START + timedelta(minutes=10),
    )
    assert record.accepted
    run.step()
    gate.collect_outcomes()
    assert record.status is CorrectionStatus.APPLIED
    assert run.overrides() == {}


def test_releasing_a_reading_is_rejected(gate):
    record = gate.submit(
        Action(mode=ControlMode.MANUAL, release={f"{CHILLER}:evaporator_outlet_temp"},
               run_id="run-test", issued_at=START),
        rationale="not a handle",
        based_on=START,
    )
    assert record.rejection is Rejection.UNKNOWN_POINT
