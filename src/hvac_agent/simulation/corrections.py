"""Accepting a correction, and recording what became of it.

Something outside this module — a person at a dashboard, or the pilot once that is built
— looks at what the plant is doing and proposes a change. This is the gate that decides
whether the change may be applied, and the ledger of what happened when it was.

The module does not decide what to correct. Deciding belongs to `pilot/`, which is not
part of this work; everything here is about the boundary such a decider talks through.
The separation matters beyond tidiness: a gate that also proposed would have no
independent standard to judge a proposal by.

**A rejection is an ordinary answer, not an error.** A decider that thinks about what it
sees will often finish thinking after the plant has moved on, so a stale proposal is the
normal case rather than a fault. `submit` therefore returns a record saying what
happened instead of raising, and records the rejected ones too — what was proposed and
refused is as much a part of the account as what was applied.

**Three phases, kept separately.** What was proposed, what was actually applied, and what
the plant then did are three different facts, and collapsing them loses the interesting
one. A correction that was applied exactly as proposed and did not achieve what it asked
for is the case worth looking at, and it is only visible if the request and the result
are both recorded.

**Accepted is not applied.** Passing the gate queues a correction; a step taking it is
what applies it, and until then it may be replaced by a later one or outlive the run.
This module once marked a correction applied the moment it was queued, at the step count
of that moment — so a correction replaced before it ran was recorded as applied, and one
queued while a step was inside the plant was tied to that step's result although it ran
in the next. The step that took it is now read from the run, which records it at the
moment of taking.

Nothing here reaches physical equipment. An action applies to a simulated plant and to
nothing else; a path to real equipment would be a separate design with its own
authorisation, not a reuse of this.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from datetime import datetime, timedelta
from enum import StrEnum
from typing import Any, Mapping

from hvac_agent.core.actions import RUNNING_STATE_METRIC, Action, ControlMode
from hvac_agent.core.metrics import DeviceFamily, SiteMetrics, UnknownPointError, split_point
from hvac_agent.core.observation import Observation
from hvac_agent.simulation.run import Run, RunState, RunStateError, SubmissionState

__all__ = [
    "Applied",
    "CorrectionGate",
    "CorrectionRecord",
    "CorrectionStatus",
    "EquipmentLimits",
    "Outcome",
    "Proposal",
    "Rejection",
]

# How far behind the run's clock a proposal may be and still be applied. One step: a
# correction computed from the step before last was computed against a plant that has
# since been through a staging decision, and applying it means acting on a state that no
# longer exists.
DEFAULT_STALENESS_STEPS = 1.0


class Rejection(StrEnum):
    """Why a correction was not applied.

    Each of these is something the reference implementation does not check. There an
    action is a full state dictionary sent to a backend, with no run identity, no notion
    of when it was computed, and no equipment limits between it and the plant.
    """

    RUN_NOT_ACTIVE = "run_not_active"
    """The run has stopped or failed, so there is no next step to apply this to."""

    WRONG_RUN = "wrong_run"
    """The action names a different run. Its observations describe another plant state."""

    STALE = "stale"
    """Computed against an observation the run has since moved past."""

    UNKNOWN_POINT = "unknown_point"
    """A point outside the site's vocabulary, or one that is a reading not a handle."""

    OUT_OF_LIMITS = "out_of_limits"
    """A value the equipment cannot be asked for."""

    MALFORMED = "malformed"
    """Internally inconsistent — a PLC action carrying setpoints, for instance."""


class CorrectionStatus(StrEnum):
    """Where a correction is, from proposal to the step that took it."""

    REJECTED = "rejected"
    """Refused by the gate; `CorrectionRecord.rejection` says why."""

    QUEUED = "queued"
    """Accepted, and waiting for the next step to take it."""

    SUPERSEDED = "superseded"
    """Accepted, then replaced by a later correction before any step took it."""

    APPLIED = "applied"
    """Taken by a step; `CorrectionRecord.applied` says which."""

    EXPIRED = "expired"
    """Accepted, but the run ended before any step took it."""


_FROM_SUBMISSION = {
    SubmissionState.SUPERSEDED: CorrectionStatus.SUPERSEDED,
    SubmissionState.APPLIED: CorrectionStatus.APPLIED,
    SubmissionState.EXPIRED: CorrectionStatus.EXPIRED,
}


