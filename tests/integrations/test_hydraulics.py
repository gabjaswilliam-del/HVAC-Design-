"""Closing a header, against the real engine branches rather than stand-ins.

Most of these build actual `phyvac` pumps, valves and branches, because the solver's only
assumption about a branch is that its `p2f` is monotonic in pressure, and that assumption
is worth checking against the thing it will actually be given. The few tests that use a
hand-written element are the ones that need a characteristic the engine cannot produce.
"""

from __future__ import annotations

import pytest

from hvac_agent.integrations.phyvac import vendor as pv
from hvac_agent.integrations.phyvac.hydraulics import (
    HeaderBalance,
    HydraulicSolveError,
    mix_temperature,
    solve_header,
)


def pump_branch(inverter: float = 1.0) -> pv.BranchW:
    """A pump pushing into a header. Returns None's counterpart: a live source."""
    pump = pv.Pump(figure=0)
    pump.inv = inverter
    return pv.BranchW(pump=pump, kr_eq=0.5, kr_pipe=0.3)


def consumer_branch(resistance: float = 0.8) -> pv.BranchW:
    """A branch with no pump: it only ever draws from the header."""
    return pv.BranchW(kr_eq=resistance, kr_pipe=0.5)


# --- it balances ---------------------------------------------------------------------


def test_one_pump_against_one_consumer_balances():
    balance = solve_header([pump_branch()], [consumer_branch()])

    assert 0.0 < balance.delta_p_kpa < 800.0
    # The property that defines a solution: what goes in is what comes out.
    assert balance.total_source_flow == pytest.approx(balance.total_sink_flow, abs=1e-3)
    assert abs(balance.residual_m3_per_min) <= 1e-3


def test_the_solution_is_recorded_per_branch_in_order():
    sources = [pump_branch(), pump_branch()]
    sinks = [consumer_branch(0.8), consumer_branch(2.0)]
    balance = solve_header(sources, sinks)

    assert len(balance.source_flows) == 2
    assert len(balance.sink_flows) == 2
    # Identical pumps on a common header carry identical flow.
    assert balance.source_flows[0] == pytest.approx(balance.source_flows[1])
    # The more resistive consumer takes less.
    assert balance.sink_flows[1] < balance.sink_flows[0]


def test_flows_follow_from_the_solved_pressure():
    sources = [pump_branch()]
    sinks = [consumer_branch()]
    balance = solve_header(sources, sinks)

    assert balance.source_flows[0] == pytest.approx(sources[0].p2f(balance.delta_p_kpa))
    assert balance.sink_flows[0] == pytest.approx(sinks[0].p2f(-balance.delta_p_kpa))


# --- parameterised by count ----------------------------------------------------------


@pytest.mark.parametrize("pumps", [1, 2, 3, 5, 12])
def test_the_same_code_closes_a_header_of_any_size(pumps):
    # The whole point of the module. The reference implementation writes this per site,
    # so a plant with a different number of machines needs a different function.
    balance = solve_header(
        [pump_branch() for _ in range(pumps)],
        [consumer_branch(0.2) for _ in range(pumps)],
    )
    assert balance.total_source_flow == pytest.approx(balance.total_sink_flow, abs=1e-3)
    assert len(balance.source_flows) == pumps


def test_adding_a_pump_raises_pressure_and_flow():
    one = solve_header([pump_branch()], [consumer_branch(0.2)])
    two = solve_header([pump_branch(), pump_branch()], [consumer_branch(0.2)])

    assert two.delta_p_kpa > one.delta_p_kpa
    assert two.total_sink_flow > one.total_sink_flow
    # But not twice the flow: the consumer's resistance rises with the square of it.
    assert two.total_sink_flow < 2.0 * one.total_sink_flow


# --- machines out of service ---------------------------------------------------------


def test_a_stopped_pump_keeps_its_place_and_carries_nothing():
    # Index alignment is what lets a caller map a flow back to a device without
    # tracking which entries it skipped.
    balance = solve_header([pump_branch(), None, pump_branch()], [consumer_branch()])

    assert len(balance.source_flows) == 3
    assert balance.source_flows[1] == 0.0
    assert balance.source_flows[0] > 0.0
    assert balance.source_flows[2] > 0.0


def test_a_plant_at_rest_solves_to_zero_without_searching():
    # Every pump stopped is the ordinary overnight state, not a failure.
    balance = solve_header([None, None], [consumer_branch(), None])

    assert balance == HeaderBalance(
        delta_p_kpa=0.0,
        source_flows=(0.0, 0.0),
        sink_flows=(0.0, 0.0),
        residual_m3_per_min=0.0,
        iterations=0,
    )


