"""Which machines run: from how many the baseline asks for to which ones.

The baseline decides counts — two chillers, two chilled-water pumps, one tower. A plant
needs device IDs, and in this topology family which pump runs is not a free choice. A pump
the links pair with a chiller is in series with it, so it runs when that chiller does and
not otherwise. The first version of the plant ran "the first n pumps" and read the links
for nothing, so a site whose pumps were wired the other way round simulated exactly as
though they were not.

A header pump is paired with nothing: it feeds a common header that every chiller without
a pump of its own opens onto. Those pumps are staged on their own count, not one per
chiller, because the water they move is shared among the header's running chillers. The
hydraulic solve then decides how much reaches each.

Like the baseline, this touches no physics. It is a function of the command and of who is
connected to whom, so a dispatch decision is tested without building a plant.
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Mapping

from hvac_agent.core.metrics import DeviceFamily
from hvac_agent.simulation.baseline import Command

__all__ = [
    "PUMP_FAMILIES",
    "Forced",
    "Roster",
    "available_chillers",
    "available_towers",
    "chiller_order",
    "dispatch",
]

PUMP_FAMILIES = (DeviceFamily.CHILLED_WATER_PUMP, DeviceFamily.COOLING_WATER_PUMP)


@dataclass(frozen=True, slots=True)
class Roster:
    """The machines, in duty order, and which pump each chiller is in series with.

    `paired` maps a chiller to its own pump, per pump family. A chiller absent from it
    opens onto the header and is fed by a header pump: one paired with no chiller.
    """

    chillers: tuple[str, ...]
    cooling_towers: tuple[str, ...]
    pumps: Mapping[DeviceFamily, tuple[str, ...]]
    paired: Mapping[DeviceFamily, Mapping[str, str]]

    def header_pumps(self, family: DeviceFamily) -> tuple[str, ...]:
        partnered = set(self.paired[family].values())
        return tuple(pump for pump in self.pumps[family] if pump not in partnered)

    def on_header(self, chiller: str, family: DeviceFamily) -> bool:
        """Whether a chiller is fed from the header on one side rather than by its own pump."""
        return chiller not in self.paired[family]


@dataclass(frozen=True, slots=True)
class Forced:
    """Machines started or stopped by hand, which the baseline works around.

    A machine stopped by hand is unavailable to the baseline until released. One started
    by hand runs, and counts towards however many the baseline wants: starting chiller 2
    by hand while the load calls for one chiller makes chiller 2 that one, as choosing
    the lead machine does on a real plant. Hand commands are not held to the baseline's
    minimum switch interval; that protection is the baseline's, and a person overriding
    it has decided to.
    """

    on: frozenset[str] = frozenset()
    off: frozenset[str] = frozenset()


def available_chillers(roster: Roster, forced: Forced = Forced()) -> tuple[str, ...]:
    """Chillers that can run: not stopped by hand, with an unstopped pump on each side.

    A chiller whose own pump is stopped by hand has no flow path, since it opens only
    into that pump; a chiller on the header needs one header pump that is not stopped.
    """

    def has_path(chiller: str, family: DeviceFamily) -> bool:
        own = roster.paired[family].get(chiller)
        if own is not None:
            return own not in forced.off
        return any(pump not in forced.off for pump in roster.header_pumps(family))

    return tuple(
        chiller
        for chiller in roster.chillers
        if chiller not in forced.off
        and all(has_path(chiller, family) for family in PUMP_FAMILIES)
    )


def available_towers(roster: Roster, forced: Forced = Forced()) -> tuple[str, ...]:
    return tuple(tower for tower in roster.cooling_towers if tower not in forced.off)


def chiller_order(roster: Roster, forced: Forced = Forced()) -> tuple[str, ...]:
    """The order the baseline's chiller slots are filled in: every chiller, once.

    Started by hand first, then the other available chillers in duty order, then the
    ones that cannot run. The baseline decides per slot — how many run, what setpoint
    each is asked for — and this says which chiller each slot is. With nothing set by
    hand it is simply duty order, which is the baseline as it always was.
    """
    available = available_chillers(roster, forced)
    first = [chiller for chiller in available if chiller in forced.on]
    rest = [chiller for chiller in available if chiller not in forced.on]
    unavailable = [chiller for chiller in roster.chillers if chiller not in available]
    return tuple(first + rest + unavailable)


def dispatch(command: Command, roster: Roster, forced: Forced = Forced()) -> frozenset[str]:
    """The device IDs that run this step.

    Chillers fill the baseline's count in `chiller_order`; one started by hand runs even
    past the count. A chiller with its own pump on a side brings that pump, and never more
    paired pumps than chillers run, since a pump in series with a stopped chiller has
    nowhere to send water — the baseline's pump count is a request, and this is where it
    meets the pipes. A chiller on the header on a side needs only a header pump there that
    is free to run.

    Header pumps run on whatever of the baseline's pump count the paired pumps have not
    taken: at least one while any chiller is on the header, and no more than are free.
    They are not allotted one per chiller, so two chillers on one header pump both run and
    share its water. Towers are taken in duty order, started-by-hand first. Pumps and
    towers started by hand run whatever the count says, and count towards it; machines
    stopped by hand never do.

    A chiller with no flow path on a side does not run even though the count asked for it.
    """
    available = set(available_chillers(roster, forced))
    order = [chiller for chiller in chiller_order(roster, forced) if chiller in available]
    by_hand = sum(1 for chiller in order if chiller in forced.on)
    wanted = {
        DeviceFamily.CHILLED_WATER_PUMP: command.chilled_water_pumps_running,
        DeviceFamily.COOLING_WATER_PUMP: command.cooling_water_pumps_running,
    }
    # Paired pumps are bounded by the chillers as well as by the request.
    budget = {
        family: max(min(wanted[family], command.chillers_running), by_hand)
        for family in PUMP_FAMILIES
    }
    free = {
        family: [pump for pump in roster.header_pumps(family) if pump not in forced.off]
        for family in PUMP_FAMILIES
    }

    running: set[str] = set()
    taken = 0
    for chiller in order:
        if taken >= max(command.chillers_running, 0) and chiller not in forced.on:
            break
        own: dict[DeviceFamily, str] = {}
        has_path = True
        for family in PUMP_FAMILIES:
            if budget[family] <= 0:
                has_path = False
            elif roster.on_header(chiller, family):
                has_path = bool(free[family])
            else:
                own[family] = roster.paired[family][chiller]
            if not has_path:
                break
        if not has_path:
            continue

        for family in own:
            budget[family] -= 1
        running.add(chiller)
        running.update(own.values())
        taken += 1

    for family in PUMP_FAMILIES:
        if not any(roster.on_header(c, family) for c in roster.chillers if c in running):
            continue
        paired_running = sum(1 for pump in roster.paired[family].values() if pump in running)
        count = min(max(wanted[family] - paired_running, 1), len(free[family]))
        ordered = [p for p in free[family] if p in forced.on]
        ordered += [p for p in free[family] if p not in forced.on]
        running.update(ordered[:count])

    towers = available_towers(roster, forced)
    towers = [t for t in towers if t in forced.on] + [t for t in towers if t not in forced.on]
    wanted_towers = max(command.cooling_towers_running, 0)
    running.update(
        tower
        for index, tower in enumerate(towers)
        if index < wanted_towers or tower in forced.on
    )

    every_pump = {pump for family in PUMP_FAMILIES for pump in roster.pumps[family]}
    running.update(forced.on & every_pump)
    return frozenset(running - forced.off)
