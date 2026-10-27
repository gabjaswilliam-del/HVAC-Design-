"""A simulation run: its lifecycle, its clock, and what it produced.

A run is one execution of a scenario against a plant. It owns the simulated clock, the
sequence of observations, and the state it is in. Nothing outside it advances simulated
time, which is the difference between a simulator you can reason about and one where two
callers can disagree about what time it is.

The reference controller for the prototype dashboard got three things right that are
copied here, and two wrong that are not.

Right: a **generation counter**, so a runner thread that was sleeping through a
`pause()` and a `play()` notices it is stale and exits rather than stepping the run a
second time in parallel. **`pause()` and `stop()` do not wait on the plant**, so they
take effect at the next step boundary instead of queueing behind a step already running.
And a **`last_error` on the status**, so a run that failed says so rather than merely
stopping.

Wrong, and deliberately not copied: starting and stopping the run when a browser
connects and disconnects, which makes a long simulation a property of someone's open tab;
and a `loop` flag that restarts the scenario from the beginning without restarting the
clock, so recorded time silently stops being monotonic.

There are also no frame listeners here. The prototype pushes each frame to registered
callbacks, which means a slow consumer — an agent thinking about what it just saw — holds
up the next step. Consumers poll `status()`, `observe()` and `history_since()` instead,
so nothing a consumer does can slow the run down.
"""

from __future__ import annotations

import threading
import uuid
from dataclasses import dataclass
from datetime import datetime, timedelta
from enum import StrEnum
from typing import Protocol

from hvac_agent.core.actions import Action, ControlMode
from hvac_agent.core.observation import Observation

__all__ = [
    "PlantEngine",
    "PlantInputs",
    "Run",
    "RunClockError",
    "RunState",
    "RunStateError",
    "RunStatus",
    "Scenario",
    "ScenarioError",
    "Submission",
    "SubmissionState",
]


class RunState(StrEnum):
    """Where a run is in its life.

    `FAILED` is separate from `STOPPED` because the difference matters to whoever reads
    the result: a stopped run finished its scenario, a failed one did not, and both have
    a history worth keeping.
    """

    CREATED = "created"
    RUNNING = "running"
    PAUSED = "paused"
    STOPPED = "stopped"
    FAILED = "failed"

    @property
    def is_final(self) -> bool:
        return self in (RunState.STOPPED, RunState.FAILED)


class SubmissionState(StrEnum):
    """What became of an action handed to `submit_action`."""

    QUEUED = "queued"
    """Waiting for the next step to take it."""

    SUPERSEDED = "superseded"
    """Replaced by a later submission before any step took it. It never ran."""

    APPLIED = "applied"
    """Taken by a step; `Submission.step_index` says which."""

    EXPIRED = "expired"
    """The run ended before a step took it. It never ran."""


@dataclass(frozen=True, slots=True)
class Submission:
    """One submitted action and what became of it.

    `step_index` is set only once a step has taken the action, and is the index of that
    step as it was read when the action was taken — never a prediction made when it was
    submitted.
    """

    number: int
    state: SubmissionState
    step_index: int | None = None


class ScenarioError(ValueError):
    """Raised for a scenario that could not produce a meaningful run."""


class RunStateError(RuntimeError):
    """Raised for an operation the run's current state does not allow."""


class RunClockError(RuntimeError):
    """Raised when the plant's reported time and the run's clock disagree."""


@dataclass(frozen=True, slots=True)
class PlantInputs:
    """What the world does to the plant during one step.

    The load and the weather, not the controls. Controls are either the baseline's
    decision or an action handed in, and neither belongs to the scenario.
    """

    cooling_load_kw: float
    dry_bulb_temp_c: float
    relative_humidity_percent: float


@dataclass(frozen=True, slots=True)
class Scenario:
    """What to simulate: a start time, a step length, and a bounded series of inputs.

    Bounded on purpose. The prototype can loop a scenario, which restarts its inputs
    without restarting its clock, and the recorded timeline stops being monotonic without
    anything saying so. A run here ends when its inputs run out; simulating a longer
    period means a longer scenario.
    """

    name: str
    start: datetime
    inputs: tuple[PlantInputs, ...]
    step_minutes: float = 10.0

    def __post_init__(self) -> None:
        if self.start.tzinfo is None:
            raise ScenarioError("scenario start must be timezone-aware")
        if self.step_minutes <= 0.0:
            raise ScenarioError(f"step_minutes must be positive, got {self.step_minutes}")
        if not self.inputs:
            raise ScenarioError("a scenario needs at least one step of inputs")

    @property
    def steps(self) -> int:
        return len(self.inputs)

    @property
    def end(self) -> datetime:
        return self.start + timedelta(minutes=self.step_minutes * self.steps)


