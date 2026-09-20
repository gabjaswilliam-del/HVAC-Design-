# Integrations

Adapters for external systems: BMS/telemetry sources, local LLM and image-model
servers, storage and retrieval backends, CAD libraries, and the modified PHYVAC engine.
Implement interfaces owned by the consuming feature module or shared in `core/`.

The application composition layer supplies these adapters to modules. Keep protocol,
SDK, transport, and device details here; keep workflows and domain decisions in
their owning modules. Add provider-specific subpackages only when a provider is
chosen. Default runtime design targets local operation on the DGX Spark.

PHYVAC is selected; its fork and revision are not yet pinned. Keep the future
engine adapter here and the maintained engine changes traceable to upstream.
Do not copy the reference prototype's remote replay client as the simulation design.

Placeholder only. No credentials, model weights, third-party engines, or physical
control implementation belong in this scaffold.
