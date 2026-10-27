"""The site's point vocabulary.

Every value the product reads from or writes to the plant is named `device:metric`, or
`SYSTEM:metric` for a plant-wide quantity. This module owns that vocabulary: which device
families exist, which metrics each carries, what unit each metric is in, and which of
them can be commanded.

The naming is inherited rather than invented. It appears independently in three places in
the reference projects — the platform constants, the control map of the agent prototype,
and the scene readout bindings that tie a drawing to live data — with identical family
names and metric names. It also matches the shape of a real BMS point list, which is what
lets a question asked about a simulated plant carry over to the real one. Some spellings
are awkward: a single cooling tower is `cooling_towers`, and primary chilled-water pumps
keep a `_pri` suffix with no secondary to distinguish them from. They are kept exactly,
because comparability with the reference plants and with site point lists is worth more
than tidiness.

What is added here is validation. The reference builds point names by string formatting
at the call site and never checks them, so a typo produces a key that silently nobody
reads. Here a site declares its device roster once, and any point name that roster does
not contain is rejected.
"""

from __future__ import annotations

import re
from dataclasses import dataclass
from enum import StrEnum
from typing import Iterable, Mapping

__all__ = [
    "DeviceFamily",
    "Metric",
    "SYSTEM_DEVICE",
    "SiteMetrics",
    "Unit",
    "UnknownPointError",
    "family_of",
    "point_name",
    "split_point",
]


class Unit(StrEnum):
    """Units as they appear in the point vocabulary.

    A string enum rather than bare strings: the vocabulary distinguishes `0/1` for a
    running state from `0-1` for a valve opening, which is one transposed character
    apart, and the reference has no way to catch that.
    """

    CELSIUS = "C"
    PERCENT_RELATIVE_HUMIDITY = "%RH"
    CUBIC_METRES_PER_HOUR = "m3/h"
    KILOWATT = "kW"
    KILOPASCAL = "kPa"
    HERTZ = "Hz"
    PERCENT = "%"
    BOOLEAN = "0/1"
    FRACTION = "0-1"


@dataclass(frozen=True)
class Metric:
    """One metric a device family carries."""

    name: str
    unit: Unit
    commandable: bool = False


class DeviceFamily(StrEnum):
    """Device families this product models.

    The value is the device-ID prefix: device IDs are `family_N`, numbered from one.
    """

    CHILLER = "chiller_plant"
    CHILLED_WATER_PUMP = "chilled_water_pump_pri"
    COOLING_WATER_PUMP = "cooling_water_pump"
    COOLING_TOWER = "cooling_towers"


SYSTEM_DEVICE = "SYSTEM"

# Carried by every family. A running state is commandable everywhere; power never is.
_COMMON_METRICS: tuple[Metric, ...] = (
    Metric("running_state", Unit.BOOLEAN, commandable=True),
    Metric("total_active_power", Unit.KILOWATT),
)

# Inverter-driven equipment. The setpoint is what we command; the feedback is what the
# plant reports back, and the two are deliberately separate points — a correction that is
# accepted but not achieved has to be visible.
_INVERTER_METRICS: tuple[Metric, ...] = (
    Metric("frequency_setpoint", Unit.HERTZ, commandable=True),
    Metric("frequency_feedback", Unit.HERTZ),
)

