# CAD Studio

UI implementation belongs in
[apps/dashboard/src/features/cad-studio/](../../../apps/dashboard/src/features/cad-studio/README.md),
with commissioning composition in the installation feature. That brief places
equipment connections directly on the review canvas and keeps only object/evidence
details in the contextual inspector, rather than adding a separate topology section.
Its fixture Compare view uses synchronized, side-by-side source and extraction canvases
and previews the result through the shared Overview renderer; neither action validates
or activates a revision.
Revision validation and activation remain commissioning responsibilities.
This backend module owns analysis/generation; it does not host UI code.

Installation-time CAD analysis and scene generation. Turn a customer drawing into
a 2D design scene and machine-readable equipment topology, with shared equipment
identifiers. Coordinate image-model adapters to generate sprites and animation
assets for the dashboard's primary monitoring screen.

Topology plus verified equipment parameters and sensor mappings configure the
simulator and inform forecasting. Surface missing parameters for installation-time
completion; do not infer physical fidelity from geometry alone. Scene generation
belongs here; live rendering belongs in `apps/dashboard/`.

Preserve a semantic design/site definition independently of the rendering format.
Separate physical connections from visual placement, retain source evidence and
unresolved findings, and validate structure after edits. Equipment counts alone do
not establish actual pipe topology. Generate presentation artifacts and modified
PHYVAC configuration from the same validated site revision. Generated artwork must
retain meaningful running, stopped, fault, and unavailable-state indications.

Placeholder only. CAD inputs and generated customer scenes/assets remain in ignored
runtime storage. Formats and model providers are not chosen yet.
