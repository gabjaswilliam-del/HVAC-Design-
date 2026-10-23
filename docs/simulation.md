# The simulation foundation

What was built, why it is shaped this way, and what it is not yet good for. Read
[docs/architecture.md](architecture.md) first for module boundaries and
[docs/reference-review.md](reference-review.md) for what the reference projects
contributed.

A plant is assembled from configuration and stepped. Nothing in the product hard-codes a
site: the same code runs two chillers or twelve, and a different station is a different
directory of files. That is the whole point, and it is worth stating plainly because the
reference implementation reached eleven hand-written sites and about 28,900 lines before
the approach became untenable.

## A step

A control step is ten minutes and does seven things. Only one of them iterates.

```
 input:  cooling load [kW] · dry bulb [C] · relative humidity [%] · optional action

 1  boundary conditions          wet bulb from dry bulb and humidity;        integrations/
                                 the flow the load asks for
 2  control decision             the baseline policy around whatever is      simulation/
                                 held by hand; which machines, not how many
 3  hydraulic closure   ITERATES bisect header dp until source flow          integrations/
                                 equals sink flow, once per header
 4  machines                     chillers, towers and pumps                  integrations/
                                 (vendored PHYVAC)
 5  mixing nodes                 streams join weighted by flow               integrations/
 6  temperature dynamics         first-order lag and per-step limits         integrations/
 7  observation                  about a hundred points, named by the        core/ owns
                                 site's vocabulary                           the contract

 output: Observation
```

A day is 144 steps and takes a few seconds, so running faster than real time costs
nothing. Step 3 cannot be skipped: pumps are roughly a third of a plant's consumption and
their power comes from flow times pressure.

**Inlet temperatures lag one step, deliberately.** A chiller's condenser inlet is what the
towers produced during the previous step, not a temperature solved simultaneously with it.
The upstream engine's own examples work this way and so does the reference. At a
ten-minute step the lag is smaller than the transport delay it stands in for, but it is
the one place where the arithmetic is not what a steady-state reading of the diagram would
suggest, so it is stated rather than left to be discovered.

## Modules

| Module | Owns |
|---|---|
| `core/units.py` | Named conversions, so a factor of sixty is never typed inline |
| `core/metrics.py` | The `device:metric` vocabulary, and rejection of names outside it |
| `core/observation.py` | What a reading is, including whether it is real or simulated |
| `core/actions.py` | What a command is, and what makes one well formed |
| `core/site.py` | The site definition: loading, and refusing what cannot be loaded |
| `integrations/phyvac/vendor/` | The engine, unmodified except for recorded patches |
| `integrations/phyvac/hydraulics.py` | Closing a header of any size |
| `integrations/phyvac/builder.py` | Configuration to engine objects |
| `integrations/phyvac/plant.py` | The seven stages, coupled |
| `simulation/baseline.py` | The site's own control practice |
| `simulation/dispatch.py` | Which machines run: the baseline's counts, as device IDs, from the wiring |
| `simulation/run.py` | A run's lifecycle, clock and history, and what is held by hand |
| `simulation/corrections.py` | The gate a correction passes, and the ledger of what became of it |

Configuration lives in [`configs/site/`](../configs/site/README.md) as a sanitized
example, and in ignored `var/site/` for a real installation.

## Decisions worth knowing

### The site is data, in six files split by where each number comes from

Not by what the numbers describe. `topology`, `equipment`, `control` and `boundary` are
available at commissioning; `calibration/physics` and `calibration/display` need two to
four weeks of telemetry. That split is what makes two-tier delivery a structural fact
rather than a promise: a site whose `fits` are empty is a working uncalibrated model and
the file says so.

Every fitted value carries provenance. In the reference, one plant's fitted constants were
copied verbatim into at least five others, undetectably, because a fitted value and a
nameplate value look identical in a file. `fitted_from` makes a borrowed calibration
declare itself.

