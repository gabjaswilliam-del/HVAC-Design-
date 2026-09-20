# Simulation

A shipped, on-demand simulator configured for the site's pump station and cooling
system using CAD-derived topology plus verified equipment and operating parameters.
Own scenario setup, execution, simulated state, action handling, and result history.
Validate calibration and fidelity against the actual site when data is available.

The selected foundation is a **modified version of PHYVAC**. Expose public
run/state/action interfaces to the API, agent, and pilot; keep PHYVAC-specific
assembly/stepping in an adapter in `integrations/`. Our module owns scenarios,
the run state machine, simulation time, controller selection, and result history.
The maintained fork, pinned revision, and modification scope remain to be specified.

Use the same validated site revision as the dashboard and telemetry bindings.
Support reproducible comparisons with matched demand, weather, initial state, and
duration. Run lifecycle must not depend on a browser connection. Keep physics,
controller policy, and the pilot's slower reasoning separate. Simulated actions
never implicitly write to physical equipment.

Placeholder only. Store generated runs and customer parameters outside Git.
