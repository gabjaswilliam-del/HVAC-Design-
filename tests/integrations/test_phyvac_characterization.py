"""Characterization of the vendored engine.

These tests do not assert that the engine is correct. They assert that it still does what
it did when these values were recorded. Neither reference project has a single test, so
without this net any later change — an upstream sync, a new patch, a refactor of the
adapter above it — moves numbers silently.

The values were recorded against the synthetic workbook in `conftest.py`, so they are
reproducible from this repository alone and depend on no customer data.

Tolerance is tight on purpose. A loose one would accommodate a real behavioural change as
readily as a floating-point difference, which defeats the point. If these fail on a
machine with different library versions, that is a finding worth investigating rather than
a tolerance to widen: it would mean the engine's output depends on the version of NumPy or
SciPy underneath it, which is something this project needs to know.
"""

from __future__ import annotations

import io
from contextlib import redirect_stdout

import pytest

from hvac_agent.integrations.phyvac import vendor as pv

REL = 1e-9


def approx(value: float) -> object:
    return pytest.approx(value, rel=REL)


# --- Psychrometrics ----------------------------------------------------------------
#
# Pure functions over floats, no state and no file input. If anything in this module
# survives an upstream sync unchanged, it is these.


def test_wet_bulb_temperature():
    assert pv.tdb_rh2twb(32.0, 70.0) == approx(27.34375)


def test_humidity_ratio():
    assert pv.tdb_rh2w(32.0, 70.0) == approx(0.021146052130738942)


def test_air_density():
    assert pv.tdb2den(32.0) == approx(1.1578535386631716)


def test_enthalpy_and_humidity_ratio():
    enthalpy, humidity_ratio = pv.tdb_rh2h_x(32.0, 70.0)
    assert enthalpy == approx(86.2884487759309)
    assert humidity_ratio == approx(0.02112713385403391)


# --- Chiller -----------------------------------------------------------------------


def test_rated_capacity_is_derived_from_design_conditions(spec_workbook):
    # With no capacity cell, the engine computes it from design temperature difference
    # and flow: (12 - 7) K at 2 m3/min.
    chiller = pv.Chiller(filename=str(spec_workbook.path), sheet_name="Chiller")
    assert chiller.q_ch_d == approx(697.6666666666666)
    assert chiller.COP_rp == approx(5.813888888888888)


def test_rated_capacity_is_read_from_a_nameplate_tonnage(spec_workbook_rated_in_tons):
    # A "200RT" cell takes precedence over the derived value. Note the engine's own
    # conversion factor of 3.517 rather than the exact 3.5168528 in core.units; the two
    # differ by 0.004% and this test records the engine's.
    chiller = pv.Chiller(
        filename=str(spec_workbook_rated_in_tons.path), sheet_name="Chiller"
    )
    assert chiller.q_ch_d == approx(703.4)


def test_chiller_at_the_rated_point(spec_workbook):
    chiller = pv.Chiller(filename=str(spec_workbook.path), sheet_name="Chiller")
    chiller.cal(tout_ch_sp=7.0, tin_ch=12.0, g_ch=2.0, tin_cd=32.0, g_cd=2.5)

    assert chiller.q_ch == approx(697.6666666666666)
    assert chiller.pw == approx(142.3809496098288)
    assert chiller.pl == approx(1.0)
    assert chiller.tout_cd == approx(36.816326514724295)
    # The corner of the grid: full load at the warmest condenser water.
    assert chiller.cop == approx(4.900000095367432)
    # Zero means the operating point sat inside the table, so nothing was clamped and no
    # fallback was used. The rated point should always produce it.
    assert chiller.flag == 0


def test_chiller_at_part_load(spec_workbook):
    chiller = pv.Chiller(filename=str(spec_workbook.path), sheet_name="Chiller")
    chiller.cal(tout_ch_sp=7.0, tin_ch=10.0, g_ch=1.6, tin_cd=24.0, g_cd=2.5)

    assert chiller.q_ch == approx(334.88000000000005)
    assert chiller.pw == approx(46.38227171703459)
    assert chiller.cop == approx(7.2199999612569705)
    assert chiller.pl == approx(0.4800000000000001)
    assert chiller.flag == 0


