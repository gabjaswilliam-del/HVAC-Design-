# Tests

The moved `test_smoke.py` retains the initial repository's layout check, updated for
the modular structure. Behavioural tests for the site contracts and simulation
foundation are in `core/`, `configs/`, `simulation/` and `integrations/`.

As implementation arrives, put behavioral tests here grouped by module, plus
integration/evaluation coverage where meaningful. Use synthetic, sanitized fixtures;
customer CAD, telemetry, weights, and generated site artifacts stay outside Git.
Pytest's importlib mode permits repeated test basenames in separate subdirectories.

Run project tests on the designated DGX Spark as `ghani` in an isolated environment,
using the commands in the root README. GitHub CI supplies a lightweight additional
check on Python 3.11.

For the UI/prediction assignments, follow each folder's acceptance checklist and
[the integration contract brief](../docs/ui-data-contracts.md). Meaningful coverage
includes source/run/revision isolation, stale or late responses, job idempotency,
missing data, forecast cutoff leakage, and agreement between the monitoring summary
and full forecast page. Keep browser/component tests in the dashboard's eventual
test setup and Python domain/API tests grouped here. No frontend test runner is
selected yet. Fixture screenshots demonstrate UI behavior, not model accuracy or
DGX deployment; record actual integration and execution evidence separately.