`calibration/display.yaml` changes readings and never physics: a flow, a temperature or a
power cannot move when only it changes. The plant's initial water temperatures once came
from it, which broke that promise; they are `initial_conditions` in
`calibration/physics.yaml`, and a test changes only the display file and requires every
other reading of a run to stay identical.

### One header solver, parameterized by count

The reference writes `solve_chilled_header` and `solve_condenser_header` separately for
each site, but they are the same function: sources see `+dp`, sinks see `-dp`, and only
the membership differs. The residual falls monotonically with pressure, so the root is
unique and a bisection cannot land on the wrong one.

Failure raises. The reference runs a fixed eighty iterations and returns the last midpoint
regardless, and when the interval holds no root it abandons bisection for a rule that
terminates at a point which is not a solution. A hydraulic state that does not exist is
not a number, and three distinct impossibilities are reported separately: deadheaded
pumps, a header that balances nowhere because the pumps cannot supply what the open valves
will pass, and a characteristic that is not monotonic.

One case looks like the second and is not. The engine's pump curve peaks at a positive
flow, and its `p2f` uses only the part beyond the peak: above the highest head it reports
nothing, so a running pump's characteristic steps from that flow straight to zero. Pumps at
one speed never meet the step near a balance; pumps in parallel at different speeds can,
when the faster ones raise the header to the slower one's highest head. Every flow inside
the step is off the pump's curve, so a balance there is resolved into one of two states
that are on it. If the other pumps can hold the header at or above the slower one's
shutoff head, its check valve stays shut and it delivers nothing. Otherwise it runs on the
rising part of its curve, below the flow of its highest head, at the pressure where its
flow makes exactly the header's head. A real pump there hunts, so the observation marks
its power uncertain and says why; it does the same for a running pump held shut, since the
engine's pump power is hydraulic and a real pump's power at shutoff is not modelled.

The first fix for this case held the slower pump at its highest head and scaled its flow
to close the header. The total balanced, but that flow was on no curve: on the example
site the header closed at 123.5 kPa with the slower pump given a flow at which its own
curve makes 116.2 kPa. The tests now check every conducting branch against its own curve,
not only the sum.

### Connections come from the topology, not from position

The reference pairs pump `n` with chiller `n` and clamps the index past the end, so a
standby pump silently borrows the last chiller's parameters. Here every link is written out
in `topology.yaml` and carries evidence: `confirmed`, `drawing`, `inferred` or `unknown`.
An inferred pairing is reported alongside the result rather than presented as site
fidelity. Links are not generated from the family at load time, because a generated
connection cannot be reviewed and the rule that produced it would be invisible.

The links decide the plant, and the loader refuses wiring the family cannot assemble. Each
link must be one of the family's connection kinds and declare the medium that connection
carries, and each port must have as many connections as the family allows: a chiller one
on each of its four ports, a tower one in and one out, and so on. A missing, extra or
unsupported connection is an error naming the port, with every problem reported at once.
An earlier version read the links only for a pairing it never used, so a topology with
every link deleted simulated the same plant as the complete one.

In this family each pump is in series with the chiller the links pair it with. A chiller
may instead open onto the header and be fed by a header pump — one linked to a header and
to no chiller — and the loader requires one to exist. `dispatch` turns the baseline's
counts into device IDs from that wiring. A chiller with its own pumps brings them, and
carries the flow its own pump delivers. Header pumps are a shared pool: they run on
whatever of the baseline's pump count the paired pumps have not taken, at least one while
any chiller is on the header, and every running chiller on the header takes an equal share
of their water. An earlier version gave each header chiller a header pump of its own, so
two chillers on one header pump could not both run, and the plant stopped at one rating
without saying why.

Machines are addressed by ID throughout. A correction to one pump reaches that pump and no
other, reordering `topology.yaml` does not move a setpoint to another chiller, and an
isolation valve finds its machine from where the topology places it. Frequency feedback is
read from the inverter the engine is running, not copied from the command.

