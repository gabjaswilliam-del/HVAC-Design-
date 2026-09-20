# Local API and application composition

Application entry points for the single DGX Spark installation. This layer will
load the site's configuration, wire backend modules to adapters, manage their
lifecycle, and expose dashboard-facing requests and state updates.

Reusable capabilities live in `src/hvac_agent/`. API handlers call public module
interfaces; the composition layer supplies telemetry/model/storage/engine adapters.
Keep CAD processing, forecasting, training, simulation, and pilot policy out of
transport handlers. Model real telemetry and simulation sessions explicitly.

Placeholder only. Transport, authentication, process layout, and server framework
remain undecided; no endpoints or server are implemented.
