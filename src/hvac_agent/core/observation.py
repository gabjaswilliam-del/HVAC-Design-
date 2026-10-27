"""What the product knows about the plant at one instant.

An observation is the single shape in which plant state moves between modules: the
engine produces one per step, the telemetry adapter produces one per sample, and the
dashboard, the agent and the pilot all consume them. Because both a real plant and a
simulation produce them, an observation that cannot say which it came from is a hazard
rather than a convenience — an operator shown a simulated temperature as if it were
measured has been actively misled.

So four things travel with the values and none of them are optional: where the reading
came from, which simulation run produced it when it was simulated, which revision of the
site definition it was produced under, and the unit of every value. The reference
implementation carries none of these; its plant models return a bare mapping of point
name to float, which leaves real and simulated data indistinguishable downstream and
makes a stale configuration invisible.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from datetime import datetime
from enum import StrEnum
from types import MappingProxyType
from typing import Mapping

from hvac_agent.core.metrics import SiteMetrics, Unit

__all__ = [
    "Measurement",
    "Observation",
    "Origin",
    "Quality",
    "build_observation",
]


class Origin(StrEnum):
    """Where a reading came from. Never inferred, never defaulted."""

    REAL = "real"
    SIMULATED = "simulated"


class Quality(StrEnum):
    """How much a reading can be relied on.

    Kept deliberately small. A richer scheme is easy to add once an adapter has
    something real to express; inventing states nothing produces would be guesswork.
    """

    GOOD = "good"
    UNCERTAIN = "uncertain"
    BAD = "bad"


@dataclass(frozen=True, slots=True)
class Measurement:
    """One value, with the unit it is in and how far it can be trusted."""

    value: float
    unit: Unit
    quality: Quality = Quality.GOOD


@dataclass(frozen=True, slots=True)
class Observation:
    """Plant state at one instant, from one source.

    Args:
        timestamp: When this state held. Must carry a timezone: simulated and real
            observations are compared and stored side by side, and a naive timestamp
            makes that comparison silently wrong an hour at a time.
        origin: Real or simulated. Required, with no default, so it cannot be omitted.
        config_revision: Which revision of the site definition produced this. A topology
            or parameter change invalidates comparisons across it, which is only
            detectable if every observation says what it was produced under.
        points: Point name to measurement. Copied on construction into a read-only
            mapping: an observation is handed to several consumers, and one of them
            changing a reading must not change what the others see.
        run_id: The simulation run. Required for a simulated observation, rejected for a
            real one.
        notes: Why any point is less than good, in words. A quality flag says a reading
            is uncertain; a note says what about the plant made it so, which is what an
            operator or an agent needs in order to act on it.
    """

    timestamp: datetime
    origin: Origin
    config_revision: str
    points: Mapping[str, Measurement] = field(default_factory=dict)
    run_id: str | None = None
    notes: tuple[str, ...] = ()

    def __post_init__(self) -> None:
        object.__setattr__(self, "points", MappingProxyType(dict(self.points)))
        object.__setattr__(self, "notes", tuple(self.notes))
        if self.timestamp.tzinfo is None:
            raise ValueError("timestamp must be timezone-aware")
        if not self.config_revision:
            raise ValueError("config_revision must not be empty")
        if self.origin is Origin.SIMULATED and not self.run_id:
            raise ValueError("a simulated observation must carry a run_id")
        if self.origin is Origin.REAL and self.run_id is not None:
            raise ValueError("a real observation must not carry a run_id")

    def __getitem__(self, point: str) -> Measurement:
        return self.points[point]

    def __contains__(self, point: object) -> bool:
        return point in self.points

    def value_of(self, point: str) -> float:
        """The bare value of a point, for arithmetic that has already checked units."""
        return self.points[point].value


def build_observation(
    metrics: SiteMetrics,
    *,
    timestamp: datetime,
    origin: Origin,
    config_revision: str,
    values: Mapping[str, float],
    run_id: str | None = None,
    quality: Mapping[str, Quality] | None = None,
    notes: tuple[str, ...] = (),
) -> Observation:
    """Build an observation from bare values, taking units from the site vocabulary.

    Producers hold values, not units — the engine computes a number and knows the point
    it belongs to. Looking the unit up here rather than asking each producer to supply it
    means a producer cannot label a point with the wrong unit, and means adding a metric
    does not require touching every producer.

    Raises:
        UnknownPointError: if any point is outside the site's vocabulary. All offending
            points are named at once.
    """
    metrics.require(values)
    quality = quality or {}
    points = {
        point: Measurement(
            value=value,
            unit=metrics.unit_of(point),
            quality=quality.get(point, Quality.GOOD),
        )
        for point, value in values.items()
    }
    return Observation(
        timestamp=timestamp,
        origin=origin,
        config_revision=config_revision,
        points=points,
        run_id=run_id,
        notes=tuple(notes),
    )