### Cooling is what the chillers removed

A chiller reports the heat the engine says it took out of the water, against its own
rating. The header's cooling is the sum of those. The terminal's is the heat it put into
the water, which is the whole load whenever water moves. Three points that no BMS carries
keep the rest apart: `cooling_demand`, `cooling_unmet`, and `chw_loop_heat_accumulation`,
the heat left in the loop in a step — positive while the chillers fall short, negative
while they pull the loop back down.

The reference reports the demand under its cooling points. So did an earlier version of
this model, by a different route: it reconstructed cooling from a return temperature that
is itself derived from the demand. Either way a plant at capacity reported the demand as
delivered; at 5,000 kW against two chillers of about 700 kW the cooling points read about
4,999 kW while the loop climbed without limit.

A chiller the engine computed outside its performance data — past its rating, off the edge
of its table, or on a substituted efficiency — has its power and cooling marked
`uncertain`, and the observation carries a note saying why. The engine keeps one flag per
chiller and overwrites an overload with a table-edge code in the same calculation, so
overload is read from its effect: an outlet above setpoint.

Each machine reports its own water. A chiller's inlet and outlet points, on both sides, are
the temperatures the engine used for it in that step, so its cooling, its power and its
temperatures describe one calculation; a tower reports its own outlet. The mixed loop
temperatures are the SYSTEM points. A machine with no water moving through it reports the
header water it stands in, marked uncertain, with a note. An earlier version copied the
mixed loop into every chiller's points, so a correction to one chiller's setpoint showed on
neither, and both reported the next step's return as what they had taken in. A running
chiller asked for a supply warmer than its return removes nothing and now passes the water
through unchanged; the engine sets its outlet to the setpoint regardless, and mixing that
in heated the loop with no power drawn.

A chiller cools only with water on both sides. One told to run without evaporator water has
nothing to cool, and one without condenser water has nowhere to put the heat; either way it
removes nothing, the water still flowing on the other side passes through unchanged, its
cooling and power are marked uncertain, and a note says that a real machine would trip.
The loss is unmet demand. This arises when a faster pump holds a slower one shut. An
earlier version checked only the evaporator side and gave the engine a millionth of a cubic
metre a minute of condenser water when there was none, so the chiller went on cooling and
reported a condenser outlet of millions of degrees.

A step that would take either loop, or any cooling chiller's own outlets, outside
`operating_envelope` in `calibration/physics.yaml` fails the run, naming the temperature,
its limit, and the demand against what was removed. The chillers are checked one by one
because a machine on a trickle of condenser water can leave the range its data covers
while the mixed return does not. The engine would go on producing numbers; they would not
be a plant's. The envelope is wide on purpose, for the reason under Scope.

### The run owns the clock

The reference takes a timestamp from its caller and never checks it, so a caller that
repeats or rewinds one desynchronises the recorded timeline from the simulated one with
nothing to show for it. Here a plant whose reported time disagrees with the run's clock
fails the run.

`observe()` reads state without advancing it. The reference has no such operation — the
only way to read a plant is to step it, so a dashboard refresh costs a step of simulated
time.

Two locks, not one. The engine lock is held for a whole step; the state lock is never held
across an engine call. With a single lock, `pause()` queues behind the step it was meant to
interrupt — measured at 0.45 s before the split, and the test that measures it remains.

There are no frame listeners: consumers poll, so a slow one delays only itself. There is
no browser coupling and no scenario looping, both of which the prototype has.

### Corrections are judged, applied, and accounted for separately

An action is a snapshot. It copies its setpoints when it is made, so the values the gate
checks are the values that run and the values the ledger records, whatever later happens
to the caller's dictionary. An earlier version held that dictionary, and a value changed
after the gate had accepted it reached the plant outside the equipment limits and rewrote
the recorded proposal.

Six checks stand between a proposal and a step: the run is active, the action names this
run, it was computed against an observation the run has not moved past, its points exist
and are handles, its values are inside the site's equipment limits, and it is internally
consistent.

