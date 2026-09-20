# Integrations

Adapters for external systems: BMS/telemetry sources, local LLM and image-model
servers, storage and retrieval backends, CAD libraries, and the modified PHYVAC engine.
Implement interfaces owned by the consuming feature module or shared in `core/`.

The application composition layer supplies these adapters to modules. Keep protocol,
SDK, transport, and device details here; keep workflows and domain decisions in
their owning modules. Add provider-specific subpackages only when a provider is
chosen. All product model services, storage backends, and the simulation engine
must run locally on the DGX Spark. External site equipment connects over the LAN;
required remote compute/database services and cloud fallback are outside this design.

PHYVAC is selected; its fork and revision are not yet pinned. Keep the future
engine adapter here and the maintained engine changes traceable to upstream.
Do not copy the reference prototype's remote replay client as the simulation design.

Placeholder only. No credentials, model weights, third-party engines, or physical
control implementation belong in this scaffold.
