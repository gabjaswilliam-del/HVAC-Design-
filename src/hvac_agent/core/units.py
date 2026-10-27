"""Unit conversions for the site domain.

Every conversion the simulation, telemetry and configuration layers need lives here as
a named function. Nothing else in the codebase should multiply by 60 to turn a flow into
an hourly one, or by 3.517 to turn a nameplate tonnage into kilowatts.

The reason is specific rather than stylistic. The engine works in cubic metres per
minute, kilopascals on the water side and pascals on the air side, and megajoules per
minute for heat. The point vocabulary reports cubic metres per hour and kilowatts.
Equipment nameplates add refrigeration tons. The reference implementation spread those
conversions inline across thousands of lines, which makes a wrong factor invisible at the
call site and impossible to test. Naming each one makes the direction explicit and the
factor checkable.

Functions take and return plain floats. They are pure arithmetic, so array-valued inputs
also work elementwise, but the annotations describe the scalar case.
"""

from __future__ import annotations

__all__ = [
    "BASE_FREQUENCY_HZ",
    "REFRIGERATION_TON_KW",
    "WATER_VOLUMETRIC_HEAT_CAPACITY_KJ_PER_M3_K",
    "hz_to_inverter_ratio",
    "inverter_ratio_to_hz",
    "kpa_to_pa",
    "kw_to_mj_per_min",
    "kw_to_refrigeration_tons",
    "m3_per_h_to_m3_per_min",
    "m3_per_min_to_m3_per_h",
    "mj_per_min_to_kw",
    "pa_to_kpa",
    "refrigeration_tons_to_kw",
    "water_flow_m3_per_min",
    "water_heat_flow_kw",
]

_SECONDS_PER_MINUTE = 60.0
_MINUTES_PER_HOUR = 60.0
_KILO = 1_000.0

# One ton of refrigeration is 12,000 BTU_IT per hour. Derived here rather than written as
# a literal so the definition is checkable. The reference implementation rounds this to
# 3.517, a difference of 0.004% that is far below the accuracy of any nameplate it is
# applied to; we keep the exact value.
_BTU_IT_JOULES = 1055.05585262
_BTU_PER_HOUR_PER_TON = 12_000.0
REFRIGERATION_TON_KW = _BTU_PER_HOUR_PER_TON * _BTU_IT_JOULES / 3_600.0 / _KILO

# Volumetric heat capacity of water: 4.186 kJ/(kg·K) times 1000 kg/m³. This is the
# constant the reference engine and its plant models use throughout, and it is held fixed
# rather than varied with temperature. Keeping the same value is deliberate: a generated
# plant has to be comparable against the hand-written ones, and a different heat capacity
# would show up as a difference we did not intend to make.
WATER_VOLUMETRIC_HEAT_CAPACITY_KJ_PER_M3_K = 4186.0

# Nominal mains frequency. Inverter-driven pumps and fans are commanded as a ratio of it,
# while the point vocabulary reports hertz. Sites on a 60 Hz supply pass base_hz.
BASE_FREQUENCY_HZ = 50.0


# --- Volumetric flow ---------------------------------------------------------------


def m3_per_min_to_m3_per_h(flow_m3_per_min: float) -> float:
    """Convert a flow from the engine's unit to the reported one."""
    return flow_m3_per_min * _MINUTES_PER_HOUR


def m3_per_h_to_m3_per_min(flow_m3_per_h: float) -> float:
    """Convert a reported flow to the engine's unit."""
    return flow_m3_per_h / _MINUTES_PER_HOUR


# --- Thermal power -----------------------------------------------------------------


def mj_per_min_to_kw(power_mj_per_min: float) -> float:
    """Convert a heat flow from megajoules per minute to kilowatts."""
    return power_mj_per_min * _KILO / _SECONDS_PER_MINUTE


def kw_to_mj_per_min(power_kw: float) -> float:
    """Convert a heat flow from kilowatts to megajoules per minute."""
    return power_kw * _SECONDS_PER_MINUTE / _KILO


def refrigeration_tons_to_kw(capacity_tons: float) -> float:
    """Convert a nameplate cooling capacity from refrigeration tons to kilowatts."""
    return capacity_tons * REFRIGERATION_TON_KW


def kw_to_refrigeration_tons(capacity_kw: float) -> float:
    """Convert a cooling capacity from kilowatts to refrigeration tons."""
    return capacity_kw / REFRIGERATION_TON_KW


# --- Pressure ----------------------------------------------------------------------


def kpa_to_pa(pressure_kpa: float) -> float:
    """Convert a pressure from the water side's unit to the air side's."""
    return pressure_kpa * _KILO


def pa_to_kpa(pressure_pa: float) -> float:
    """Convert a pressure from the air side's unit to the water side's."""
    return pressure_pa / _KILO


# --- Inverter command --------------------------------------------------------------


def hz_to_inverter_ratio(frequency_hz: float, base_hz: float = BASE_FREQUENCY_HZ) -> float:
    """Convert a commanded frequency to the ratio the engine's components take.

    Raises:
        ValueError: if base_hz is zero.
    """
    if base_hz == 0.0:
        raise ValueError("base_hz must be non-zero")
    return frequency_hz / base_hz


def inverter_ratio_to_hz(ratio: float, base_hz: float = BASE_FREQUENCY_HZ) -> float:
    """Convert an engine inverter ratio to the frequency the point vocabulary reports."""
    return ratio * base_hz


# --- Water-side heat balance -------------------------------------------------------
#
# The relation below is the most frequently repeated calculation in the reference
# implementation and the easiest to get wrong, because it mixes a per-minute flow with a
# per-second power. It appears in load-to-flow inversion, in chiller duty, and in every
# energy balance check, so it is named once here.


def water_heat_flow_kw(flow_m3_per_min: float, delta_t_k: float) -> float:
    """Heat carried by a water stream, in kilowatts.

    Args:
        flow_m3_per_min: Volumetric flow in the engine's unit.
        delta_t_k: Temperature difference across the stream, in kelvin. Sign is
            preserved, so a reversed difference returns a negative heat flow.
    """
    return (
        flow_m3_per_min
        / _SECONDS_PER_MINUTE
        * WATER_VOLUMETRIC_HEAT_CAPACITY_KJ_PER_M3_K
        * delta_t_k
    )


def water_flow_m3_per_min(heat_flow_kw: float, delta_t_k: float) -> float:
    """Water flow needed to carry a heat flow across a given temperature difference.

    This is the inverse of :func:`water_heat_flow_kw`, used to turn a cooling demand into
    a flow target.

    A temperature difference approaching zero drives the required flow towards infinity,
    which is real physics rather than a numerical artefact: at zero difference no flow
    carries the load. Only an exactly zero difference raises here. Callers that may be
    handed a near-zero difference — a plant at standstill reports one — must apply their
    own threshold, because what counts as "too small" is a plant decision and not a
    property of the units.

    Raises:
        ValueError: if delta_t_k is exactly zero.
    """
    if delta_t_k == 0.0:
        raise ValueError(
            "delta_t_k must be non-zero; no flow carries heat across zero temperature "
            "difference"
        )
    return (
        heat_flow_kw
        * _SECONDS_PER_MINUTE
        / WATER_VOLUMETRIC_HEAT_CAPACITY_KJ_PER_M3_K
        / delta_t_k
    )