A rejection is an ordinary answer rather than an error, because a decider that thinks
about what it sees will often finish after the plant has moved on. Rejected proposals are
kept: what was refused is as much a part of the account as what ran.

Three phases stay separate — proposed, applied, achieved. A correction applied exactly as
proposed that did not achieve what it asked for is the case worth looking at, and it is
only visible if the request and the result are both recorded. The outcome reads the
feedback point rather than the setpoint, since reading a setpoint back only confirms that
a number was stored.

Accepted is not applied. A correction that passes the gate is queued; the step that takes
it applies it, and the run records which step that was at the moment of taking — in the
same hold of its lock as reading the step count. Until then a correction may be superseded
by a later one, since only one can wait, or expire when the run ends first. Each record
says which. An earlier version marked a correction applied when it was queued, at the step
count of that moment, so a superseded one was recorded as having run, and one queued while
a step was inside the plant was measured against that step although it ran in the next.

A manual setpoint holds from the step that takes it until a later action sets that point
to something else or releases it; a PLC action releases everything. The run keeps what is
held and gives the plant the whole set each step. A one-step correction would make stopping
a machine by hand meaningless: the baseline would start it again ten minutes later.

Running states are handles like any other. A machine stopped by hand is unavailable to the
baseline, and so is a chiller whose own pump is stopped, since it has no flow path. A
machine started by hand runs and counts towards what the baseline stages — starting chiller
2 while the load calls for one makes chiller 2 that one, as choosing a lead machine does on
a real plant. Neither is held to the baseline's minimum switch interval, which protects
against the baseline's own flapping rather than against a person's decision. When a point
is released the baseline chooses afresh in duty order, which may swap straight back. A pump
running beside a stopped chiller moves water through it uncooled; a chiller started by hand
with no pump free does not run, and the observation says why.

Nothing here reaches physical equipment. A path to real equipment would be a separate
design with its own authorisation, not a reuse of this.

## What the comparison showed

Both this model and the reference's hand-written FuZhou plant were driven through the same
twenty-four hours: the same load curve, the same weather, the same baseline mode.

| Quantity | This model | Hand-written | Normalised MAE |
|---|---|---|---|
| Chillers running | 1.57 | 1.57 | 0.00% |
| Header cooling | 599 kW removed | 605 kW demanded | 1.82% |
| Condenser supply / return temperature | 26.28 / 28.65 C | 26.77 / 28.17 C | 1.99% / 3.86% |
| Chilled-water flow | 154 m3/h | 189 m3/h | 19.15% |
| Chilled supply / return temperature | 9.28 / 12.37 C | 7.00 / 9.79 C | 32.60% / 26.38% |
| Daily energy | 2474 kWh | 2854 kWh | -13.34% |

Staging agrees step for step across all 144 steps, including the seven where both plants
shut down entirely while the building still had load.

The cooling row does not compare like with like. Here it is what the chillers removed; the
reference reports the demand under the same point, so part of that row's difference is the
definition. It is also why the reference cannot be checked for balance: a demand compared
with itself always agrees. This model's terminal takes the whole load into the water at
every step with flow, and over the day the chillers removed within 0.30% of what the
terminal put in. 199 kWh of the day's demand went unmet, and this model says so under
`cooling_unmet`.

The remaining disagreement is one chain, not a scatter: the chilled-water return settles
2.6 K warmer here, so less water carries the same duty, so the pumps draw less. Both models
are internally consistent; they settle at different operating points.

**The comparison found a defect nothing else could have.** The baseline commanded machine
counts and setpoints but never a pump speed, so a variable-speed pump was never varied.
Daily energy was 71.3% above the reference. Every test written before that point passes
with the defect present, because they are self-consistency checks and a plant missing a
control it never uses is consistent with itself. Finding it needed a second model.