@dataclass(frozen=True, slots=True)
class EquipmentLimits:
    """What each commandable point may be set to, for one site.

    Built from `control.yaml`, because these are the site's operating limits rather than
    properties of the vocabulary. `core.actions` deliberately does not check them: a
    minimum pump frequency is per-site data, and an action is built before a site is
    necessarily in hand.
    """

    frequency_hz: Mapping[DeviceFamily, tuple[float, float]]
    chilled_water_temp_set_c: tuple[float, float]

    @classmethod
    def from_control(cls, control: Mapping[str, Any]) -> EquipmentLimits:
        limits = control.get("frequency_limits_hz", {})
        frequency = {}
        for family in DeviceFamily:
            entry = limits.get(str(family))
            if entry is not None:
                frequency[family] = (float(entry["min"]), float(entry["max"]))

        bounds = control.get("setpoints", {}).get("chw_supply_temp_c", {})
        return cls(
            frequency_hz=frequency,
            chilled_water_temp_set_c=(
                float(bounds.get("min", 7.0)),
                float(bounds.get("max", 12.0)),
            ),
        )

    def check(self, setpoints: Mapping[str, float]) -> tuple[str, ...]:
        """Every setpoint outside its limit, described. Empty when all are allowed."""
        problems: list[str] = []
        for point, value in sorted(setpoints.items()):
            device, metric = split_point(point)
            bounds = self._bounds_for(device, metric)
            if bounds is None:
                continue
            low, high = bounds
            if not low <= value <= high:
                problems.append(
                    f"{point} = {value:g}, outside the allowed {low:g} to {high:g}"
                )
        return tuple(problems)

    def _bounds_for(self, device: str, metric: str) -> tuple[float, float] | None:
        from hvac_agent.core.metrics import family_of

        if metric == "chilled_water_temp_set":
            return self.chilled_water_temp_set_c
        if metric == "frequency_setpoint":
            family = family_of(device)
            return self.frequency_hz.get(family) if family is not None else None
        # A running state is zero or one, which `Action` already enforces; nothing else
        # is commandable, which `validate_against` already rejects.
        return None


@dataclass(frozen=True, slots=True)
class Proposal:
    """What was asked for, by whom, on what evidence."""

    action: Action
    rationale: str
    based_on: datetime
    """The timestamp of the observation this was computed from."""


@dataclass(frozen=True, slots=True)
class Applied:
    """What actually went into the plant, and at which step.

    `step_index` is the step that took the action, as the run recorded it when taking it.
    """

    action: Action
    step_index: int


@dataclass(frozen=True, slots=True)
class Outcome:
    """What the plant did about it.

    `achieved` holds the targeted points as they read after the step, and `shortfall` is
    what was asked for less what was reached. A point that reached its setpoint has a
    shortfall of zero; one held back by a staging protection or a frequency floor does
    not, and that is the whole reason to record this separately from the request.
    """

    observed_at: datetime
    achieved: Mapping[str, float]
    shortfall: Mapping[str, float]

    @property
    def fully_achieved(self) -> bool:
        return all(abs(value) < 1e-9 for value in self.shortfall.values())


@dataclass(slots=True)
class CorrectionRecord:
    """One proposal and everything that became of it.

    Mutable only in that later facts arrive later: whether a step took the correction is
    known once one has, and its result at the end of that step. The gate fills both in
    from the run; nothing else writes them.
    """

    proposal: Proposal
    rejection: Rejection | None = None
    reason: str | None = None
    status: CorrectionStatus = CorrectionStatus.QUEUED
    submission: int | None = None
    """The run's number for this submission, once the gate has queued it."""
    applied: Applied | None = None
    outcome: Outcome | None = None

    @property
    def accepted(self) -> bool:
        """Whether the gate let it through — not whether it ran; see `status`."""
        return self.rejection is None

    def __str__(self) -> str:
        if not self.accepted:
            return f"rejected ({self.rejection}): {self.reason}"
        if self.status is CorrectionStatus.QUEUED:
            return "accepted, waiting for the next step"
        if self.status is CorrectionStatus.SUPERSEDED:
            return "accepted, replaced by a later correction before any step took it"
        if self.status is CorrectionStatus.EXPIRED:
            return "accepted, but the run ended before any step took it"
        if self.outcome is None:
            return f"applied at step {self.applied.step_index}, outcome pending"
        reached = "as asked" if self.outcome.fully_achieved else "not fully reached"
        return f"applied at step {self.applied.step_index}, {reached}"


