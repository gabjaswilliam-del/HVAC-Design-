# Tests

The moved `test_smoke.py` retains the initial repository's layout check, updated for
the modular structure. It is a placeholder, not a test of product capabilities.

As implementation arrives, put behavioral tests here grouped by module, plus
integration/evaluation coverage where meaningful. Use synthetic, sanitized fixtures;
customer CAD, telemetry, weights, and generated site artifacts stay outside Git.
Pytest's importlib mode permits repeated test basenames in separate subdirectories.

Run project tests on the designated DGX Spark as `ghani` in an isolated environment,
using the commands in the root README. GitHub CI supplies a lightweight additional
check on Python 3.11.