**Closer agreement with the hand-written plant is not the goal.** That model's own
validation error against measurements is 2.51 K on chilled-water return — the same size as
our disagreement with it — and its calibration objective contains no power point at all, so
its consumption accuracy is unmeasured. See
[docs/reference-review.md](reference-review.md). Replay against measured data is the only
thing that would be validation, and it is not yet possible: the station with measurements
has grouped chiller-pump-tower coupling, which is outside the topology family this
foundation assembles.

## Scope

Modelled: water-cooled electric chillers, open cooling towers, primary chilled-water and
condenser-water pumps, one lumped terminal, and the bypasses and isolation valves the
family requires.

Not modelled: thermal storage, secondary chilled-water loops, chillers in series, heat
recovery, free cooling, and grouped coupling between machines. Air handlers are one
aggregate load, not individual units. A machine is on or off within a step; nothing models
the minute or two a chiller takes to come up.

Nor is the water in the loops: a step's shortfall goes straight into the loop temperature,
with no thermal mass to slow it. So a cold start near full capacity overshoots while the
second chiller waits out its switch interval — on the example site the chilled-water return
reaches about 30 C at 1,400 kW before settling — and a sustained overload heats without
limit. The first must pass and the second must not, which is why `operating_envelope`
allows chilled water up to 40 C: a real loop would move more slowly than either.

Four defects in the vendored engine are pinned rather than fixed, as
`xfail(strict=True)` tests. They sit in a stratified storage tank and a gas absorption
chiller, neither of which this topology family contains, and correcting them would change
computed results. See `integrations/phyvac/vendor/UPSTREAM.md`.

Two behaviours of the reference's control are reproduced faithfully although they look
wrong, because a comparison against it is only meaningful if the controls match. Both are
named configuration rather than buried constants, so changing them is a decision somebody
makes:

- `last_unit_shutdown_factor` stops the last chiller below 22.5% of one machine's rating,
  with the building still asking for cooling. Setting it to zero holds the last machine
  until the load reaches zero.
- The tower-fan trim weights, 0.35 and 0.2, were bare literals with no stated basis.

## Status

495 tests — 491 passing and 4 `xfail`, the latter pinning engine defects described under
Scope. The suite gives the same result on a Windows workstation and on the DGX Spark, so
nothing here depends on the platform. The engine's characterized behaviour is identical on
NumPy 1.26 / SciPy 1.12 and on NumPy 2.5 / SciPy 1.18, so the paths this depends on are
not version-sensitive either.

The first review of this foundation, on the DGX Spark against synthetic probes, found six
defects that every test then passed with: wiring that did not drive the plant, cooling
reconstructed from demand, corrections that reached the wrong machine or none, feedback
copied from the command, corrections recorded as applied before they ran, and physics read
from a display file. Each is fixed above and has a regression test. The lesson
generalises: a design promise stated in a docstring needs a test that changes one
input and requires the right things to change and the rest not to.

The second review found four more: the fallback added for unequal pump speeds, which
closed the header off the pumps' curves; header pumps allotted one per chiller; per-device
temperatures copied from the mixed loop; and an action that held its caller's dictionary.
Two are the first review's own fixes stopping short — a balance checked only in total, and
cooling taken from the engine while the temperatures beside it were not. So the second
lesson: when a figure is made to come from the machine, everything reported beside it has
to come from the same place, and an equation is checked term by term, not by its sum.

The third review confirmed those four and found one more of the same kind: a chiller with
no condenser water still cooled, because only the evaporator side was checked and the
engine was handed a token flow. A guard on one side of a machine needs its twin on the
other, and nothing should hand the engine a quantity the plant does not have.

One dependency was added for this work: PyYAML, for site configuration. It is the first
dependency in this project not inherited from the vendored engine, and it is confirmed on
the DGX Spark's architecture.

This covers stages 1 and 2 of the sequence in
[docs/reference-review.md](reference-review.md). Nothing above draws a plant, serves an
API, or decides what to correct; those are later stages and need their own authorization.
