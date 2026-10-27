"""The run lifecycle, against a deterministic plant rather than a real one.

The engine here does no physics. That is the point: every property under test — that the
clock only moves forward, that a paused run stays paused, that a stale runner thread does
not step the run alongside its successor — is a property of the run, not of the plant.
Driving it with real physics would make these tests slow and would make a failure
ambiguous between the two.

The fake engine can be told to be slow, to fail, or to lie about the time, which is how
the failure paths get covered at all.
"""

from __future__ import annotations

import threading
import time
from datetime import UTC, datetime, timedelta

import pytest

from hvac_agent.core.actions import Action, ControlMode
from hvac_agent.core.observation import Observation, Origin
from hvac_agent.simulation.run import (
    PlantInputs,
    Run,
    RunClockError,
    RunState,
    RunStateError,
    Scenario,
    ScenarioError,
    Submission,
    SubmissionState,
)

START = datetime(2026, 7, 1, 0, 0, tzinfo=UTC)
REVISION = "rev1-nameplate"


class FakeEngine:
    """A plant that only keeps time, plus whatever misbehaviour a test asks for."""

    def __init__(
        self,
        *,
        step_minutes: float = 10.0,
        step_delay: float = 0.0,
        fail_at: int | None = None,
        clock_drift_at: int | None = None,
    ) -> None:
        self.step_minutes = step_minutes
        self.step_delay = step_delay
        self.fail_at = fail_at
        self.clock_drift_at = clock_drift_at

        self.run_id = "run-test"
        self.steps = 0
        self.resets = 0
        self.observes = 0
        self.now = START
        self.seen: list[PlantInputs] = []

    def _observation(self) -> Observation:
        return Observation(
            timestamp=self.now,
            origin=Origin.SIMULATED,
            config_revision=REVISION,
            run_id=self.run_id,
            points={},
        )

    def reset(self, start: datetime) -> Observation:
        self.resets += 1
        self.steps = 0
        self.now = start
        return self._observation()

    def step(self, inputs: PlantInputs, action=None) -> Observation:
        if self.step_delay:
            time.sleep(self.step_delay)
        self.steps += 1
        self.seen.append(inputs)
        if self.fail_at is not None and self.steps == self.fail_at:
            raise RuntimeError("the header did not balance")
        self.now = self.now + timedelta(minutes=self.step_minutes)
        if self.clock_drift_at is not None and self.steps == self.clock_drift_at:
            self.now = self.now + timedelta(minutes=1)
        return self._observation()

    def observe(self) -> Observation:
        self.observes += 1
        return self._observation()


def scenario(steps: int = 6, **overrides) -> Scenario:
    defaults = dict(
        name="a summer afternoon",
        start=START,
        inputs=tuple(
            PlantInputs(
                cooling_load_kw=400.0 + 10.0 * index,
                dry_bulb_temp_c=32.0,
                relative_humidity_percent=70.0,
            )
            for index in range(steps)
        ),
        step_minutes=10.0,
    )
    defaults.update(overrides)
    return Scenario(**defaults)


def make_run(engine: FakeEngine | None = None, steps: int = 6, **kwargs) -> Run:
    return Run(
        engine or FakeEngine(), scenario(steps), config_revision=REVISION, **kwargs
    )


# --- the scenario ---------------------------------------------------------------------


def test_a_scenario_must_carry_a_timezone():
    # Simulated and real observations sit side by side, and a naive timestamp makes the
    # comparison wrong an hour at a time without saying so.
    with pytest.raises(ScenarioError, match="timezone-aware"):
        scenario(start=datetime(2026, 7, 1))


def test_a_scenario_must_have_inputs():
    with pytest.raises(ScenarioError, match="at least one step"):
        scenario(inputs=())


def test_a_scenario_knows_when_it_ends():
    assert scenario(6).end == START + timedelta(minutes=60)


def test_a_plant_that_steps_differently_from_the_scenario_is_rejected():
    with pytest.raises(ScenarioError, match="different simulation"):
        Run(FakeEngine(step_minutes=1.0), scenario(), config_revision=REVISION)