def test_a_shut_consumer_reduces_flow_through_the_rest():
    both = solve_header([pump_branch()], [consumer_branch(), consumer_branch()])
    one = solve_header([pump_branch()], [consumer_branch(), None])

    assert one.sink_flows[1] == 0.0
    assert one.delta_p_kpa > both.delta_p_kpa
    assert one.total_sink_flow < both.total_sink_flow


# --- a slower pump in parallel -------------------------------------------------------


def assert_every_branch_is_on_its_curve(balance: HeaderBalance, sources, sinks) -> None:
    """What a balance must satisfy branch by branch, not only in total.

    A conducting pump branch makes exactly the header pressure at its flow. A running one
    that delivers nothing is behind a shut check valve, which holds only while the header
    is at or above its shutoff head. A consumer draws what the header pressure drives.
    """
    dp = balance.delta_p_kpa
    for branch, flow in zip(sources, balance.source_flows):
        if branch is None:
            assert flow == 0.0
        elif flow > 0.0:
            assert branch.f2p(flow) == pytest.approx(dp, abs=1e-6)
        else:
            assert branch.f2p(1e-9) <= dp + 1e-9
    for branch, flow in zip(sinks, balance.sink_flows):
        if branch is not None:
            assert flow == pytest.approx(max(0.0, branch.p2f(-dp)), abs=1e-9)
    assert abs(balance.total_source_flow - balance.total_sink_flow) <= 1e-3


def test_a_slower_pump_overpowered_runs_on_the_rising_part_of_its_curve():
    # Pumps at one speed never meet the step at the top of the engine's pump curve near a
    # balance. At different speeds they can: the faster pump raises the header to the
    # slower one's highest head, where the engine reports it delivering either its full
    # flow there or nothing. Here the faster pump alone cannot hold the header at the
    # slower one's shutoff head, so the slower one runs below the flow of its highest
    # head, on its curve. It was once given a share of its flow at its highest head, a
    # point on no curve at all.
    sources, sinks = [pump_branch(0.9), pump_branch(0.6)], [consumer_branch(3.0)]
    balance = solve_header(sources, sinks)

    assert balance.rising == (1,)
    assert 0.0 < balance.source_flows[1] < sources[1].p2f(balance.delta_p_kpa)
    assert_every_branch_is_on_its_curve(balance, sources, sinks)


@pytest.mark.parametrize("fast, slow", [(1.0, 0.6), (0.9, 0.6), (0.8, 0.6), (1.0, 0.5)])
def test_every_branch_is_on_its_curve_whatever_the_speeds(fast, slow):
    # Across the resistances where the slower pump goes from sharing the flow, through the
    # top of its curve, to being held shut: each state the solver gives is one the curves
    # allow, not only one whose flows add up.
    states = set()
    for step in range(46):
        resistance = 1.5 + 0.1 * step
        sources, sinks = [pump_branch(fast), pump_branch(slow)], [consumer_branch(resistance)]
        balance = solve_header(sources, sinks)
        assert_every_branch_is_on_its_curve(balance, sources, sinks)
        states.add(
            "rising" if balance.rising else "shut" if balance.source_flows[1] == 0 else "shared"
        )
    assert "shut" in states


def test_a_step_no_pump_can_make_up_is_still_an_error():
    # Here it is the consumer that steps, from nothing to 8 at 100 kPa, which no source can
    # absorb: no pressure balances the header, and no pump state would change that.
    class _Linear:
        def p2f(self, dp: float) -> float:
            return max(0.0, 10.0 - 0.05 * dp)

    class _Step:
        def p2f(self, dp: float) -> float:
            return 0.0 if abs(dp) <= 100.0 else 8.0

    with pytest.raises(HydraulicSolveError) as raised:
        solve_header([_Linear()], [_Step()])

    assert "balances nowhere" in str(raised.value)


# --- it refuses rather than inventing ------------------------------------------------


def test_pumps_deadheaded_into_a_shut_header_is_an_error_not_a_number():
    # The engine clamps a pump's flow to zero above its shutoff head, so above roughly
    # 240 kPa the residual here is flat at zero and every pressure in that range balances
    # equally well. The reference version returns whichever one its bisection lands on,
    # which looks like a solved pressure and is not one.
    with pytest.raises(HydraulicSolveError) as raised:
        solve_header([pump_branch()], [None])

    message = str(raised.value)
    assert "deadheaded" in message
    assert "not determined" in message
    # The message names the cause an engineer would check first.
    assert "every consumer valve, including the bypass, is shut" in message


