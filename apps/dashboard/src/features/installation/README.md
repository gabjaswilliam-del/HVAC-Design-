# Installation and commissioning UI

**Assignment:** implement `/setup` as the operator-facing part of the future
[standalone installation workflow](../../../../../deployment/dgx-spark/README.md).
The [dashboard](../../../README.md) remains one local application. Status: brief only.

Show backend-recorded progress through preflight, software/model readiness, site
configuration, CAD/topology review, sensor mapping, scene generation, knowledge
ingestion, prediction readiness, validation and activation. Steps show not-started,
running, blocked, failed and complete states with evidence and retry/resume actions.
Never infer completion merely because the user visited a page.

Reuse [CAD Studio](../cad-studio/README.md), [knowledge](../knowledge/README.md),
[PredictionReadiness](../prediction/README.md) and system-health components instead
of rebuilding their forms. Prediction setup explicitly distinguishes adaptation with
history, compatible pretrained fallback without history, and unavailable model.
No LLM fine-tuning controls belong in this commissioning flow.

Separate draft configuration from an activated site revision. Review unresolved
bindings and validation results before requesting activation. The backend owns
durable job state, idempotent/resumable work and activation rules. Browser refresh
must not restart installation, overwrite site data or lose completed steps.

Acceptance: fresh/unconfigured installation, interrupted job/reconnect, missing
artifact, no telemetry history, invalid topology and failed commissioning checks.
Every unavailable action explains its blocker. Activation is shown as successful
only from backend confirmation, then links to monitoring for that revision.
Document what the UI can actually perform and update project context after work.