# --- state transitions ----------------------------------------------------------------


def test_a_new_run_has_not_started(engine=None):
    run = make_run()
    status = run.status()
    assert status.state is RunState.CREATED
    assert status.steps_taken == 0
    assert status.simulated_time is None
    assert status.run_id.startswith("run-")


def test_starting_resets_the_plant_and_records_where_it_began():
    engine = FakeEngine()
    run = make_run(engine)
    status = run.start()

    assert engine.resets == 1
    assert status.state is RunState.PAUSED
    assert status.simulated_time == START
    assert len(run.history()) == 1


def test_a_run_starts_only_once():
    run = make_run()
    run.start()
    with pytest.raises(RunStateError, match="only be started once"):
        run.start()


def test_stepping_before_starting_is_refused():
    with pytest.raises(RunStateError, match="call start"):
        make_run().step()


def test_observing_before_starting_is_refused():
    with pytest.raises(RunStateError, match="call start"):
        make_run().observe()


def test_playing_before_starting_is_refused():
    with pytest.raises(RunStateError, match="call start"):
        make_run().play()


def test_a_stopped_run_is_final():
    run = make_run()
    run.start()
    run.stop()

    assert run.status().state is RunState.STOPPED
    with pytest.raises(RunStateError, match="cannot play again"):
        run.play()
    with pytest.raises(RunStateError, match="cannot be stepped"):
        run.step()


def test_stopping_twice_is_harmless():
    run = make_run()
    run.start()
    assert run.stop().state is RunState.STOPPED
    assert run.stop().state is RunState.STOPPED


# --- the clock ------------------------------------------------------------------------


def test_each_step_advances_the_clock_by_exactly_one_interval():
    run = make_run(steps=4)
    run.start()
    for expected in range(1, 5):
        run.step()
        assert run.status().simulated_time == START + timedelta(minutes=10 * expected)


def test_the_recorded_timeline_is_strictly_monotonic():
    run = make_run(steps=6)
    run.start()
    while run.status().steps_taken < 6:
        run.step()

    stamps = [observation.timestamp for observation in run.history()]
    assert stamps == sorted(stamps)
    assert len(set(stamps)) == len(stamps)


def test_a_plant_disagreeing_with_the_run_about_the_time_fails_the_run():
    # The reference takes its timestamp from the caller and never checks it, so a caller
    # that repeats or rewinds one desynchronises the recorded timeline from the simulated
    # one and nothing notices.
    run = make_run(FakeEngine(clock_drift_at=2), steps=5)
    run.start()
    run.step()
    with pytest.raises(RunClockError):
        run.step()

    status = run.status()
    assert status.state is RunState.FAILED
    assert "clock" in (status.last_error or "").lower()


def test_a_scenario_ends_rather_than_looping():
    # The prototype can loop a scenario, which restarts its inputs without restarting its
    # clock. A run here simply ends.
    run = make_run(steps=3)
    run.start()
    for _ in range(3):
        run.step()

    assert run.status().state is RunState.STOPPED
    assert run.status().is_complete
    # It reached the end, so the run is stopped and refuses a further step for that
    # reason rather than for running out of inputs.
    with pytest.raises(RunStateError, match="cannot be stepped"):
        run.step()


# --- observing does not advance anything ----------------------------------------------


def test_observing_twice_gives_the_same_answer_and_does_not_move_the_clock():
    # The operation the reference implementations do not have: there, reading the plant
    # means stepping it, so a dashboard refresh costs a step of simulated time.
    engine = FakeEngine()
    run = make_run(engine)
    run.start()
    run.step()

    before = run.status()
    first, second = run.observe(), run.observe()

    assert first == second
    assert run.status().simulated_time == before.simulated_time
    assert run.status().steps_taken == before.steps_taken
    assert engine.steps == 1
    assert engine.observes == 2


def test_observing_does_not_add_to_the_history():
    run = make_run()
    run.start()
    run.step()
    before = len(run.history())
    run.observe()
    run.observe()
    assert len(run.history()) == before