def test_the_cop_lookup_carries_single_precision(spec_workbook):
    # The engine casts the performance grid to float32 before interpolating, so an exact
    # grid corner comes back as 4.900000095367432 rather than 4.9. Recorded because it
    # constrains how tightly anything downstream can be compared.
    chiller = pv.Chiller(filename=str(spec_workbook.path), sheet_name="Chiller")
    chiller.cal(tout_ch_sp=7.0, tin_ch=12.0, g_ch=2.0, tin_cd=32.0, g_cd=2.5)
    assert chiller.cop != 4.9
    assert chiller.cop == pytest.approx(4.9, rel=1e-7)


# --- Hydronic components -----------------------------------------------------------


def test_pump_pressure_at_rated_flow():
    pump = pv.Pump(figure=0)
    pump.inv = 1.0
    assert pump.g_d == approx(0.25)
    assert pump.f2p(pump.g_d) == approx(234.18007500000002)


def test_pump_quadratic_coefficients():
    # f2p_co returns [c0, c1, c2] for dp = c0 + c1*g + c2*g^2, which is what lets branch
    # elements in series be summed coefficient-wise.
    pump = pv.Pump(figure=0)
    pump.inv = 1.0
    c0, c1, c2 = pump.f2p_co()
    assert c0 == approx(233.0)
    assert c1 == approx(5.9578)
    assert c2 == approx(-4.95)


def test_pump_power_and_efficiency():
    pump = pv.Pump(figure=0)
    pump.inv = 1.0
    pump.f2p(pump.g_d)
    pump.cal()
    assert pump.pw == approx(8.784607810038263)
    assert pump.ef == approx(0.11107500000000001)


def test_valve_pressure_and_flow():
    valve = pv.Valve(cv_max=800, r=100)
    valve.vlv = 0.6
    # A valve resists flow, so its contribution to a branch is negative.
    assert valve.f2p(1.0) == approx(-30.1172221473414)
    assert valve.p2f(-50.0) == approx(1.2884795972233012)


def test_branch_solves_flow_from_pressure():
    pump = pv.Pump(figure=0)
    pump.inv = 1.0
    branch = pv.BranchW(pump=pump, kr_eq=0.5, kr_pipe=0.3)

    assert branch.f2p(0.2) == approx(233.96156)
    # p2f solves the branch quadratic in closed form and records the result on the branch.
    assert branch.p2f(100.0) == approx(5.35530336740364)
    assert branch.g == approx(5.35530336740364)


# --- Cooling tower -----------------------------------------------------------------


def test_cooling_tower_outlet_and_fan_power():
    tower = pv.CoolingTower()
    tower.inv = 1.0
    tower.cal(g_w=5.0, tin_w=36.0, tdb=32.0, rh=60.0)
    assert tower.tout_w == approx(35.5637796036877)
    assert tower.pw == approx(11.0)


def test_cooling_tower_construction_writes_to_stdout():
    # Documented, not endorsed. The engine warns that its UA has not been calibrated, and
    # it does so on every construction regardless of the arguments given. The shim only
    # silences the import-time banner; this is a runtime print, so a plant with twelve
    # towers emits twelve lines while being assembled.
    #
    # Suppressing it belongs to the adapter that assembles a plant, where one
    # redirect_stdout covers the whole assembly, rather than to a per-class wrapper here.
    # This test exists so that the behaviour is known and cannot change unnoticed.
    buffer = io.StringIO()
    with redirect_stdout(buffer):
        pv.CoolingTower()
    assert buffer.getvalue() != ""


# --- Control blocks ----------------------------------------------------------------


def test_pid_moves_by_its_step_clamp():
    # The engine's PID is a velocity-form PI controller with no derivative term, and it
    # hard-limits the change per step to 0.05. That clamp is why gains in the reference
    # plants look small and why their loops settle slowly, so it is recorded here.
    pid = pv.PID(kp=0.5, ti=20)
    outputs = [pid.control(sp=9.0, mv=7.0) for _ in range(5)]
    assert outputs == [approx(v) for v in (0.05, 0.10, 0.15, 0.20, 0.25)]


def test_unit_staging_waits_before_adding_a_unit():
    # Demand sits above the stage-up threshold from the first call, but the controller
    # requires the request to persist for t_wait steps before acting.
    staging = pv.UnitNum(thre_up=[0.5, 1.0], thre_down=[0.4, 0.9], t_wait=3, num=1)
    assert [staging.control(g=0.8) for _ in range(6)] == [1, 1, 2, 2, 2, 2]