class CorrectionGate:
    """The boundary a correction has to pass, and the ledger of what passed it.

    One gate per run. It holds no opinion about what should be corrected; it decides only
    whether a proposal may be applied, applies it, and records the result.
    """

    def __init__(
        self,
        run: Run,
        metrics: SiteMetrics,
        limits: EquipmentLimits,
        *,
        staleness_steps: float = DEFAULT_STALENESS_STEPS,
    ) -> None:
        self._run = run
        self._metrics = metrics
        self._limits = limits
        self._max_age = timedelta(minutes=run.scenario.step_minutes * staleness_steps)
        self._records: list[CorrectionRecord] = []

    # --- the gate -----------------------------------------------------------------------

    def submit(
        self, action: Action, *, rationale: str, based_on: datetime
    ) -> CorrectionRecord:
        """Judge a correction, apply it if it passes, and record either way.

        Args:
            action: What to change. Partial: points not named are left to the baseline.
            rationale: Why, in the proposer's words. Recorded verbatim and never parsed —
                a result that has to be explained later is worth the sentence.
            based_on: The timestamp of the observation this was computed from.

        Returns:
            The record. `accepted` says whether the gate let it through and `rejection`
            why not; `status` says whether a step has taken it yet.
        """
        proposal = Proposal(action=action, rationale=rationale, based_on=based_on)
        record = CorrectionRecord(proposal=proposal)
        self._records.append(record)

        rejection = self._judge(action, based_on)
        if rejection is not None:
            record.rejection, record.reason = rejection
            record.status = CorrectionStatus.REJECTED
            return record

        try:
            record.submission = self._run.submit_action(action)
        except RunStateError as error:
            record.rejection = Rejection.RUN_NOT_ACTIVE
            record.reason = str(error)
            record.status = CorrectionStatus.REJECTED
            return record

        # This one may have replaced another still waiting; bring the ledger up to date.
        self._refresh()
        return record

    def _refresh(self) -> None:
        """Copy from the run what has become of every correction still waiting."""
        for record in self._records:
            if record.status is not CorrectionStatus.QUEUED or record.submission is None:
                continue
            submission = self._run.submission(record.submission)
            status = _FROM_SUBMISSION.get(submission.state)
            if status is None:
                continue
            record.status = status
            if status is CorrectionStatus.APPLIED:
                record.applied = Applied(
                    action=record.proposal.action, step_index=submission.step_index
                )

    def _judge(
        self, action: Action, based_on: datetime
    ) -> tuple[Rejection, str] | None:
        status = self._run.status()

        if status.state is RunState.CREATED or status.state.is_final:
            return (
                Rejection.RUN_NOT_ACTIVE,
                f"the run is {status.state}, so there is no next step to apply this to",
            )

        if action.run_id is not None and action.run_id != status.run_id:
            return (
                Rejection.WRONG_RUN,
                f"the action names run {action.run_id!r} but this is {status.run_id!r}; "
                "its observations describe a different plant state",
            )

        if action.mode is ControlMode.MANUAL and not action.setpoints and not action.release:
            return (
                Rejection.MALFORMED,
                "a manual action that sets and releases nothing is not a correction",
            )

        now = status.simulated_time
        if now is not None and based_on < now - self._max_age:
            behind = now - based_on
            return (
                Rejection.STALE,
                f"computed from the plant as it was at {based_on.isoformat()}, which is "
                f"{behind} behind the run's clock at {now.isoformat()}; the plant has "
                f"moved on",
            )
        if now is not None and based_on > now:
            return (
                Rejection.STALE,
                f"computed from {based_on.isoformat()}, which is ahead of the run's "
                f"clock at {now.isoformat()}",
            )

        try:
            action.validate_against(self._metrics)
        except UnknownPointError as error:
            return (Rejection.UNKNOWN_POINT, str(error))
        except ValueError as error:
            message = str(error)
            if "readings, not handles" in message:
                return (Rejection.UNKNOWN_POINT, message)
            return (Rejection.MALFORMED, message)

        problems = self._limits.check(action.setpoints)
        if problems:
            return (Rejection.OUT_OF_LIMITS, "; ".join(problems))

        return None

    # --- the ledger ---------------------------------------------------------------------

    def collect_outcomes(self) -> tuple[CorrectionRecord, ...]:
        """Fill in the outcome of every applied correction whose step has finished.

        Called by whoever is watching the run. It reads the run's history rather than
        being pushed to, for the same reason the run has no frame listeners: a consumer
        that is slow must not be able to hold up a step.

        Returns:
            The records whose outcome was filled in by this call.
        """
        self._refresh()
        history = self._run.history()
        filled: list[CorrectionRecord] = []

        for record in self._records:
            if record.applied is None or record.outcome is not None:
                continue
            # history[0] is the state at the start; the result of step n is history[n+1].
            index = record.applied.step_index + 1
            if index >= len(history):
                continue
            record.outcome = self._measure(record.applied.action, history[index])
            filled.append(record)
        return tuple(filled)

    def _measure(self, action: Action, observation: Observation) -> Outcome:
        achieved: dict[str, float] = {}
        shortfall: dict[str, float] = {}
        for point, requested in action.setpoints.items():
            measured = self._reading_for(point, observation)
            if measured is None:
                continue
            achieved[point] = measured
            shortfall[point] = requested - measured
        return Outcome(
            observed_at=observation.timestamp,
            achieved=achieved,
            shortfall=shortfall,
        )

    def _reading_for(self, point: str, observation: Observation) -> float | None:
        """What the plant reports for a commanded point.

        A setpoint and its feedback are separate points on purpose: reading the setpoint
        back would only confirm that the number was stored. The feedback is what the
        plant actually did, which is what an outcome is supposed to say.
        """
        device, metric = split_point(point)
        if metric == "frequency_setpoint":
            feedback = f"{device}:frequency_feedback"
            if feedback in observation:
                return observation.value_of(feedback)
        if point in observation:
            return observation.value_of(point)
        return None

    def records(self) -> tuple[CorrectionRecord, ...]:
        """Every proposal this gate has seen, accepted or not, in order."""
        self._refresh()
        return tuple(self._records)

    def rejected(self) -> tuple[CorrectionRecord, ...]:
        return tuple(record for record in self._records if not record.accepted)

    def applied(self) -> tuple[CorrectionRecord, ...]:
        """The corrections a step actually took."""
        self._refresh()
        return tuple(
            record for record in self._records if record.status is CorrectionStatus.APPLIED
        )