# --- playing --------------------------------------------------------------------------


def test_playing_runs_the_scenario_to_its_end():
    engine = FakeEngine()
    run = make_run(engine, steps=5)
    run.start()
    run.play()

    assert run.wait(timeout=5.0), "the run did not finish"
    status = run.status()
    assert status.state is RunState.STOPPED
    assert status.steps_taken == 5
    assert engine.steps == 5


def test_a_run_needs_nothing_watching_it():
    # No listeners, no callbacks, no connection. The prototype starts and stops its run
    # when a browser connects and disconnects, which makes a long simulation a property
    # of somebody's open tab.
    run = make_run(steps=4)
    run.start()
    run.play()
    assert run.wait(timeout=5.0)
    assert run.status().steps_taken == 4


def test_the_inputs_are_consumed_in_order():
    engine = FakeEngine()
    run = make_run(engine, steps=5)
    run.start()
    run.play()
    run.wait(timeout=5.0)

    assert [inputs.cooling_load_kw for inputs in engine.seen] == [
        400.0,
        410.0,
        420.0,
        430.0,
        440.0,
    ]


def test_playing_an_already_playing_run_does_not_start_a_second_runner():
    engine = FakeEngine(step_delay=0.02)
    run = make_run(engine, steps=6, step_interval_seconds=0.01)
    run.start()
    run.play()
    run.play()
    run.play()
    assert run.wait(timeout=5.0)
    assert engine.steps == 6, "the scenario was stepped more times than it has steps"


# --- pause ----------------------------------------------------------------------------


def test_pause_returns_without_waiting_for_a_step_in_progress():
    # The reason pause() takes no lock. With the lock it would return only after the step
    # it was meant to stop had finished.
    engine = FakeEngine(step_delay=0.5)
    run = make_run(engine, steps=10)
    run.start()
    run.play()
    time.sleep(0.05)  # let the runner get into a step

    began = time.monotonic()
    run.pause()
    elapsed = time.monotonic() - began

    assert elapsed < 0.2, f"pause() waited {elapsed:.3f}s for the step in progress"
    assert run.status().state is RunState.PAUSED


def test_a_paused_run_stops_stepping():
    engine = FakeEngine(step_delay=0.01)
    run = make_run(engine, steps=50, step_interval_seconds=0.01)
    run.start()
    run.play()
    time.sleep(0.05)
    run.pause()

    settled = engine.steps
    time.sleep(0.1)
    assert engine.steps <= settled + 1, "the run kept stepping after pause()"


def test_pausing_and_playing_again_does_not_step_the_run_twice():
    # The generation counter. A runner that was sleeping through pause() and play() sees
    # a stale generation and exits, instead of stepping alongside its successor. Without
    # it, each pause/play cycle leaves another thread advancing the same clock.
    engine = FakeEngine()
    run = make_run(engine, steps=30, step_interval_seconds=0.02)
    run.start()

    for _ in range(5):
        run.play()
        time.sleep(0.03)
        run.pause()
        time.sleep(0.01)

    run.play()
    assert run.wait(timeout=5.0)
    assert engine.steps == 30, f"the scenario was stepped {engine.steps} times, not 30"
    assert threading.active_count() < 10, "runner threads were left behind"


def test_resuming_carries_on_from_where_it_paused():
    engine = FakeEngine(step_delay=0.01)
    run = make_run(engine, steps=12, step_interval_seconds=0.01)
    run.start()
    run.play()
    time.sleep(0.05)
    run.pause()

    at_pause = run.status().steps_taken
    assert 0 < at_pause < 12

    run.play()
    assert run.wait(timeout=5.0)
    assert run.status().steps_taken == 12
    # No step was repeated and none was skipped.
    assert [inputs.cooling_load_kw for inputs in engine.seen] == [
        400.0 + 10.0 * index for index in range(12)
    ]


