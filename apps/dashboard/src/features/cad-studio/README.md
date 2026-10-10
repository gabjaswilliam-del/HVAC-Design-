# CAD Studio UI

**Assignment:** implement `/cad`, also usable as a commissioning step. Read the
[dashboard brief](../../../README.md) and [CAD backend ownership](../../../../../src/hvac_agent/cad/README.md).

Build `CadStudioPage`, `DrawingUpload`, `ExtractionProgress`, `TopologyReview`,
`SceneEditor` and `RevisionReview`. These are planned component names. On desktop,
use an input/evidence panel, a central drawing/scene canvas and a selected-object
inspector. On small screens, turn the panels into tabs; never hide unresolved items.

## Workflow

1. Upload a supported drawing using API-advertised format/size limits. Show filename,
   processing state and failure details. Browser code does not parse proprietary CAD
   or call an image/LLM provider directly.
2. Inspect extracted equipment, stable IDs, ports and connections. Expose source
   evidence and confirmed/drawing/inferred/unknown states. Allow corrections through
   validated backend operations; equipment counts alone do not establish piping.
3. Review missing specifications, sensor bindings and unsupported topology. Link each
   finding to the affected object. Show extraction as a proposal, not commissioned truth.
4. Edit the scene layout independently from physical connectivity. Moving a symbol
   is a presentation edit; changing a pipe/port is a physical configuration edit and
   triggers validation. Keep undo/redo and an unsaved-changes warning.
5. Request local sprite/animation generation as a tracked job. Preview running,
   stopped, fault and unavailable states; incomplete assets have labeled placeholders.
6. Review the change summary and backend validation before committing a new site
   revision. An extraction/job success alone must not activate a physical site model.

## Integration and acceptance

Use the CAD backend through the local API and the agreed scene/topology contracts.
Published scene and simulation bindings reference the same validated site revision.
The monitoring renderer consumes the result; do not duplicate it inside the editor
if a reusable scene renderer can expose a separate editing mode.

Test unsupported input, extraction failure, ambiguous connection, missing parameter,
validation rejection, generation failure, unsaved navigation and revision conflict.
Verify a visual move never changes physics and keyboard/list alternatives cover
canvas objects. No customer drawings/assets in Git. Status: brief only; update this
README and project context with actual supported operations after implementation.
