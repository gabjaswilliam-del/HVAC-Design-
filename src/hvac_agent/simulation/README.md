# Simulation

A planned shipped, on-demand simulator configured for the site's pump station and cooling
system using CAD-derived topology plus verified equipment and operating parameters.
Own scenario setup, execution, simulated state, action handling, and result history.
Validate calibration and fidelity against the actual site when data is available.

The selected foundation is a **modified version of PHYVAC**. Expose public
run/state/action interfaces to the API, agent, and pilot; keep PHYVAC-specific
assembly/stepping in an adapter in `integrations/`. Our module owns scenarios,
the run state machine, simulation time, controller selection, and result history.
PR #2 contains the foundation and recorded engine provenance; it remains separate
from this scaffold checkout. Check [project context](../../../PROJECT_CONTEXT.md)
and the current PR review status before integration.

Use the same validated site revision as the dashboard and telemetry bindings.
Support reproducible comparisons with matched demand, weather, initial state, and
duration. Run lifecycle must not depend on a browser connection. Keep physics,
controller policy, and the pilot's slower reasoning separate. Simulated actions
never implicitly write to physical equipment.

The UI belongs in
[apps/dashboard/src/features/simulation/](../../../apps/dashboard/src/features/simulation/README.md).
Follow that brief for lifecycle controls, result presentation and correction history;
do not put browser code or chart logic in this module. The API composes the public
run interface. This checkout remains a placeholder; store generated runs and customer
parameters outside Git.
