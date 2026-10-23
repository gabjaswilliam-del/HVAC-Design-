# Simulation

A planned shipped, on-demand simulator configured for the site's pump station and cooling
system using CAD-derived topology plus verified equipment and operating parameters.
Own scenario setup, execution, simulated state, action handling, and result history.
Validate calibration and fidelity against the actual site when data is available.

The selected foundation is a **modified version of PHYVAC**. Expose public
run/state/action interfaces to the API, agent, and pilot; keep PHYVAC-specific
assembly/stepping in an adapter in `integrations/`. Our module owns scenarios,
the run state machine, simulation time, controller selection, and result history.
The vendored engine, its provenance and its patches are recorded in
`integrations/phyvac/vendor/UPSTREAM.md`.

Use the same validated site revision as the dashboard and telemetry bindings.
Support reproducible comparisons with matched demand, weather, initial state, and
duration. Run lifecycle must not depend on a browser connection. Keep physics,
controller policy, and the pilot's slower reasoning separate. Simulated actions
never implicitly write to physical equipment.

| Module | Owns |
|---|---|
| `baseline.py` | The site's own control practice: how many machines, at what setpoints and speeds |
| `dispatch.py` | Which machines those are, from the topology's wiring and anything held by hand |
| `run.py` | A run's lifecycle, clock and history; submitted actions and what became of them; what is held by hand |
| `corrections.py` | The gate a correction passes, and the ledger from proposal to measured outcome |

A manual correction holds until it is replaced or released. What was built, and why, is
in [docs/simulation.md](../../../docs/simulation.md).

The UI belongs in
[apps/dashboard/src/features/simulation/](../../../apps/dashboard/src/features/simulation/README.md).
Follow that brief for lifecycle controls, result presentation and correction history;
do not put browser code or chart logic in this module. The API composes the public
run interface. Store generated runs and customer parameters outside Git.