def test_stepping_by_hand_while_playing_is_refused():
    # Two things advancing one clock is the bug the generation counter exists to prevent;
    # this closes the same door from the other side.
    run = make_run(FakeEngine(step_delay=0.05), steps=20, step_interval_seconds=0.01)
    run.start()
    run.play()
    time.sleep(0.02)
    with pytest.raises(RunStateError, match="pause\\(\\) before stepping"):
        run.step()
    run.stop()


def test_stop_ends_a_playing_run_promptly():
    engine = FakeEngine(step_delay=0.01)
    run = make_run(engine, steps=200, step_interval_seconds=0.05)
    run.start()
    run.play()
    time.sleep(0.03)

    began = time.monotonic()
    run.stop()
    assert time.monotonic() - began < 0.2
    assert run.status().state is RunState.STOPPED


# --- failure --------------------------------------------------------------------------


def test_a_failing_step_fails_the_run_and_says_why():
    run = make_run(FakeEngine(fail_at=3), steps=6)
    run.start()
    run.step()
    run.step()
    with pytest.raises(RuntimeError, match="did not balance"):
        run.step()

    status = run.status()
    assert status.state is RunState.FAILED
    assert "did not balance" in (status.last_error or "")


def test_a_failure_while_playing_is_reported_rather_than_lost():
    # A runner thread has nobody to raise to. This is what last_error is for: without it
    # a failed run is indistinguishable from one that simply stopped.
    run = make_run(FakeEngine(fail_at=2), steps=8)
    run.start()
    run.play()
    assert run.wait(timeout=5.0)

    status = run.status()
    assert status.state is RunState.FAILED
    assert status.last_error is not None
    assert status.steps_taken < 8


# --- submitted actions ------------------------------------------------------------------


def an_action(hz: float = 40.0) -> Action:
    return Action(
        mode=ControlMode.MANUAL,
        setpoints={"chilled_water_pump_pri_1:frequency_setpoint": hz},
        run_id="run-test",
        issued_at=START,
    )


def test_a_submission_is_numbered_and_waits_for_a_step():
    run = make_run()
    run.start()
    first = run.submit_action(an_action())
    assert run.submission(first) == Submission(first, SubmissionState.QUEUED)


def test_the_step_that_takes_a_submission_is_recorded_when_it_takes_it():
    run = make_run()
    run.start()
    run.step()
    run.step()
    number = run.submit_action(an_action())
    run.step()
    assert run.submission(number) == Submission(number, SubmissionState.APPLIED, step_index=2)


def test_a_second_submission_supersedes_the_first():
    run = make_run()
    run.start()
    first = run.submit_action(an_action(40.0))
    second = run.submit_action(an_action(46.0))
    run.step()
    assert run.submission(first).state is SubmissionState.SUPERSEDED
    assert run.submission(first).step_index is None
    assert run.submission(second) == Submission(second, SubmissionState.APPLIED, step_index=0)


def test_a_submission_arriving_during_a_step_is_taken_by_the_next_one():
    # The step in progress has already taken its action. Returning the current step count
    # from submit_action, as this once did, named the wrong step here.
    engine = FakeEngine()
    entered, release = threading.Event(), threading.Event()
    real_step = engine.step

    def held_step(inputs, action=None):
        entered.set()
        assert release.wait(5.0)
        return real_step(inputs, action)

    engine.step = held_step
    run = make_run(engine)
    run.start()
    stepping = threading.Thread(target=run.step)
    stepping.start()
    assert entered.wait(5.0)
    number = run.submit_action(an_action())
    release.set()
    stepping.join(5.0)
    assert run.submission(number).state is SubmissionState.QUEUED

    engine.step = real_step
    run.step()
    assert run.submission(number) == Submission(number, SubmissionState.APPLIED, step_index=1)


def test_a_submission_left_waiting_by_a_failure_is_expired():
    # The failing step is given an action by hand, so the queued one is never taken.
    run = make_run(FakeEngine(fail_at=2))
    run.start()
    run.step()
    number = run.submit_action(an_action())
    with pytest.raises(RuntimeError):
        run.step(an_action(38.0))
    assert run.submission(number).state is SubmissionState.EXPIRED