def test_a_ceiling_below_the_solution_is_an_error():
    with pytest.raises(HydraulicSolveError) as raised:
        solve_header([pump_branch()], [consumer_branch(0.2)], max_delta_p_kpa=1.0)

    assert "1 kPa" in str(raised.value)


def test_a_sink_that_delivers_flow_is_rejected():
    # Sinks see -dp, so one that produces flow at zero pressure is a sign error — most
    # often a pump branch passed on the wrong side.
    with pytest.raises(HydraulicSolveError) as raised:
        solve_header([consumer_branch()], [pump_branch()])

    assert "passed as a sink" in str(raised.value)


def test_a_characteristic_that_is_not_monotonic_is_reported_not_averaged():
    class Wobbly:
        """Flow that rises with pressure, which no real branch does."""

        def p2f(self, dp: float) -> float:
            return 5.0 + abs(dp) * 0.01

    with pytest.raises(HydraulicSolveError) as raised:
        solve_header([pump_branch()], [Wobbly()], max_iterations=10)

    message = str(raised.value)
    assert "monotonic" in message or "does not balance" in message


def test_a_non_positive_ceiling_is_rejected():
    with pytest.raises(ValueError):
        solve_header([pump_branch()], [consumer_branch()], max_delta_p_kpa=0.0)


# --- convergence ---------------------------------------------------------------------


def test_it_converges_in_far_fewer_than_the_iteration_limit():
    # Bisection halves the interval each step, so 800 kPa to a tolerance this tight is
    # about forty steps at worst. A solve near the limit would mean the tolerance and the
    # interval are mismatched.
    balance = solve_header([pump_branch()], [consumer_branch()])
    assert balance.iterations < 60


def test_a_tighter_tolerance_costs_iterations_but_still_converges():
    loose = solve_header([pump_branch()], [consumer_branch()], tolerance=1e-2)
    tight = solve_header([pump_branch()], [consumer_branch()], tolerance=1e-6)

    assert tight.iterations > loose.iterations
    assert abs(tight.residual_m3_per_min) <= 1e-6
    assert tight.delta_p_kpa == pytest.approx(loose.delta_p_kpa, abs=1e-1)


# --- a golden value ------------------------------------------------------------------


def test_a_two_pump_header_solves_where_it_did():
    # Recorded, not derived. If an upstream sync or a refactor moves this, the change is
    # in the engine's branch characteristics rather than in the search, and it needs to
    # be seen rather than absorbed.
    balance = solve_header(
        [pump_branch(), pump_branch()], [consumer_branch(0.8), consumer_branch(2.0)]
    )
    assert balance.delta_p_kpa == pytest.approx(62.82958984375, rel=1e-9)
    assert balance.total_sink_flow == pytest.approx(11.965177027257855, rel=1e-9)


# --- mixing --------------------------------------------------------------------------


def test_streams_mix_in_proportion_to_their_flow():
    assert mix_temperature([10.0, 20.0], [1.0, 3.0], fallback=0.0) == pytest.approx(17.5)


def test_one_stream_mixes_to_itself():
    assert mix_temperature([12.5], [4.0], fallback=0.0) == pytest.approx(12.5)


def test_nothing_flowing_gives_the_fallback():
    # A real state: a header whose pumps are all stopped has no mixed temperature, and
    # the caller says what to report instead — usually the previous step's value.
    assert mix_temperature([10.0, 20.0], [0.0, 0.0], fallback=7.0) == 7.0


def test_a_stopped_stream_does_not_drag_the_mixed_temperature():
    # The trap this avoids: averaging temperatures instead of weighting them by flow
    # would let a stopped machine's stale reading pull the header temperature.
    assert mix_temperature([10.0, 40.0], [3.0, 0.0], fallback=0.0) == pytest.approx(10.0)


def test_mismatched_lengths_are_an_error():
    # The reference returns the fallback here, so a caller that built its lists wrongly
    # gets a plausible temperature and never finds out.
    with pytest.raises(ValueError, match="must correspond"):
        mix_temperature([10.0, 20.0], [1.0], fallback=0.0)


def test_a_negative_flow_is_an_error():
    with pytest.raises(ValueError, match="backwards"):
        mix_temperature([10.0, 20.0], [1.0, -1.0], fallback=0.0)