@dataclass(frozen=True, slots=True)
class RunStatus:
    """A snapshot a consumer can poll without touching the run.

    Immutable, so a caller that holds one while the run continues is looking at a moment
    rather than at a changing object.
    """

    run_id: str
    state: RunState
    scenario_name: str
    simulated_time: datetime | None
    steps_taken: int
    steps_total: int
    config_revision: str
    last_error: str | None = None

    @property
    def is_complete(self) -> bool:
        return self.steps_taken >= self.steps_total


class PlantEngine(Protocol):
    """What a run needs a plant to be able to do.

    `observe` is the part the reference implementations lack. There, the only way to read
    a plant's state is to step it, so a dashboard refresh and an agent's question both
    advance simulated time. Here reading and advancing are different operations, and only
    `step` moves the clock.
    """

    step_minutes: float

    def reset(self, start: datetime) -> Observation:
        """Return the plant to its initial state at `start` and report it."""

    def step(self, inputs: PlantInputs, action: Action | None = None) -> Observation:
        """Advance one control step and report the result."""

    def observe(self) -> Observation:
        """Report the current state without advancing time."""


class Run:
    """One execution of a scenario, with its own clock and history.

    Thread-safe, with two locks rather than one, and that split is the whole reason
    `pause()` works. `_engine_lock` serialises calls into the plant and is held for as
    long as a step takes. `_state_lock` guards the run's own bookkeeping and is never
    held across an engine call, so `pause()`, `stop()` and `status()` answer immediately
    even while a step is in progress. A single lock would make each of them queue behind
    the step it was meant to interrupt or report on — which is what happened in the first
    version of this class, and is why the test measuring how long `pause()` takes exists.

    `play()` steps the scenario on a background thread; `step()` advances it by hand,
    which is what a test or a batch comparison wants. The two never run at once.
    """

    def __init__(
        self,
        engine: PlantEngine,
        scenario: Scenario,
        *,
        config_revision: str,
        run_id: str | None = None,
        step_interval_seconds: float = 0.0,
    ) -> None:
        if abs(engine.step_minutes - scenario.step_minutes) > 1e-9:
            raise ScenarioError(
                f"the scenario steps every {scenario.step_minutes} minutes but the plant "
                f"steps every {engine.step_minutes}; one of them is describing a "
                f"different simulation"
            )

        self.run_id = run_id or f"run-{uuid.uuid4().hex[:12]}"
        self.scenario = scenario
        self.config_revision = config_revision

        self._engine = engine
        self._interval = float(step_interval_seconds)
        self._engine_lock = threading.RLock()
        self._state_lock = threading.RLock()
        self._finished = threading.Event()

        # Read and written without either lock. A runner checks them between steps, so a
        # pause takes effect at the next boundary without anything having to wait.
        self._playing = False
        self._generation = 0

        self._state = RunState.CREATED
        self._simulated_time: datetime | None = None
        self._steps_taken = 0
        self._history: list[Observation] = []
        self._last_error: str | None = None
        self._runner: threading.Thread | None = None
        # The one action waiting for the next step, with its submission number, and the
        # record of every submission so far. Both only ever touched holding the state
        # lock, so an action is taken and its step recorded in one indivisible move.
        self._pending: tuple[int, Action] | None = None
        self._submissions: dict[int, Submission] = {}
        # Every point currently set by hand, and its value. A manual setpoint holds from
        # the step that takes it until replaced or released, so this is what the plant is
        # given each step, not the last action alone.
        self._overrides: dict[str, float] = {}

    # --- lifecycle ---------------------------------------------------------------------

    def start(self) -> RunStatus:
        """Put the plant into its initial state and record the first observation.

        Separate from `play()` because a run that has started but is not playing is a
        useful state: it can be stepped by hand, and its initial observation is already
        there to look at.
        """
        with self._engine_lock:
            with self._state_lock:
                if self._state is not RunState.CREATED:
                    raise RunStateError(
                        f"a run can only be started once (it is {self._state})"
                    )
            try:
                observation = self._engine.reset(self.scenario.start)
            except Exception as error:
                self._fail(error)
                raise
            with self._state_lock:
                self._simulated_time = self.scenario.start
                self._history.append(observation)
                self._state = RunState.PAUSED
                return self._status()

    def play(self) -> RunStatus:
        """Step the scenario on a background thread until it ends or is paused.

        The run does not depend on anything watching it. Nothing here knows whether a
        dashboard is connected, and closing one does not stop the simulation.
        """
        with self._state_lock:
            if self._state is RunState.CREATED:
                raise RunStateError("call start() before play()")
            if self._state.is_final:
                raise RunStateError(f"a {self._state} run cannot play again")
            if self._playing:
                return self._status()
            if self._steps_taken >= self.scenario.steps:
                return self._status()

            self._state = RunState.RUNNING
            self._playing = True
            self._finished.clear()
            # A runner that was sleeping through a pause() and this play() sees a stale
            # generation and exits, instead of stepping the run alongside its successor.
            self._generation += 1
            generation = self._generation
            self._runner = threading.Thread(
                target=self._loop,
                args=(generation,),
                name=f"{self.run_id}-runner",
                daemon=True,
            )
            self._runner.start()
            return self._status()

    def pause(self) -> RunStatus:
        """Stop stepping at the next boundary.

        Takes only the state lock, never the engine lock. A step in progress holds the
        engine lock for as long as the plant takes, and a pause that waited for it would
        not take effect until after the step it was meant to stop.
        """
        self._playing = False
        self._generation += 1
        with self._state_lock:
            if self._state is RunState.RUNNING:
                self._state = RunState.PAUSED
            return self._status()

    def stop(self) -> RunStatus:
        """End the run. Terminal: a stopped run cannot be played again.

        Takes only the state lock, for the same reason as `pause`.
        """
        self._playing = False
        self._generation += 1
        with self._state_lock:
            if not self._state.is_final:
                self._state = RunState.STOPPED
            self._expire_pending()
            self._finished.set()
            return self._status()

    # --- stepping ----------------------------------------------------------------------

    def step(self, action: Action | None = None) -> Observation:
        """Advance exactly one step, by hand.

        Raises:
            RunStateError: if the run has not started, has finished, or is playing.
                Stepping a playing run would advance the clock from two places at once.
        """
        with self._state_lock:
            if self._playing:
                raise RunStateError("pause() before stepping a playing run by hand")
        with self._engine_lock:
            with self._state_lock:
                self._require_steppable()
            return self._step_holding_engine(action)

    def submit_action(self, action: Action) -> int:
        """Queue an action for the next step.

        A run that is playing cannot be stepped by hand, but it can still be corrected —
        this is the path for that. The action waits for the next step whichever way that
        step comes.

        Only one action can be pending. A second submission replaces the first, because
        two corrections computed against the same observation are alternatives rather
        than a sequence, and applying both would mean applying a state nobody proposed.
        The replaced one is recorded as superseded: it never ran.

        This does not say which step will take the action, because it cannot know. It
        used to return the current step count, which is wrong whenever a step is already
        inside the plant — that step has taken its action, so this one waits for the
        next. Which step took it is recorded when it is taken; ask `submission()`.

        Returns:
            The submission number, for `submission()`.

        Raises:
            RunStateError: if the run cannot take another step.
        """
        with self._state_lock:
            self._require_steppable()
            if self._pending is not None:
                replaced, _ = self._pending
                self._submissions[replaced] = Submission(replaced, SubmissionState.SUPERSEDED)
            number = len(self._submissions)
            self._submissions[number] = Submission(number, SubmissionState.QUEUED)
            self._pending = (number, action)
            return number

    def submission(self, number: int) -> Submission:
        """What became of a submitted action. Answers immediately, like `status()`.

        Raises:
            KeyError: for a number this run never issued.
        """
        with self._state_lock:
            return self._submissions[number]

    def overrides(self) -> dict[str, float]:
        """Every point currently set by hand, and its value. A copy; answers immediately."""
        with self._state_lock:
            return dict(self._overrides)

    def _hold(self, taken: Action | None) -> Action | None:
        """Fold the action a step has taken into what is held, and say what is in force.

        Holding the state lock. A manual action sets or releases the points it names; a
        PLC action releases everything. The plant is handed the whole set in force, so it
        needs no memory of earlier steps, and `None` when nothing is set by hand.
        """
        if taken is not None:
            if taken.mode is ControlMode.PLC:
                self._overrides.clear()
            else:
                for point in taken.release:
                    self._overrides.pop(point, None)
                self._overrides.update(taken.setpoints)
        if not self._overrides:
            return None
        return Action(
            mode=ControlMode.MANUAL,
            setpoints=dict(self._overrides),
            run_id=self.run_id,
            issued_at=taken.issued_at if taken is not None else None,
        )

    def _expire_pending(self) -> None:
        """The run has ended; an action still waiting will never run. Holding the state lock."""
        if self._pending is not None:
            number, _ = self._pending
            self._submissions[number] = Submission(number, SubmissionState.EXPIRED)
            self._pending = None

    def _require_steppable(self) -> None:
        """Preconditions for a step. Called holding the state lock."""
        if self._state is RunState.CREATED:
            raise RunStateError("call start() before step()")
        if self._state.is_final:
            raise RunStateError(f"a {self._state} run cannot be stepped")
        if self._steps_taken >= self.scenario.steps:
            raise RunStateError("the scenario has no more steps")

    def _step_holding_engine(self, action: Action | None = None) -> Observation:
        """One step. The caller holds the engine lock; the state lock is taken briefly."""
        # Reading the step index and taking the pending action happen under one hold of
        # the state lock, and the record of which step took it is written in the same
        # hold. A submission that arrives after this point waits for the next step, and
        # is recorded against that one when it is taken there.
        with self._state_lock:
            index = self._steps_taken
            if action is None and self._pending is not None:
                number, action = self._pending
                self._pending = None
                self._submissions[number] = Submission(
                    number, SubmissionState.APPLIED, step_index=index
                )
            in_force = self._hold(action)
        inputs = self.scenario.inputs[index]

        try:
            observation = self._engine.step(inputs, in_force)
        except Exception as error:
            self._fail(error)
            raise

        expected = self.scenario.start + timedelta(
            minutes=self.scenario.step_minutes * (index + 1)
        )
        # The clock belongs to the run. The reference takes a timestamp from its caller
        # and never checks it, so a caller that repeats or rewinds one desynchronises the
        # recorded timeline from the simulated one with nothing to show for it.
        if observation.timestamp != expected:
            drift = RunClockError(
                f"the plant reported {observation.timestamp.isoformat()} for step "
                f"{index + 1}, but the run's clock says {expected.isoformat()}"
            )
            self._fail(drift)
            raise drift

        with self._state_lock:
            self._simulated_time = expected
            self._steps_taken = index + 1
            self._history.append(observation)
            if self._steps_taken >= self.scenario.steps:
                self._playing = False
                self._state = RunState.STOPPED
                self._expire_pending()
                self._finished.set()
        return observation

    def _loop(self, generation: int) -> None:
        while True:
            # Checked before the lock and again after taking it: the first keeps a stale
            # runner from competing for the lock at all, the second covers a pause that
            # landed while this one was waiting for it.
            if not self._playing or generation != self._generation:
                return
            with self._engine_lock:
                if not self._playing or generation != self._generation:
                    return
                with self._state_lock:
                    if self._state is not RunState.RUNNING:
                        return
                    if self._steps_taken >= self.scenario.steps:
                        return
                try:
                    self._step_holding_engine()
                except Exception:
                    # Already recorded on the status by _fail. A runner thread has nobody
                    # to raise to, which is exactly why last_error exists.
                    return
            if self._interval > 0.0:
                # Outside both locks, so pause() and stop() are not waiting on a sleep.
                if self._finished.wait(self._interval):
                    return

    # --- reading ------------------------------------------------------------------------

    def observe(self) -> Observation:
        """The plant's current state, without advancing anything.

        Two calls in a row return the same observation and the clock does not move. This
        is the operation the reference implementations do not have: there, reading the
        plant means stepping it, so a dashboard refresh costs a step of simulated time.
        """
        with self._state_lock:
            if self._state is RunState.CREATED:
                raise RunStateError("call start() before observe()")
        with self._engine_lock:
            return self._engine.observe()

    def status(self) -> RunStatus:
        """Answers immediately, even while a step is in progress."""
        with self._state_lock:
            return self._status()

    def history(self) -> tuple[Observation, ...]:
        """Every observation this run has produced, including the initial one."""
        with self._state_lock:
            return tuple(self._history)

    def history_since(self, index: int) -> tuple[Observation, ...]:
        """Observations from `index` onwards, for a consumer polling for what is new.

        Polling is how consumers keep up, rather than being pushed to. A consumer that
        takes a long time over what it reads delays only itself.
        """
        with self._state_lock:
            return tuple(self._history[max(0, index) :])

    def wait(self, timeout: float | None = None) -> bool:
        """Block until the run finishes. Returns whether it did.

        For a caller that wants a whole scenario as a batch. Nothing inside the run uses
        it, so a run never waits on anyone.
        """
        return self._finished.wait(timeout)

    # --- internals -----------------------------------------------------------------------

    def _status(self) -> RunStatus:
        return RunStatus(
            run_id=self.run_id,
            state=self._state,
            scenario_name=self.scenario.name,
            simulated_time=self._simulated_time,
            steps_taken=self._steps_taken,
            steps_total=self.scenario.steps,
            config_revision=self.config_revision,
            last_error=self._last_error,
        )

    def _fail(self, error: Exception) -> None:
        """Record a failure and end the run, keeping everything it produced first."""
        self._playing = False
        self._generation += 1
        with self._state_lock:
            self._state = RunState.FAILED
            self._last_error = f"{type(error).__name__}: {error}"
            self._expire_pending()
        self._finished.set()