_FAMILY_METRICS: Mapping[DeviceFamily, tuple[Metric, ...]] = {
    DeviceFamily.CHILLER: _COMMON_METRICS
    + (
        Metric("chilled_water_temp_set", Unit.CELSIUS, commandable=True),
        Metric("evaporator_outlet_temp", Unit.CELSIUS),
        Metric("evaporator_inlet_temp", Unit.CELSIUS),
        Metric("condenser_outlet_temp", Unit.CELSIUS),
        Metric("condenser_inlet_temp", Unit.CELSIUS),
        Metric("plant_chw_current_flow", Unit.CUBIC_METRES_PER_HOUR),
        Metric("plant_chw_current_cooling", Unit.KILOWATT),
        Metric("operating_load_percentage", Unit.PERCENT),
    ),
    DeviceFamily.CHILLED_WATER_PUMP: _COMMON_METRICS + _INVERTER_METRICS,
    DeviceFamily.COOLING_WATER_PUMP: _COMMON_METRICS + _INVERTER_METRICS,
    DeviceFamily.COOLING_TOWER: _COMMON_METRICS
    + _INVERTER_METRICS
    + (
        Metric("ctws_temp", Unit.CELSIUS),
        Metric("ctwr_temp", Unit.CELSIUS),
        Metric("ctw_current_flow", Unit.CUBIC_METRES_PER_HOUR),
    ),
}

# Plant-wide quantities, reported under the SYSTEM device. None are commandable: they are
# measurements and boundary conditions, not handles.
_SYSTEM_METRICS: tuple[Metric, ...] = (
    Metric("outdoor_temperature", Unit.CELSIUS),
    Metric("outdoor_humidity", Unit.PERCENT_RELATIVE_HUMIDITY),
    Metric("wet_bulb_temperature", Unit.CELSIUS),
    Metric("wet_bulb_temperature_approach", Unit.CELSIUS),
    Metric("terminal_current_flow", Unit.CUBIC_METRES_PER_HOUR),
    Metric("terminal_current_cooling", Unit.KILOWATT),
    # Not in any BMS point list: a real plant cannot measure the demand it failed to meet,
    # only the temperatures that rise because of it. A simulation is given the demand as
    # an input, so it can and must keep it apart from what the chillers removed — the
    # reference reports the demand under the cooling points, which hides a shortfall.
    Metric("cooling_demand", Unit.KILOWATT),
    Metric("cooling_unmet", Unit.KILOWATT),
    Metric("chw_loop_heat_accumulation", Unit.KILOWATT),
    Metric("chws_main_temp", Unit.CELSIUS),
    Metric("chwr_main_temp", Unit.CELSIUS),
    Metric("chw_main_temp_diff", Unit.CELSIUS),
    Metric("chw_main_current_flow", Unit.CUBIC_METRES_PER_HOUR),
    Metric("chw_main_current_cooling", Unit.KILOWATT),
    Metric("chws_main_pressure", Unit.KILOPASCAL),
    Metric("chwr_main_pressure", Unit.KILOPASCAL),
    Metric("cws_main_temp", Unit.CELSIUS),
    Metric("cwr_main_temp", Unit.CELSIUS),
    Metric("cw_main_temp_diff", Unit.CELSIUS),
    Metric("cw_main_current_flow", Unit.CUBIC_METRES_PER_HOUR),
    Metric("cw_main_current_cooling", Unit.KILOWATT),
    Metric("cws_main_pressure", Unit.KILOPASCAL),
    Metric("cwr_main_pressure", Unit.KILOPASCAL),
    Metric("chw_bypass_opening", Unit.FRACTION),
    Metric("cw_bypass_opening", Unit.FRACTION),
)

_DEVICE_ID_PATTERN = re.compile(r"^(?P<family>.+)_(?P<index>\d+)$")


class UnknownPointError(KeyError):
    """Raised for a point name the site's roster does not contain."""


def point_name(device_id: str, metric: str) -> str:
    """Compose a point name from a device ID and a metric name."""
    return f"{device_id}:{metric}"


def split_point(point: str) -> tuple[str, str]:
    """Split a point name into its device ID and metric name.

    Raises:
        ValueError: if the name is not `device:metric`.
    """
    device_id, separator, metric = point.partition(":")
    if not separator or not device_id or not metric:
        raise ValueError(f"not a point name: {point!r}; expected 'device:metric'")
    return device_id, metric


