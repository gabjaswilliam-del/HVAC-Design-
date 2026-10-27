# Single-site configuration

One installation has one site. There is no name level above this directory and no
registry: this is the sanitized example, and the real installation's configuration has
the same structure in ignored `var/site/`. The values here are synthetic and rounded.

| File | Holds | Comes from | Available |
|---|---|---|---|
| `site.yaml` | schema version, revision, topology family, file list | — | — |
| `topology.yaml` | devices, buses, links, valves — with evidence | CAD extraction, then operator confirmation | day one |
| `equipment.yaml` | manufacturer curves, nameplate ratings, valve sizing | vendor data sheets | day one |
| `control.yaml` | PID gains, staging thresholds, frequency limits, protection | the site's PLC and operating practice | day one |
| `boundary.yaml` | assumptions about the load side, which is not modelled | engineering judgement | day one |
| `calibration/physics.yaml` | pipe resistance, tower capacity, condenser dynamics, initial water temperatures, operating envelope | fitting against BMS data; engineering defaults until then | after 2-4 weeks |
| `calibration/display.yaml` | gauge-pressure mapping | fitting against BMS data | after 2-4 weeks |

Changing `calibration/display.yaml` changes a reading and never a flow, a temperature or
a power. Anything that reaches the physics — including where the water temperatures start
— belongs in `calibration/physics.yaml`. `operating_envelope` there is the range of water
temperatures the model describes; a run that would leave it fails and says why.

The split is by where a number comes from and when it can be obtained, because that is
what decides when a site can be commissioned. The first four files are enough to run:
they answer staging, capacity and fault-baseline questions. Calibration is what makes
pressures and absolute energy reproduce measurements. A site whose `fits` are empty is
a working model that has not been calibrated, and the file says so rather than leaving
it to be discovered by comparing numbers.

## Format

YAML. The topology is a graph, and a graph is read and corrected far more easily as
indented lists than as the array-of-tables a TOML equivalent would need. Operator
review of the connection list is a required step, not an optional one, so that cost is
paid on every installation. TOML would have avoided a dependency — `tomllib` is in the
standard library — which is the reason to revisit this if the review workflow changes.

Numeric keys carry their unit in the name, matching `hvac_agent.core.units`. Device ids
and families match `hvac_agent.core.metrics`, so a device in `topology.yaml` and a point
in an observation cannot drift apart.

One hazard the format brings with it: YAML 1.1 reads `on`, `off`, `yes` and `no` as
booleans, so a valve written as `on: [chiller_plant_1, evap_out]` parses as a key of
`True`. A valve in one line is therefore `at:`, and a valve between two headers is
`across:`. `tests/core/test_site.py` fails if one of those words reappears as a key.

## Evidence

Every device, link and valve carries `evidence`:

| | meaning |
|---|---|
| `confirmed` | an operator confirmed it against the installation |
| `drawing` | read from the CAD drawing, not yet confirmed |
| `inferred` | produced by a rule rather than evidence, e.g. "pump n serves chiller n" |
| `unknown` | the topology family requires the connection but nothing supports it |

A valve says where it sits with `at: [device, port]` for one in a line, or
`across: [[bus, a], [bus, b]]` for one between two headers — exactly one of the two.

Links are written out rather than generated from the family at load time. A generated
connection cannot be reviewed or corrected, and the rule that generated it would be
invisible in the file. A tool proposes the list; a person confirms it.

`inferred` and `unknown` do not block a run. They are reported with the result, so that
a number is never presented as site fidelity when the topology behind it was assumed.

## Connections

The links are what the plant is assembled from, so the loader checks them against the
topology family. Each link must be one of the family's connection kinds and declare the
medium that connection carries, and each port must have the number of connections the
family allows. In `water_cooled_chiller_plant_v1`:

| Port | Connections |
|---|---|
| chiller `evap_in`, `evap_out`, `cond_in`, `cond_out` | exactly one each |
| chilled-water pump `discharge` / `suction` | one / at most one |
| condenser-water pump `suction`, `discharge` | exactly one each |
| tower `water_in`, `water_out`; terminal `water_in`, `water_out` | exactly one each |

A pump is in series with the chiller it is linked to: a chilled-water pump's suction from
the chiller's `evap_out`, a condenser pump's discharge into its `cond_in`. A chiller may
instead open onto the header (`evap_out` to `chw_supply`, `cond_in` from `cw_supply`);
it is then fed by a header pump, one linked to a header and to no chiller, and at least
one must exist. Header pumps are shared: they run on the baseline's pump count, not one per
chiller, and every running chiller on the header takes a share of their water. A missing,
extra or unsupported connection is a load error naming the port. To take a machine out of the plant, remove the device and its links together.

## Provenance

Every entry under `fits` in either calibration file carries provenance: what data it was
fitted from, over which window, when, by what method, and how well it fit. `fitted_from`
names a site, which may be a different one — borrowing another plant's calibration is
allowed, but it has to declare itself.

## What is deliberately not here

| | where it belongs |
|---|---|
| Solver iteration counts and tolerances | simulation defaults; a site overrides one only with a reason |
| Initial valve openings, running counts, step length, input series | a simulation run, not the site |
| Reward weights and scoring bands | the agent; a plant configuration is not the place for a product objective |
| Where anything is drawn — sides, coordinates, sizes, labels | the generated scene in `var/`; a visual rearrangement must not change physics |
| Performance workbooks, telemetry, real values | ignored `var/site/`; customer data is never committed |
