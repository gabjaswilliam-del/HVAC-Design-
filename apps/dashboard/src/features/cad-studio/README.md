# CAD Studio UI

**Status (2026-10-17): fixture-only Version A UI implemented on `main` as uncommitted
working-tree changes.** `/cad` is a primary dock destination. It accepts a local file
selection but honestly reports that parsing is not connected; the prepared synthetic
sample remains the only reviewable input. No CAD parser, upload API, LLM/image model,
backend validation or site activation is connected.

**Assignment:** implement `/cad` as the installation-time review surface that feeds the
runtime Overview. Read the [dashboard brief](../../../README.md) and
[CAD backend ownership](../../../../../src/hvac_agent/cad/README.md).

The owner removed separate Topology and Review sections on 2026-10-17. Topology remains
domain data, while equipment and connections are shown directly on the drawing. Keep
the canvas dominant; Findings and the selected-object inspector use compact progressive
disclosure rather than three equal permanent columns. Never hide unresolved items on
small screens.

## Workflow

1. Select a drawing. Browser code must not parse proprietary CAD or call an image/LLM
   provider directly. Until the local API exists, retain the selected filename and show
   `Parser not connected`; never imply that the file was uploaded or analyzed.
2. Review a synchronized Drawing/Compare canvas. Drawing shows the high-contrast source;
   Compare places the complete source and extraction in side-by-side canvases at the
   same scene coordinates. Drag the accessible center divider to allocate more space to
   either canvas. Both sides share wheel zoom, drag-to-pan, keyboard pan/zoom and Fit.
   Dragging either canvas pans both and never changes equipment positions.
3. Select equipment to inspect its stable ID and evidence. Highlight related equipment
   and connections directly on the canvas instead of duplicating a connection list in
   the inspector. Equipment evidence confirms identification; it does not resolve a
   separate unknown connection or unconnected-port finding.
4. Review unresolved findings. Selecting a finding opens Compare, smoothly locates the
   affected equipment and emphasizes the exact link. The complete equipment artwork is
   tinted by aggregate recognition state: conflict, unknown, needs review or confirmed.
   A compact text legend keeps color from being the only status signal. An unconnected
   port finding offers compatible fixture candidates in the inspector; applying one
   creates a confirmed draft link and removes that finding.
5. Preview the reviewed draft in the shared runtime `PlantViewport`. The preview is
   explicitly marked `CAD draft` and `not validated or commissioned`; it demonstrates
   the intended handoff to Overview without publishing or activating a site revision.
   Because no telemetry source exists, design preview mode hides operational readings
   and state tags instead of filling the scene with misleading `Unavailable` labels.
6. Future commissioning validates the revision, parameters, sensor bindings and assets
   before activation. Extraction/job success alone must never activate a physical site
   model.

Layout editing is deferred until a real revision, persistence and validation workflow
exists. Do not expose drag, coordinate, direction or undo controls that cannot produce
a durable result. Local sprite/animation generation is also future backend work.

## Integration and acceptance

Use the CAD backend through the local API and agreed scene/topology contracts. Published
scene and simulation bindings must reference the same validated site revision. Runtime
monitoring consumes the result through the shared renderer; do not fork a second scene
implementation inside CAD Studio.

Test unsupported input, extraction failure, ambiguous connection, missing parameter,
validation rejection, generation failure and revision conflict as those operations are
introduced. Keyboard alternatives must cover canvas navigation and the comparison
   canvases. No customer drawings or generated assets belong in Git.

## Implemented fixture scope

- The import surface has a real local file picker/drop target, but deliberately stops
  at `Parser not connected`. `Water-cooled plant` starts the prepared fixture flow.
- The studio has only Drawing and Compare. Compare shows complete source and extraction
  canvases side by side with identical scene coordinates and one shared view transform;
  a mouse-, touch- and keyboard-operable divider adjusts their relative widths from
  25% to 75% without turning the comparison into a clipped wipe.
- Pointer-centered wheel zoom, drag-to-pan, arrow-key pan, keyboard zoom and Fit share
  one view transform across source and extraction.
- Selecting equipment highlights connections on-canvas. Selecting a finding smoothly
  locates its equipment and affected link. The inspector contains object/evidence
  details, not a connection list. Long IDs, endpoints and notes wrap within the compact
  panel without horizontal scrolling. The prepared unconnected-port finding can be
  resolved by choosing a compatible chiller outlet and creating a fixture-only link.
- Recognition state colors tint the whole equipment illustration and are explained by
  a persistent text legend. Evidence dots were removed.
- `Preview in Overview` reuses `PlantViewport` and carries an explicit uncommissioned
  draft disclosure. Its inspector reports the selected device's own evidence rather
  than the aggregate CAD connection-review state. It does not persist, validate or
  activate anything.
- Browser refresh discards all fixture edits.
- Windows validation: TypeScript, focused Vitest, demo build and two focused Playwright
  scenarios using installed Chrome at desktop and 390 px, including an axe
  serious/critical check. DGX validation has not been run.
