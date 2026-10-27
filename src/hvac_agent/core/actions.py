"""What the product asks the plant to do.

An action names the points to change and the values to change them to. It is only ever
applied to a simulation: this product recommends, and a person decides. There is no path
from an action to physical equipment, and adding one would be a separate design with its
own authorisation, not a reuse of this type.

Two properties matter and neither is in the reference implementation. An action is
**partial** — it names only the points it intends to change — because the reference's
backend had no partial support and its client therefore re-sent every controllable
device's full state on every step, reading the current values back out of the last frame
to do so. That makes it impossible to tell an intentional setting from an echo, and means
a single correction to one chiller is indistinguishable from a command to hold thirty
other points where they are. And an action **identifies the run it targets**, so a
correction computed against observations from a run that has since stopped or been
restarted can be rejected rather than silently applied to a different plant state.
"""

from __future__ import annotations

import math
from dataclasses import dataclass, field
from datetime import datetime
from enum import StrEnum
from numbers import Real
from types import MappingProxyType
from typing import Mapping

from hvac_agent.core.metrics import SiteMetrics

__all__ = [
    "Action",
    "ControlMode",
    "RUNNING_STATE_METRIC",
]

RUNNING_STATE_METRIC = "running_state"


class ControlMode(StrEnum):
    """Who decides what the plant does.

    The reference carries two further modes, a one-step black-box search and a
    reinforcement-learning policy. Neither is in scope here, and adding names for
    capabilities that do not exist would misrepresent what the product does.
    """

    PLC = "plc"
    """The baseline control policy decides everything. An action sets nothing, and taking
    one hands every point that was set by hand back to the baseline."""

    MANUAL = "manual"
    """The caller supplies setpoints. Points left out keep whatever the plant has."""


@dataclass(frozen=True, slots=True)
class Action:
    """A partial set of setpoints, held until replaced or released.

    A manual setpoint stays in force from the step that takes it until a later action
    sets the same point to something else or releases it. It is not a one-step nudge: a
    chiller stopped by hand for ten minutes and then restarted by the baseline would make
    stopping one by hand meaningless.

    Args:
        mode: Who decides. Under PLC, setpoints and release must be empty.
        setpoints: Point name to value, for the points being changed. Points not named
            are left alone; this is not a full state. Copied on construction into a
            read-only mapping, so the values checked, queued and recorded are the values
            the caller passed, whatever later happens to the caller's dictionary.
        release: Points to hand back to the baseline. A point cannot be both set and
            released by one action.
        run_id: The simulation run this targets. Optional here because a baseline step
            has no external issuer; the simulation layer requires it for a correction
            submitted to a live run, and rejects an action whose run has moved on.
        issued_at: When this action was computed, so the simulation layer can reject one
            based on observations that have since gone stale. Must be timezone-aware.
    """

    mode: ControlMode
    setpoints: Mapping[str, float] = field(default_factory=dict)
    run_id: str | None = None
    issued_at: datetime | None = None
    release: frozenset[str] = frozenset()

    def __post_init__(self) -> None:
        # One snapshot serves validation, the queue and the ledger. Holding the caller's
        # dictionary instead would let a value be changed after the gate had accepted it,
        # rewriting both what runs and what the history says was proposed.
        setpoints: dict[str, float] = {}
        for point, value in self.setpoints.items():
            if isinstance(value, bool) or not isinstance(value, Real):
                raise ValueError(f"setpoint {point!r} is not a number: {value!r}")
            setpoints[point] = float(value)
        object.__setattr__(self, "setpoints", MappingProxyType(setpoints))
        object.__setattr__(self, "release", frozenset(self.release))
        if self.mode is ControlMode.PLC and (self.setpoints or self.release):
            raise ValueError(
                "a PLC action sets nothing; the baseline policy decides every setpoint, "
                "and taking one releases every point set by hand"
            )
        both = sorted(set(self.setpoints) & set(self.release))
        if both:
            raise ValueError(f"{both} cannot be both set and released by one action")
        if self.issued_at is not None and self.issued_at.tzinfo is None:
            raise ValueError("issued_at must be timezone-aware")
        for point, value in self.setpoints.items():
            if not math.isfinite(value):
                raise ValueError(f"setpoint {point!r} is not finite: {value!r}")

    def validate_against(self, metrics: SiteMetrics) -> None:
        """Check the action against a site's vocabulary.

        Separate from construction because the vocabulary belongs to a site and an action
        is built before a site is necessarily in hand.

        Equipment limits are deliberately not checked here. A minimum pump frequency or a
        chilled-water setpoint range is per-site equipment data that lives in the site
        definition, not a property of the vocabulary; checking it against the active run's
        equipment is the simulation layer's job.

        Raises:
            UnknownPointError: if a point is outside the site's vocabulary.
            ValueError: if a point exists but cannot be commanded, or a running state is
                neither zero nor one.
        """
        named = [*self.setpoints, *self.release]
        metrics.require(named)

        not_commandable = sorted(point for point in named if not metrics.is_commandable(point))
        if not_commandable:
            raise ValueError(
                f"{len(not_commandable)} point(s) are readings, not handles: "
                f"{not_commandable}"
            )

        for point, value in self.setpoints.items():
            if point.endswith(f":{RUNNING_STATE_METRIC}") and value not in (0.0, 1.0):
                raise ValueError(
                    f"running state {point!r} must be 0 or 1, got {value!r}"
                )

    def merged_with(self, later: Action) -> Action:
        """This action with another applied on top, the later one winning per point.

        Used where a policy proposes a full set and a correction adjusts part of it.
        Both must be in the same mode. A point the later action releases is no longer set,
        and a point it sets is no longer released.

        Raises:
            ValueError: if the modes differ.
        """
        if self.mode is not later.mode:
            raise ValueError(
                f"cannot merge a {later.mode} action into a {self.mode} one"
            )
        kept = {p: v for p, v in self.setpoints.items() if p not in later.release}
        return Action(
            mode=self.mode,
            setpoints={**kept, **later.setpoints},
            run_id=later.run_id or self.run_id,
            issued_at=later.issued_at or self.issued_at,
            release=(self.release - set(later.setpoints)) | later.release,
        )