def test_a_failed_run_keeps_everything_it_produced():
    run = make_run(FakeEngine(fail_at=4), steps=8)
    run.start()
    run.play()
    run.wait(timeout=5.0)

    # Three successful steps plus the observation start() recorded.
    assert len(run.history()) == 4
    assert run.status().state is RunState.FAILED


def test_a_failed_run_cannot_be_resumed():
    run = make_run(FakeEngine(fail_at=1), steps=4)
    run.start()
    run.play()
    run.wait(timeout=5.0)

    with pytest.raises(RunStateError, match="cannot play again"):
        run.play()


# --- history ---------------------------------------------------------------------------


def test_history_holds_the_initial_observation_and_every_step():
    run = make_run(steps=4)
    run.start()
    for _ in range(4):
        run.step()
    assert len(run.history()) == 5


def test_a_consumer_can_poll_for_what_is_new():
    # Polling rather than being pushed to. A consumer that takes a long time over what it
    # reads — an agent thinking about it — delays only itself, never the run.
    run = make_run(steps=6)
    run.start()
    run.step()
    run.step()

    seen = len(run.history())
    run.step()
    fresh = run.history_since(seen)

    assert len(fresh) == 1
    assert fresh[0].timestamp == START + timedelta(minutes=30)


def test_history_is_a_snapshot_not_a_live_view():
    run = make_run(steps=4)
    run.start()
    snapshot = run.history()
    run.step()
    assert len(snapshot) == 1


def test_every_observation_names_the_run_and_the_configuration():
    # So a recorded result can be traced back to what produced it, and a comparison
    # across a configuration change is detectable rather than silently wrong.
    run = make_run(steps=3)
    run.start()
    run.step()
    for observation in run.history():
        assert observation.origin is Origin.SIMULATED
        assert observation.run_id is not None
        assert observation.config_revision == REVISION


# --- what is held by hand ---------------------------------------------------------------


class RecordingEngine(FakeEngine):
    """Keeps what it was handed each step."""

    def __init__(self, **kwargs) -> None:
        super().__init__(**kwargs)
        self.handed: list[dict[str, float] | None] = []

    def step(self, inputs, action=None):
        self.handed.append(None if action is None else dict(action.setpoints))
        return super().step(inputs, action)


def test_a_manual_setpoint_holds_until_replaced_or_released():
    # A correction is not a one-step nudge. It stays in force at every later step, the
    # plant is handed it each time, and the run says what is held.
    point = "chilled_water_pump_pri_1:frequency_setpoint"
    engine = RecordingEngine()
    run = make_run(engine, steps=6)
    run.start()

    run.submit_action(an_action(40.0))
    run.step()
    run.step()
    assert engine.handed == [{point: 40.0}, {point: 40.0}]
    assert run.overrides() == {point: 40.0}

    run.submit_action(an_action(46.0))
    run.step()
    assert engine.handed[-1] == {point: 46.0}

    run.submit_action(Action(mode=ControlMode.MANUAL, release={point}, run_id="run-test"))
    run.step()
    run.step()
    assert engine.handed[-2:] == [None, None]
    assert run.overrides() == {}


def test_a_later_correction_leaves_other_held_points_alone():
    pump = "chilled_water_pump_pri_1:frequency_setpoint"
    chiller = "chiller_plant_1:chilled_water_temp_set"
    engine = RecordingEngine()
    run = make_run(engine)
    run.start()
    run.submit_action(an_action(40.0))
    run.step()
    run.submit_action(Action(mode=ControlMode.MANUAL, setpoints={chiller: 9.0}, run_id="run-test"))
    run.step()
    assert engine.handed[-1] == {pump: 40.0, chiller: 9.0}


def test_a_plc_action_hands_everything_back_to_the_baseline():
    engine = RecordingEngine()
    run = make_run(engine)
    run.start()
    run.submit_action(an_action(40.0))
    run.step()
    run.submit_action(Action(mode=ControlMode.PLC))
    run.step()
    assert engine.handed[-1] is None
    assert run.overrides() == {}
