# CAD Studio UI

**Status: M0–M3b implemented in the working tree, awaiting visual approval before M4.**
`/cad` is a primary dock destination. The prepared synthetic sample remains the only
reviewable input. Uploaded DWG/DXF files are stored and downloadable, but are not parsed,
rendered or extracted. No CAD parser, LLM/image model or site activation is connected.

Read the [dashboard brief](../../../README.md) and
[CAD backend ownership](../../../../../src/hvac_agent/cad/README.md). Keep the canvas
dominant and unresolved findings accessible on small screens. Do not turn layout editing,
validation or activation into implied capabilities.

## Workflow

1. Select or drop one or more drawings. The first file opens and the batch remains in the
   Project Library. Local files show `No extraction`; browser code must not parse
   proprietary CAD or call an image/LLM provider directly.
2. Review the synchronized Drawing/Compare canvas. Compare places source and extraction
   side by side at the same scene coordinates. Its accessible divider allocates 25–75% to
   either canvas. Both sides share wheel zoom, drag-to-pan, keyboard pan/zoom and Fit.
3. Choose the schematic 3D view for the complete prepared plant: four cooling towers,
   three chillers, four CW pumps, four CHW pumps and the lumped data hall. All 31 recorded
   branch connections, four headers, two bypasses, 13 valves and seven sensors are present.
   Standby pumps are labelled. Select equipment or a branch to inspect its stable ID,
   evidence and connections. Left-drag orbits through 360 degrees, right- or middle-drag
   pans, and the wheel zooms. Shift+arrow keys orbit and plain arrows pan. A short click
   selects equipment; a drag beyond the pointer threshold moves the camera instead. The
   canvas shows Grab/Grabbing cursors. Fit, Reset isometric and Plan are also available,
   including keyboard and existing touch input.
4. Trace follows the selected item's recorded paths without using an unknown connection to
   establish a route beyond its recorded endpoints. Related geometry stays visible,
   unrelated geometry dims, and equipment with open findings never dims. Layers control
   CW, CHW, valves, instruments and names; Colour by Medium and Colour by Review are
   distinct modes. Equipment labels and short leaders project and declutter in the same
   render frame as the camera, using direct DOM updates rather than delayed CSS movement.
5. Review unresolved findings. Selecting a finding focuses the equipment in 3D, or opens
   Compare from another view, and emphasizes the exact link. Equipment artwork carries the
   existing review states with a text legend. An unconnected-port finding offers compatible
   fixture candidates; applying one creates a confirmed draft link and removes that finding.
6. Preview the reviewed draft in the shared runtime `PlantViewport`. The preview is marked
   `CAD draft` and `not validated or commissioned`; it does not publish or activate a site
   revision and does not invent telemetry.
7. Future commissioning validates the revision, parameters, sensor bindings and assets
   before activation. Extraction/job success alone must never activate a physical site
   model.

## Architecture and persistence

- CAD Studio is lazy-loaded. Its session survives navigation without keeping a hidden CAD
  canvas mounted; Overview SVG definitions do not collide with the CAD scene.
- Demo mode keeps files and edits in the current tab only. Refresh discards them.
- `cad=local` uses the local WSGI project service. Metadata and saved state live in SQLite;
  original drawings live byte-for-byte on disk outside the repository. `--cad-dir` and
  `HVAC_CAD_DIR` override the storage location.
- Save, Save As, Reopen, Rename, Duplicate, Delete, Revert and revision-conflict handling
  are implemented. Original downloads preserve the exact bytes and filename.
- The saved workspace includes review topology, selection, current view, 2D viewport,
  Compare split, layer visibility and colour mode. The 3D camera is not persisted before
  M4; a saved model view safely reopens in 2D until then.

## M3b rendering boundary

- Plain Three.js in a lazy `Plant3DCanvas` chunk; no new rendering dependency.
- Orthographic isometric Corner B, neutral painted steel, the four existing pipe-media
  colours, an engineering floor grid and contact shadows only under equipment.
- Equipment geometry and pipe levels are schematic conventions derived from the prepared
  sample's topology and 2D positions. They are not engineering dimensions or scale. The
  data hall's illustrative rack groups remain one lumped load, not independent equipment.
- Selection is shared with the Inspector and the 2D views. Selection silhouettes, recorded
  paths and finding emphasis preserve their separate meanings. Review colours never
  introduce a Conflict or critical-alarm state.
- Equipment labels remain keyboard-operable. Camera matrices are updated before each render
  and label projection. Labels and leaders project and declutter in that same frame using
  direct DOM transforms, with lower-priority names dropped when space is limited. No delayed
  timer, CSS transition or per-frame React state update is used.
- The camera allows continuous horizontal orbit, floor-safe elevation, bounded pan and
  bounded zoom. Fit centres all projected mesh and visible-label bounds, including the data
  hall and outermost pipes, with breathing room. Choosing an active preset repeats its action.
- The renderer draws on change, not continuously while idle, and disposes its geometries,
  materials, textures, render targets and WebGL context. WebGL2 unavailability, renderer
  failure and context loss fall back to the 2D drawing without taking down the CAD page.
- 3D camera persistence, URL/workspace completion and project package export/import remain
  M4/M5 work, not part of this approval gate.

## Integration and acceptance

Use the CAD backend through the local API and agreed scene/topology contracts. Published
scene and simulation bindings must reference the same validated site revision. Runtime
monitoring consumes the result through the shared renderer; do not fork a second scene
implementation inside CAD Studio. Layout editing, generated sprites/animations and site
activation remain future work. No customer drawings or generated assets belong in Git.

## Current validation

- TypeScript passes across the dashboard.
- 245 Vitest tests pass in 29 files, including complete topology/equipment mapping, pipe
  routing, camera bounds, trace behavior, label placement, fitting and session coverage.
- The complete `unittest` discovery run passes 91 tests, including the 28 CAD backend tests.
- 23 CAD Playwright tests pass, covering local project persistence, Overview collisions,
  2D/3D/Compare selection, centered Fit, left-drag orbit at 1440×900 and 1920×1080,
  right/middle pan, wheel zoom, click/drag separation, frame-synchronized labels, camera
  bounds, trace, findings, layers, colour modes, WebGL2 absence, context loss/recreation,
  existing touch behavior and axe serious/critical checks.
- Production and demo builds pass. The production-optimized demo bundle's complete-scene
  software measurements and screenshots are recorded in `VERSION_A.md`; they are not
  hardware-GPU results. Real-GPU and DGX validation have not been completed.
