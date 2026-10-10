# Standalone DGX Spark deployment

The deliverable is an installable standalone product: **one DGX Spark, one data
center, all product services and storage local**. This includes dashboard/API hosting,
LLM/image/embedding serving, CAD generation, RAG, agent memory, databases, prediction,
modified PHYVAC, and the pilot. Installation, model adaptation, and planned training
also target this device. No required cloud API, remote database, or second compute
host is part of the architecture.

Operator browsers and site equipment may connect over the LAN. Installed operation
must work without internet access. Software/model acquisition is a provisioning or
update step, with locally staged artifacts supported. The legacy project's separate
machines and manually configured services are not the product's deployment model.

## Planned installation and commissioning procedure

1. **Preflight the DGX.** Check ARM64 compatibility, operating system, GPU runtime,
   memory, disk capacity, local ports, and access to the site's telemetry network.
2. **Install a versioned release.** Provision application dependencies, local model
   artifacts, embedding/image services, and the pinned modified PHYVAC package.
   Verify artifact versions and integrity. Installation can resume or be rerun
   without overwriting existing site data.
3. **Initialize local storage and configuration.** Establish the single site's
   configuration, private credentials, runtime data paths, and service ownership.
   Separate software releases from persistent site data, models, and backups.
4. **Commission the site model.** Import CAD and equipment specifications, review
   topology and unknowns, map sensor points, and validate units and operating limits.
   Generate the 2D scene and stateful sprites locally, then configure PHYVAC from
   the same approved site revision.
5. **Prepare knowledge and prediction.** Ingest site documentation into local RAG;
   import historical telemetry when available and adapt the prediction model locally.
   Otherwise configure the pretrained fallback and record its limitations.
6. **Validate the integrated installation.** Check equipment bindings, data freshness,
   local model availability, simulation behavior, forecasting, and dashboard/agent
   access. Record unsupported inputs and unresolved calibration issues explicitly.
7. **Activate and hand over.** Start the managed application, configure restart
   behavior, and provide local access and operating guidance. Record the installed
   software/model versions, site revision, and commissioning results.

This sequence describes requirements, not commands that exist today. The installer
must report progress and actionable failures, and clearly distinguish an incomplete
setup from an operational installation.

The operator-facing commissioning flow is specified in
[the installation UI brief](../../apps/dashboard/src/features/installation/README.md),
with ongoing health/maintenance in [the system UI brief](../../apps/dashboard/src/features/system/README.md).
Those screens consume durable local job/readiness state; a browser visit does not
run installation or prove that a step completed. No installer is implemented by
these UI handoffs.

## Product lifecycle and release acceptance

Provide managed startup/shutdown and restart after reboot, local health reporting,
logs, versioned upgrades with recovery/rollback, and backup/restore for site data
and configuration. Installing or upgrading software must preserve the site's state.
Schedule image generation and training/adaptation separately from continuous
monitoring and budget shared GPU/memory capacity explicitly.

Release acceptance includes a fresh installation on DGX, recovery from an interrupted
setup, reboot/restart, backup/restore, and operation with internet access disabled
while local equipment connectivity remains available. The dashboard, harness,
retrieval, forecasts, and simulation/pilot must not require a developer's laptop or
another server to stay running.

Packaging format, process layout, service manager, GPU dependencies, model sizes,
and update distribution remain implementation choices. Make those choices within
the single-device constraint; no container or installer framework is selected yet.

## Development status

Project testing uses the owner's DGX Spark account `ghani`. Private connection
details are in ignored local notes when available; never put passwords or customer
addresses here. Test in an isolated directory and virtual environment without
altering an existing deployment. Follow the root README's install/test commands.

Placeholder only; this repository does not yet deploy or run an application.
