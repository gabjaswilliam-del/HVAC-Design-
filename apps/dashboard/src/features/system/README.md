# Local system status and maintenance UI

**Assignment:** implement `/system` for one DGX installation. Read the
[dashboard standards](../../../README.md) and [deployment requirements](../../../../../deployment/dgx-spark/README.md).

Present local API/model/telemetry/simulation availability, software/model/config
versions, storage/resource status when supplied, and actionable health failures.
Distinguish "not installed", "starting", "ready", "degraded" and "unreachable";
an unreachable API cannot truthfully report all other services healthy.

Show installed-site settings and backend-supported maintenance jobs (backup/restore,
upgrade/recovery) with progress and last results. These are future capabilities;
render unsupported actions as unavailable, never shell commands disguised as UI.
Any later destructive operation needs a clear target/impact review and backend
authorization. Do not add site/fleet/tenant management or expose saved secrets.

Use safe configuration summaries and bounded operational logs, with sensitive values
redacted by the server. No arbitrary command execution, direct host password forms
or browser-to-service administrative connections. The API owns lifecycle operations.

Acceptance: partial health, expired health snapshot, disconnected DGX, unavailable
model artifact and failed maintenance job. A status screen does not imply an installer
exists. Update this README/project context with real operations and DGX verification.
Current status: brief only.
