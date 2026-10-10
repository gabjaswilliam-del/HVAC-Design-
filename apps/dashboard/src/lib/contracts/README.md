# Frontend data contracts

**Assignment:** shared schemas/types for features, clients and fixtures. Start with
the [draft contract brief](../../../../../docs/ui-data-contracts.md) and prediction's
[API handoff](../../../../api/routes/prediction/README.md). No endpoints/types exist yet.

Agree wire shapes with backend owners before integration. Generate frontend types
from the canonical backend/wire schema when practical and validate incoming data.
Do not duplicate schemas in features. Python domain objects are not automatically
JSON responses; explicitly serialize origin, IDs, units, quality and timestamps.

Represent operating context, equipment/scene references, readings, issues, jobs,
errors and forecasts. Define nullable fields. Unknown, stale, unsupported and zero
are distinct. UTC timestamps are timezone-aware; UI formatting controls display.
Simulated observations retain run identity and simulation time.

Keep fixture mode separate from observation origin. IDs are stable even if labels
change. An unsupported schema version produces an integration error, not silent
coercion. Acceptance: fixtures validate, malformed payloads fail usefully, and
source/run/revision mismatches cannot populate a screen. Update canonical contracts
and this README when an agreed schema changes.
