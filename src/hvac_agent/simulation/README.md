# Simulation

A shipped, on-demand simulator configured for the site's pump station and cooling
system using CAD-derived topology plus verified equipment and operating parameters.
Own scenario setup, execution, simulated state, action handling, and result history.
Validate calibration and fidelity against the actual site when data is available.

Expose public run/state/action interfaces to the API, agent, and pilot. External
physics engines sit behind adapters in `integrations/`; PHYVAC is a candidate, not
a selected dependency. Simulated actions never implicitly write to physical equipment.

Placeholder only. Store generated runs and customer parameters outside Git.
