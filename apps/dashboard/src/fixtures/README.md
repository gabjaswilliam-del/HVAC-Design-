# Synthetic UI development fixtures

**Assignment:** deterministic development scenarios behind the same interface as
the [real API client](../lib/api/README.md), labeled `Demo data`. No fixtures exist yet.

Provide scenarios for: uncommissioned site, healthy operation, missing/stale sensors,
disconnect, long names/large rosters, missing CAD scene, running/paused/failed
simulation, queued/rejected/superseded corrections, forecast ready/partial/unavailable,
missing pretrained model, adaptation failure, expired forecast, inaccessible document
and unavailable agent tools.

Use stable equipment/scene IDs, fixed UTC times and explicit units/quality. Forecast
fixtures include demand history, future estimates, optional/missing intervals, stale
inputs, and both telemetry/simulation contexts. Include delayed obsolete responses
for context-switch testing. Validate against [shared contracts](../lib/contracts/README.md).

Never copy customer data, prototype implementation/assets/prompts, weights or private
logs. Author a small illustrative schematic locally if artwork is unavailable and
label it as such. Do not depend on remote fonts/images. Fixture actions demonstrate
transitions, not actual inference, equipment commands or installation success.
List scenarios and mode-selection instructions here once built. Production must
never silently use fixtures.
