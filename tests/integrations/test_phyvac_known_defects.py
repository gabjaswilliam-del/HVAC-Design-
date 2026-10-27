"""Defects in the vendored engine that are recorded rather than fixed.

Each test below states what the engine should do and fails because it does not. They are
marked ``xfail(strict=True)``, so if a future baseline or patch fixes one, the test
reports XPASS — which strict mode treats as a failure. That is deliberate: a fix here is
not free, and it must be a decision somebody makes rather than something that slips
through. When one starts passing, remove the mark, record the change in
``vendor/UPSTREAM.md``, and re-check anything calibrated against the old behaviour.

Why these are not fixed now:

All three sit in components outside this project's topology scope — a stratified thermal
storage tank and a gas absorption chiller. We model water-cooled electric chillers with
open cooling towers, so nothing we assemble calls them. Editing vendored code we do not
exercise buys nothing and adds divergence from the baseline for the next sync to carry.

They become live if scope grows. One reference plant does use the storage tank, and
another site has a buffer tank, so a future topology family that includes one must fix the
two tank defects first and re-validate anything that depended on the old numbers.

Note that this is a different argument from the one for the NumPy patch in `UPSTREAM.md`.
That patch is applied because it provably does not change results. These change results,
which is why they are pinned instead — but the reason to leave them is scope, not
calibration.
"""

from __future__ import annotations

import pytest

from hvac_agent.integrations.phyvac import vendor as pv

# The engine does not export these through the shim, because nothing in scope uses them.
# Reaching into the module is appropriate here: the point is to pin defects in the
# vendored code itself.
from hvac_agent.integrations.phyvac.vendor import phyvac as _engine


def make_tank():
    """A storage tank, whose water property polynomials carry two of the defects."""
    return _engine.VerticalWaterThermalStorageTank(timedelta=60.0)


@pytest.mark.xfail(
    strict=True,
    reason=(
        "water_density uses 10e-3, 10e-6, 10e-9 and 10e-12 where the correlation calls "
        "for 1e-3, 1e-6, 1e-9 and 1e-12, so every higher-order term is ten times too "
        "large. Upstream uses the correct coefficients."
    ),
)
def test_water_density_is_physical():
    # Liquid water at 20 C is about 998.2 kg/m3, and varies by only a few kg/m3 across
    # the range a chilled or condenser water loop ever sees.
    density = make_tank().water_density(20.0)
    assert density == pytest.approx(998.2, abs=1.0)


@pytest.mark.xfail(
    strict=True,
    reason=(
        "Horner evaluation runs range(len(a) - 2, 0, -1), which stops before index zero "
        "and drops the constant term. Upstream ends the range at -1."
    ),
)
def test_water_thermal_conductivity_is_physical():
    # Liquid water at 20 C conducts about 0.598 W/(m*K).
    conductivity = make_tank().water_thermal_conductivity(20.0)
    assert conductivity == pytest.approx(0.598, abs=0.05)


@pytest.mark.xfail(
    strict=True,
    reason=(
        "Horner evaluation in water_specific_heat has the same off-by-one, dropping the "
        "constant term."
    ),
)
def test_water_specific_heat_is_physical():
    # Liquid water at 20 C is about 4.18 kJ/(kg*K).
    specific_heat = make_tank().water_specific_heat(20.0)
    assert specific_heat == pytest.approx(4.18, abs=0.1)


@pytest.mark.xfail(
    strict=True,
    reason=(
        "cal_c assigns from `tout_chsp` where the parameter is `tout_ch_sp`, raising "
        "NameError. The path is only reached when the requested duty exceeds rated "
        "capacity, which is why it appears never to have been executed."
    ),
)
def test_absorption_chiller_handles_an_overload():
    # Rated for 100 kW of cooling, then asked for far more: enough flow across a 8 K
    # difference to demand roughly 700 kW, which takes the overload branch.
    chiller = _engine.AbsorptionChillerESS(100.0, 120.0, 5.0, 100.0, 120.0, 5.0)
    chiller.cal_c(g=1.2, tin_cd=32.0, tin_ch=15.0, tout_ch_sp=7.0)
    # Outlet temperature must rise above setpoint when the machine cannot meet the duty.
    assert chiller.tout_ch > 7.0
