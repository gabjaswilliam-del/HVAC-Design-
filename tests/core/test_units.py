"""Checks for the unit conversions.

Three kinds of check. Known values pin each factor against an independent source, so a
transposed conversion cannot pass. Round trips catch a factor applied in the wrong
direction, which known values on their own would miss if both directions were wrong the
same way. The remaining tests cover the two places a conversion can fail rather than
merely be wrong.
"""

from __future__ import annotations

import pytest

from hvac_agent.core import units

# Values spanning zero, small, ordinary and large magnitudes. Round trips run over all of
# them so a factor that only misbehaves at one end is still caught.
SAMPLES = [0.0, 1e-6, 0.25, 1.0, 7.5, 123.456, 1e6]


# --- Known values ------------------------------------------------------------------


def test_one_m3_per_min_is_sixty_m3_per_h():
    assert units.m3_per_min_to_m3_per_h(1.0) == pytest.approx(60.0)


def test_one_mj_per_min_is_one_sixty_of_a_megawatt():
    # 1 MJ delivered over 60 s is 1000 kJ / 60 s.
    assert units.mj_per_min_to_kw(1.0) == pytest.approx(16.6667, abs=1e-4)


def test_one_refrigeration_ton_matches_the_btu_definition():
    # 12 000 BTU_IT/h. Compared against the reference implementation's rounded 3.517,
    # which is the value nameplate parsing there uses.
    assert units.refrigeration_tons_to_kw(1.0) == pytest.approx(3.5168528, abs=1e-7)
    assert units.REFRIGERATION_TON_KW == pytest.approx(3.517, abs=5e-4)


def test_one_kpa_is_one_thousand_pa():
    assert units.kpa_to_pa(1.0) == pytest.approx(1000.0)


def test_rated_frequency_is_full_inverter_ratio():
    assert units.hz_to_inverter_ratio(50.0) == pytest.approx(1.0)
    assert units.hz_to_inverter_ratio(25.0) == pytest.approx(0.5)


def test_water_heat_flow_matches_a_hand_calculation():
    # 1 m³/min across 5 K: (1/60) m³/s × 4186 kJ/(m³·K) × 5 K.
    assert units.water_heat_flow_kw(1.0, 5.0) == pytest.approx(4186.0 / 60.0 * 5.0)


def test_water_flow_matches_the_reference_load_inversion():
    # The reference computes g = Q * 60 / (4186 * dT) for a load-to-flow target.
    heat_kw, delta_t = 1200.0, 5.0
    expected = heat_kw * 60.0 / (4186.0 * delta_t)
    assert units.water_flow_m3_per_min(heat_kw, delta_t) == pytest.approx(expected)


# --- Round trips -------------------------------------------------------------------


@pytest.mark.parametrize("value", SAMPLES)
@pytest.mark.parametrize(
    ("forward", "backward"),
    [
        (units.m3_per_min_to_m3_per_h, units.m3_per_h_to_m3_per_min),
        (units.mj_per_min_to_kw, units.kw_to_mj_per_min),
        (units.refrigeration_tons_to_kw, units.kw_to_refrigeration_tons),
        (units.kpa_to_pa, units.pa_to_kpa),
        (units.hz_to_inverter_ratio, units.inverter_ratio_to_hz),
    ],
    ids=["flow", "thermal_power", "capacity", "pressure", "inverter"],
)
def test_round_trip_returns_the_original(forward, backward, value):
    assert backward(forward(value)) == pytest.approx(value, rel=1e-12, abs=1e-15)


@pytest.mark.parametrize("flow", SAMPLES)
@pytest.mark.parametrize("delta_t", [-7.5, -1.0, 0.5, 5.0, 40.0])
def test_water_heat_balance_round_trip(flow, delta_t):
    # Relative tolerance with an absolute floor: the samples span zero to 1e6, and an
    # absolute-only tolerance tight enough for the small end demands more significant
    # digits than float64 has at the large end.
    heat = units.water_heat_flow_kw(flow, delta_t)
    assert units.water_flow_m3_per_min(heat, delta_t) == pytest.approx(
        flow, rel=1e-12, abs=1e-15
    )


# --- Behaviour at the edges --------------------------------------------------------


def test_reversed_temperature_difference_reverses_the_heat_flow():
    assert units.water_heat_flow_kw(2.0, -5.0) == pytest.approx(
        -units.water_heat_flow_kw(2.0, 5.0)
    )


def test_zero_temperature_difference_is_rejected():
    with pytest.raises(ValueError, match="delta_t_k"):
        units.water_flow_m3_per_min(1200.0, 0.0)


def test_zero_temperature_difference_carries_no_heat():
    # The forward direction is well defined at zero and must not raise.
    assert units.water_heat_flow_kw(5.0, 0.0) == 0.0


def test_sixty_hertz_supply_is_supported():
    assert units.hz_to_inverter_ratio(60.0, base_hz=60.0) == pytest.approx(1.0)
    assert units.inverter_ratio_to_hz(0.5, base_hz=60.0) == pytest.approx(30.0)


def test_zero_base_frequency_is_rejected():
    with pytest.raises(ValueError, match="base_hz"):
        units.hz_to_inverter_ratio(50.0, base_hz=0.0)
