"""Closing a header: finding the pressure at which what is pumped is what is drawn.

A header is pipework many branches tap into. Every branch on it sees the same pressure
difference, and each branch's flow follows from that difference through its own quadratic
characteristic — the engine's `p2f`. So the whole loop reduces to one unknown: the header
Δp at which the pumps deliver exactly what the consumers draw.

The engine itself does not do this. Its own examples nest a hand-written bisection per
loop, which is why the upstream project's cost grows as O(30^N) in the number of loops and
why the reference implementation wrote `solve_chilled_header` and `solve_condenser_header`
separately for each site. Those two functions are the same function: pumps on one side,
consumers on the other. This module is that function, parameterised by which branches are
sources and which are sinks, so that two chillers and five chillers are the same code.

The balance is monotonic, which is what makes a bisection the right method rather than
merely a convenient one. Raising Δp reduces what a pump delivers and increases what a
consumer draws, so the residual only ever decreases: there is exactly one crossing, and no
starting guess can land on the wrong root.

**A slower pump in parallel.** The engine's pump curve is a quadratic whose highest head
falls at a positive flow. Between that flow and zero the head falls again, to the shutoff
head, and the engine's `p2f` uses only the other side: above the highest head it reports no
flow at all, so a running pump's characteristic steps from that flow straight to zero.
Pumps at one speed never meet that step near a balance. Pumps in parallel at different
speeds can: the faster ones raise the header to the slower one's highest head, and the
balance falls inside its step. Every flow in that step is off the curve except its two
ends, so a point inside it is not an answer.

Each pump discharges through a check valve, and that gives the slower pump two states that
satisfy its own curve. If the others can hold the header at or above its shutoff head on
their own, its valve stays shut and it delivers nothing. If they cannot, it runs on the
rising part of its curve, below the flow of its highest head, at the one header pressure
where every branch's flow matches its own curve and the header closes. A real pump there
is unstable and hunts, so the balance names the pumps running there and the caller reports
them as uncertain. Either way every conducting branch is on its own characteristic. One
consequence belongs to the engine rather than to this module: its pump power is hydraulic,
flow times head over efficiency, so a pump against a shut valve draws nothing. A real
pump's power at shutoff is not modelled.

**Failure is raised, not returned.** The reference version runs a fixed eighty iterations
and returns the last midpoint whether or not it converged, so a plant that cannot be
balanced reports a number that looks like any other. Worse, when the interval holds no
root it abandons bisection for a rule that shrinks toward whichever end has the smaller
residual, which terminates at a point that is not a solution. Here an unbracketed or
unconverged solve raises, because a hydraulic state that does not exist is not a number.
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Protocol, Sequence

__all__ = [
    "HeaderBalance",
    "HydraulicSolveError",
    "PressureFlowElement",
    "PumpBranch",
    "mix_temperature",
    "solve_header",
]

# Default ceiling for the search, in kPa. Comfortably above any pump's shutoff head in
# this topology family; a solve that needs more than this has something wrong with it
# rather than merely being stiff.
MAX_DELTA_P_KPA = 800.0

# Flow residual counting as balanced, in m3/min. Roughly a litre a minute across a header
# carrying hundreds, so it is tight relative to the quantity and loose relative to double
# precision.
FLOW_TOLERANCE_M3_PER_MIN = 1e-3

MAX_ITERATIONS = 80

# Below this the search interval has closed on a single pressure. Reaching it with the
# residual still outside tolerance means the characteristic steps across zero there.
_INTERVAL_EPSILON_KPA = 1e-6

# How closely a flow found on the rising part of a pump curve must reproduce the header
# pressure through that curve, in kPa.
_HEAD_TOLERANCE_KPA = 1e-9

# The flow at which a pump branch's head stands for its shutoff head. The engine's `f2p`
# reports no head at zero flow, so the limit is taken just above it.
_SHUTOFF_FLOW_M3_PER_MIN = 1e-9


class PressureFlowElement(Protocol):
    """Anything that turns a pressure difference into a flow.

    The engine's branches, pumps and valves all satisfy this. Depending on the protocol
    rather than on a concrete class is what keeps this module testable without building a
    plant, and what would let a branch be replaced without touching the solver.
    """

    def p2f(self, dp: float) -> float:
        """Flow in m3/min at pressure difference `dp` in kPa."""


class PumpBranch(PressureFlowElement, Protocol):
    """A source: a pump branch, which can also say what head it makes at a given flow.

    `f2p` is needed only where a balance falls on the step at the top of a pump curve, to
    find a flow on the curve's rising part; the engine's `BranchW` provides it.
    """

    def f2p(self, g: float) -> float:
        """Pressure difference in kPa the branch delivers to the header at flow `g`."""


@dataclass(frozen=True, slots=True)
class HeaderBalance:
    """A closed header: the pressure that balances it and the flow in every branch.

    `source_flows` and `sink_flows` are aligned with the sequences passed in, including a
    zero for each branch that was out of service, so a caller can map a flow back to the
    device it belongs to by index without tracking which ones it skipped.
    """

    delta_p_kpa: float
    source_flows: tuple[float, ...]
    sink_flows: tuple[float, ...]
    residual_m3_per_min: float
    iterations: int
    rising: tuple[int, ...] = ()
    """Indices of the sources running on the rising part of their curve, below the flow
    of their highest head. The flows are on the curve, but a real pump there hunts."""

    @property
    def total_source_flow(self) -> float:
        return sum(self.source_flows)

    @property
    def total_sink_flow(self) -> float:
        return sum(self.sink_flows)


class HydraulicSolveError(RuntimeError):
    """Raised when a header cannot be balanced.

    Carries what was tried, because the useful question is always which end of the
    interval was wrong and by how much.
    """


def solve_header(
    sources: Sequence[PumpBranch | None],
    sinks: Sequence[PressureFlowElement | None],
    *,
    max_delta_p_kpa: float = MAX_DELTA_P_KPA,
    tolerance: float = FLOW_TOLERANCE_M3_PER_MIN,
    max_iterations: int = MAX_ITERATIONS,
) -> HeaderBalance:
    """Find the header pressure at which source flow equals sink flow.

    Sources push into the header and see `+dp`; sinks draw from it and see `-dp`. A
    `None` entry is a branch out of service — a stopped pump, a shut valve — and
    contributes no flow while keeping its place in the returned tuples.

    Raises:
        HydraulicSolveError: if no pressure in `[0, max_delta_p_kpa]` balances the header,
            or if the search does not reach `tolerance` within `max_iterations`.
        ValueError: if `max_delta_p_kpa` is not positive.
    """
    if max_delta_p_kpa <= 0.0:
        raise ValueError(f"max_delta_p_kpa must be positive, got {max_delta_p_kpa}")

    def source_flow(dp: float) -> float:
        return sum(max(0.0, float(e.p2f(dp))) for e in sources if e is not None)

    def sink_flow(dp: float) -> float:
        return sum(max(0.0, float(e.p2f(-dp))) for e in sinks if e is not None)

    def residual(dp: float) -> float:
        return source_flow(dp) - sink_flow(dp)

    low, high = 0.0, float(max_delta_p_kpa)
    residual_low, residual_high = residual(low), residual(high)

    # Nothing is running, or the pumps are exactly matched at zero pressure. Both are
    # real states — a plant at rest is the common one — and neither needs a search.
    if abs(residual_low) <= tolerance:
        return _balance(low, sources, sinks, residual_low, 0)

    # The residual falls monotonically with pressure, so opposite signs at the ends of
    # the interval is exactly the condition for a root inside it.
    if residual_low < 0.0:
        raise HydraulicSolveError(
            f"the header draws more than it is fed even at zero pressure "
            f"(residual {residual_low:.4g} m3/min): a sink is being driven by something "
            f"other than this header, or a source was passed as a sink"
        )
    # A header nothing will draw from. The engine clamps a pump's flow to zero above its
    # shutoff head, so the residual is flat at zero across the whole upper interval and
    # every pressure in it "balances" equally well — the reference version returns
    # whichever one its bisection happens to land on. There is no determinate answer
    # here, and pumps running into a fully shut header is a fault to surface rather than
    # a state to report a pressure for. In this topology family a bypass is always
    # present, so reaching it means something upstream commanded every valve shut.
    if sink_flow(high) <= tolerance:
        raise HydraulicSolveError(
            f"nothing will draw from the header at any pressure up to "
            f"{max_delta_p_kpa:g} kPa while {source_flow(0.0):.4g} m3/min is being "
            f"pumped into it: every consumer valve, including the bypass, is shut. The "
            f"pumps are deadheaded and the header pressure is not determined."
        )

    if residual_high > tolerance:
        raise HydraulicSolveError(
            f"the header does not balance below {max_delta_p_kpa:g} kPa "
            f"(residual {residual_high:.4g} m3/min at that pressure): the pumps can push "
            f"more than the consumers will take, which usually means every consumer "
            f"valve is shut or the branch resistances are far too high"
        )

    for iteration in range(1, max_iterations + 1):
        middle = (low + high) / 2.0
        residual_middle = residual(middle)
        if abs(residual_middle) <= tolerance:
            return _balance(middle, sources, sinks, residual_middle, iteration)

        # The interval has closed on a point where the residual still jumps across zero.
        # A pump's characteristic is not continuous: the engine's quadratic curve reaches
        # its highest head at a positive flow, so just above that the branch delivers
        # nothing at all rather than tapering to nothing. When the crossing lands on that
        # step, the pumps that stepped are shut by their check valves or run on the
        # rising part of their curves (see the module docstring). If no pump stepped, or
        # neither state closes the header, there is no balance, and saying "it did not
        # converge" would point at the search instead of at the plant.
        if high - low < _INTERVAL_EPSILON_KPA:
            resolved = _resolve_step(
                low,
                high,
                sources,
                sinks,
                max_delta_p_kpa=max_delta_p_kpa,
                tolerance=tolerance,
                max_iterations=max_iterations,
                iterations=iteration,
            )
            if resolved is not None:
                return resolved
            raise HydraulicSolveError(
                f"the header balances nowhere: at {middle:.4g} kPa the sources deliver "
                f"{source_flow(low):.4g} m3/min and just above it they deliver "
                f"{source_flow(high):.4g}, while the sinks want "
                f"{sink_flow(middle):.4g}. The pumps cannot supply what the open valves "
                f"will pass — too few pumps running for the flow path, or branch "
                f"resistances far apart from the pump curve."
            )

        if residual_middle > 0.0:
            low = middle
        else:
            high = middle

    raise HydraulicSolveError(
        f"no balance within {tolerance:g} m3/min after {max_iterations} iterations; "
        f"the interval has narrowed to [{low:.6g}, {high:.6g}] kPa with a residual of "
        f"{residual((low + high) / 2.0):.4g} m3/min. A characteristic that is not "
        f"monotonic in pressure would do this."
    )


def _resolve_step(
    low: float,
    high: float,
    sources: Sequence[PumpBranch | None],
    sinks: Sequence[PressureFlowElement | None],
    *,
    max_delta_p_kpa: float,
    tolerance: float,
    max_iterations: int,
    iterations: int,
) -> HeaderBalance | None:
    """Close a header whose balance falls on the step at the top of a pump's curve.

    `low` and `high` are the two sides of the step, less than a micro-kilopascal apart. A
    source whose flow drops across it is a pump at its highest head. Two states keep
    every branch on its own characteristic; they are tried in order:

    1. Its check valve is shut and it delivers nothing. This holds if the other sources
       alone balance the header at or above its shutoff head.
    2. It runs on the rising part of its curve. The header pressure lies between its
       shutoff head and its highest head, where its flow is the smaller root of its curve.

    Returns:
        The balance, or None if no source stepped or neither state closes the header — a
        genuine failure for the caller to report.
    """
    at_low = [0.0 if e is None else max(0.0, float(e.p2f(low))) for e in sources]
    at_high = [0.0 if e is None else max(0.0, float(e.p2f(high))) for e in sources]
    stepped = [index for index, (a, b) in enumerate(zip(at_low, at_high)) if a - b > tolerance]
    if not stepped:
        return None

    shutoff = {index: _shutoff_head(sources[index]) for index in stepped}
    without = [None if index in shutoff else e for index, e in enumerate(sources)]
    try:
        shut = solve_header(
            without,
            sinks,
            max_delta_p_kpa=max_delta_p_kpa,
            tolerance=tolerance,
            max_iterations=max_iterations,
        )
    except HydraulicSolveError:
        shut = None
    if shut is not None and all(shut.delta_p_kpa >= head for head in shutoff.values()):
        return HeaderBalance(
            delta_p_kpa=shut.delta_p_kpa,
            source_flows=shut.source_flows,
            sink_flows=shut.sink_flows,
            residual_m3_per_min=shut.residual_m3_per_min,
            iterations=iterations + shut.iterations,
            rising=shut.rising,
        )

    # On the rising part. Each stepped pump's flow there runs from nothing at its shutoff
    # head up to its flow at the step, so the search is over pressures every one of them
    # can make, up to the step itself.
    bottom = max(shutoff.values())
    top = (low + high) / 2.0
    if bottom >= top:
        return None

    def flows(dp: float) -> list[float]:
        result = []
        for index, e in enumerate(sources):
            if e is None:
                result.append(0.0)
            elif index in shutoff:
                result.append(_rising_flow(e, dp, at_low[index]))
            else:
                result.append(max(0.0, float(e.p2f(dp))))
        return result

    def sink_flows(dp: float) -> list[float]:
        return [0.0 if e is None else max(0.0, float(e.p2f(-dp))) for e in sinks]

    def residual(dp: float) -> float:
        return sum(flows(dp)) - sum(sink_flows(dp))

    if residual(bottom) > tolerance or residual(top) < -tolerance:
        return None
    for iteration in range(1, max_iterations + 1):
        middle = (bottom + top) / 2.0
        residual_middle = residual(middle)
        if abs(residual_middle) <= tolerance or top - bottom < _INTERVAL_EPSILON_KPA:
            source_flows = flows(middle)
            return HeaderBalance(
                delta_p_kpa=middle,
                source_flows=tuple(source_flows),
                sink_flows=tuple(sink_flows(middle)),
                residual_m3_per_min=sum(source_flows) - sum(sink_flows(middle)),
                iterations=iterations + iteration,
                rising=tuple(index for index in stepped if source_flows[index] > 0.0),
            )
        if residual_middle < 0.0:
            bottom = middle
        else:
            top = middle
    return None


def _shutoff_head(branch: PumpBranch) -> float:
    """The head a pump branch makes against a shut valve: its curve at no flow."""
    return float(branch.f2p(_SHUTOFF_FLOW_M3_PER_MIN))


def _rising_flow(branch: PumpBranch, dp: float, peak_flow: float) -> float:
    """The flow below `peak_flow` at which the branch's curve makes `dp`.

    Head rises with flow on this part of the curve, so a bisection on flow finds it. At or
    below the shutoff head the pump delivers nothing: its check valve holds.
    """
    if dp <= _shutoff_head(branch):
        return 0.0
    low, high = 0.0, peak_flow
    for _ in range(200):
        middle = (low + high) / 2.0
        head = float(branch.f2p(middle))
        if abs(head - dp) <= _HEAD_TOLERANCE_KPA:
            return middle
        if head < dp:
            low = middle
        else:
            high = middle
    return (low + high) / 2.0


def _balance(
    delta_p: float,
    sources: Sequence[PressureFlowElement | None],
    sinks: Sequence[PressureFlowElement | None],
    residual: float,
    iterations: int,
) -> HeaderBalance:
    return HeaderBalance(
        delta_p_kpa=delta_p,
        source_flows=tuple(
            0.0 if e is None else max(0.0, float(e.p2f(delta_p))) for e in sources
        ),
        sink_flows=tuple(
            0.0 if e is None else max(0.0, float(e.p2f(-delta_p))) for e in sinks
        ),
        residual_m3_per_min=residual,
        iterations=iterations,
    )


def mix_temperature(
    temperatures: Sequence[float], flows: Sequence[float], *, fallback: float
) -> float:
    """The flow-weighted temperature of several streams joining.

    `fallback` is returned when nothing is flowing, which is a real state rather than an
    error: a header with every pump stopped has no mixed temperature, and the caller
    supplies what to report instead — usually the previous step's value.

    Unlike the reference version, a mismatch between the two sequences raises. There it
    returns the fallback, so a caller that built its lists wrongly gets a plausible
    temperature and never finds out.

    Raises:
        ValueError: if the sequences differ in length, or if any flow is negative.
    """
    if len(temperatures) != len(flows):
        raise ValueError(
            f"{len(temperatures)} temperature(s) but {len(flows)} flow(s); "
            "they describe the same streams and must correspond"
        )
    if any(flow < 0.0 for flow in flows):
        raise ValueError(
            f"negative flow in {list(flows)}: a stream joining a header cannot run "
            "backwards, so this is a sign error rather than a physical state"
        )

    total = sum(flows)
    if total <= 0.0:
        return float(fallback)
    return sum(t * g for t, g in zip(temperatures, flows)) / total