def family_of(device_id: str) -> DeviceFamily | None:
    """The family a device ID belongs to, or None for SYSTEM and unrecognised IDs."""
    if device_id == SYSTEM_DEVICE:
        return None
    match = _DEVICE_ID_PATTERN.match(device_id)
    if match is None:
        return None
    try:
        return DeviceFamily(match.group("family"))
    except ValueError:
        return None


def metrics_of(family: DeviceFamily) -> tuple[Metric, ...]:
    """The metrics a family carries."""
    return _FAMILY_METRICS[family]


def system_metrics() -> tuple[Metric, ...]:
    """The plant-wide metrics."""
    return _SYSTEM_METRICS


@dataclass(frozen=True)
class SiteMetrics:
    """The point vocabulary for one site's device roster.

    One installation has one roster. Build it from the counts in the site definition,
    then use it to name points, look up units, and reject anything not in it.
    """

    device_ids: tuple[str, ...]
    _units: Mapping[str, Unit]
    _commandable: frozenset[str]

    @classmethod
    def from_counts(cls, counts: Mapping[DeviceFamily, int]) -> SiteMetrics:
        """Build the vocabulary for a roster given as a count per family.

        Device IDs are `family_N`, numbered from one, matching the reference convention.

        Raises:
            ValueError: if a count is negative.
        """
        device_ids: list[str] = []
        for family, count in counts.items():
            if count < 0:
                raise ValueError(f"negative device count for {family}: {count}")
            device_ids.extend(f"{family.value}_{index}" for index in range(1, count + 1))
        return cls.from_device_ids(device_ids)

    @classmethod
    def from_device_ids(cls, device_ids: Iterable[str]) -> SiteMetrics:
        """Build the vocabulary for an explicit roster.

        Raises:
            ValueError: if an ID does not belong to a known family, or repeats.
        """
        ordered = tuple(device_ids)
        if len(set(ordered)) != len(ordered):
            raise ValueError("duplicate device IDs in roster")

        units: dict[str, Unit] = {}
        commandable: set[str] = set()

        for device_id in ordered:
            family = family_of(device_id)
            if family is None:
                raise ValueError(
                    f"device ID {device_id!r} does not name a known family; expected "
                    f"one of {[f.value for f in DeviceFamily]} followed by _N"
                )
            for metric in metrics_of(family):
                point = point_name(device_id, metric.name)
                units[point] = metric.unit
                if metric.commandable:
                    commandable.add(point)

        for metric in _SYSTEM_METRICS:
            units[point_name(SYSTEM_DEVICE, metric.name)] = metric.unit

        return cls(ordered, units, frozenset(commandable))

    @property
    def points(self) -> tuple[str, ...]:
        """Every point name in the vocabulary, sorted."""
        return tuple(sorted(self._units))

    @property
    def commandable_points(self) -> tuple[str, ...]:
        """The points an action may set, sorted.

        This is the reference's manual-control point list, derived from the metric
        catalog rather than assembled by hand at each site.
        """
        return tuple(sorted(self._commandable))

    def unit_of(self, point: str) -> Unit:
        """The unit of a point.

        Raises:
            UnknownPointError: if the point is not in the vocabulary.
        """
        try:
            return self._units[point]
        except KeyError:
            raise UnknownPointError(point) from None

    def __contains__(self, point: object) -> bool:
        return isinstance(point, str) and point in self._units

    def is_commandable(self, point: str) -> bool:
        """Whether an action may set this point.

        Raises:
            UnknownPointError: if the point is not in the vocabulary.
        """
        if point not in self._units:
            raise UnknownPointError(point)
        return point in self._commandable

    def require(self, points: Iterable[str]) -> None:
        """Check that every given point is in the vocabulary.

        Raises:
            UnknownPointError: naming all unknown points, not just the first, so a
                mismatched roster is diagnosed in one pass.
        """
        unknown = sorted(point for point in points if point not in self._units)
        if unknown:
            raise UnknownPointError(
                f"{len(unknown)} point(s) not in the site vocabulary: {unknown}"
            )
