# Equipment list and detail inspector

**Assignment:** own `/equipment` and reusable `EquipmentInspector`. Read the
[shared UI brief](../../../README.md). The inspector is used by monitoring, agent,
simulation and pilot; there must not be four independent detail implementations.

Build a searchable/filterable roster and a side drawer with equipment label, ID,
type, running/fault/data-quality states, latest readings with units/times, a trend
view, connected equipment, evidence and related issues. Show requested setpoints
separately from achieved feedback. Keep observed equipment behavior separate from
nameplate ratings and inferred values.

Public inputs: equipment ID, source/run, site revision and time range. Public
events: select related equipment, locate on scene, ask the agent, open an issue.
Resolve data through the shared API client. Preserve context in every link; an
equipment ID missing from a new site revision produces an explanatory state.

Offer "Ask about this equipment" with explicit device/time/source context. Link
to the site-level cooling forecast, labeled as site-wide. Do not divide total
forecast demand among devices to fabricate individual predictions. Equipment-specific
forecasting is unavailable until a separate model/contract supports it.

Do not expose physical start/stop or setpoint writes. If simulation corrections are
exposed, use the simulation feature's public command flow with a visible target run,
limits and backend outcome; do not add a second command implementation here.

Acceptance: long labels, large rosters, missing sensors, mixed units, stale data,
stopped devices, unknown IDs, inspector keyboard/focus handling and cross-screen
selection. History gaps stay visible. Update implementation/API status in this
README and project context after work. Status (2026-10-04): `EquipmentInspector`
and the `/equipment/:id?` page are implemented in the Version A fixture prototype.
No live API integration. Details: [VERSION_A.md](../../../VERSION_A.md).
