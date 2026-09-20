# Standalone DGX Spark deployment

One NVIDIA DGX Spark hosts one data center's installation. Plan local dashboard/API,
agent, telemetry access, model serving, retrieval, forecasting, and on-demand
simulation/pilot operation. No central cloud service, tenant registry, or multi-site
control plane is required by the product.

This directory will own packaging, installation, startup/shutdown, upgrades,
backup/restore, and resource scheduling guidance. The dashboard framework, process
layout, container strategy, GPU dependencies, and model sizes are not chosen yet.
Validate dependencies for the DGX's ARM64 platform. Installation-time asset generation
and model adaptation must be scheduled separately from continuous monitoring.

Project testing uses the owner's DGX Spark account `ghani`. Private connection
details are in ignored local notes when available; never put passwords or customer
addresses here. Test in an isolated directory and virtual environment without
altering an existing deployment. Follow the root README's install/test commands.

Placeholder only; this repository does not yet deploy or run an application.
