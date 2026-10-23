# Core domain

Shared contracts for the single site's equipment identities, topology, connections,
units, sensor mappings, observations, and common events. Shared scene/configuration
references should preserve the same equipment IDs across modules.

Keep module-private types in their owning module. `core` must not import feature
modules, applications, provider SDKs, or training frameworks. Do not use it as a
generic utilities folder or add tenant/fleet abstractions.

| Module | Owns |
|---|---|
| `units.py` | named conversions, so a factor of sixty is never typed inline |
| `metrics.py` | the `device:metric` point vocabulary, and rejection of names outside it |
| `observation.py` | what a reading is, including whether it is real or simulated |
| `actions.py` | what a command is, and what makes one well formed |
| `site.py` | the site definition: topology, equipment, control, boundary, calibration |

`site.py` is here rather than in `simulation/` because the topology is read by the
dashboard, by telemetry mapping and by forecasting as well as by the simulator. A
schema owned by one consumer would have to be imported by the others.
