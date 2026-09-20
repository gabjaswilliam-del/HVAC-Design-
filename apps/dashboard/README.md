# Dashboard

The operator-facing application for one data center. Its primary monitoring screen
renders the CAD-derived 2D scene with generated sprites/animations and live state.
Additional views expose conversations, cooling forecasts, simulation controls and
results, and AI pilot events and corrections.

Consume the local API in `../api/`; keep model calls, physics, telemetry adapters,
and equipment operations in backend modules. Clearly distinguish simulated state
from real telemetry. Generated customer scenes and assets live in ignored runtime
storage, not here.

Placeholder only. No frontend framework, UI, or package manifest is selected yet.
