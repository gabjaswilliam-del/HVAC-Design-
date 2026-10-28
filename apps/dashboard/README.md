# Dashboard — start here for the UI implementation

This is the junior-engineer handoff for the operator application. **Status: the
owner approved React 19 + TypeScript + Vite on 2026-10-04 for the Version A fixture
prototype. Milestones 0 to 7.6 are in this directory: shell, artwork, fixture data
layer, interactive monitoring with KPI details, cooling prediction and equipment pages,
scripted AI assistant, simulation and AI pilot on labelled mock services, and the
knowledge workspace. Everything runs on labelled demo data except the knowledge
workspace, which can use the local knowledge and memory service in
`apps/api/local_server.py`; nothing else is connected to a backend. CAD Studio
(`/cad`, 2026-10-17) is a fixture-only review interface with no CAD parser or
backend.** Milestones and acceptance evidence: [VERSION_A.md](VERSION_A.md). See
[Running the prototype](#running-the-version-a-prototype).
Implement your assigned surface in the folder linked below. Build one coherent
application, not separate dashboards per feature.

Read [project context](../../PROJECT_CONTEXT.md), [product scope](../../PRODUCT.md),
[architecture](../../docs/architecture.md), and the
[shared data contract brief](../../docs/ui-data-contracts.md) first. The simulation
foundation from PR #2 is merged on `main`; read [docs/simulation.md](../../docs/simulation.md)
for its supported topology and limits before integrating. Its Python objects are not
a published HTTP API. Other backends are placeholders.

## User and design direction

The user is a data-center operator monitoring one installed cooling plant, checking
a fault, or comparing a forecast with current demand. The first screen must answer:
what is happening, where, how fresh is the evidence, and what needs attention?

Use a restrained operational interface: an equipment scene as the focal area,
legible values with units, compact controls, aligned tables, and predictable panels.
Use one shared type scale, spacing scale, icon style and semantic color vocabulary.
Reserve strong color for selection, actions and meaningful states. Avoid decorative
gradients, oversized marketing headings, excessive cards, and animation unrelated
to equipment state. Exact brand colors/fonts are not prescribed; establish the
shared tokens once rather than inventing a theme in each feature.

Build desktop-first for an operator workstation, then adapt to narrower browsers.
At 1440×900, navigation and the operating context remain visible, the scene owns
most of the monitoring workspace, and forecast/issue summaries are easy to scan.
At 1024px, panels stack or collapse; at 390px, use drawers/tabs and a useful equipment
list instead of squeezing the diagram. The route stays usable at 200% text zoom.

## Where each part goes

All paths below are relative to `apps/dashboard/`. These folders contain the briefs
and are the intended source locations. Framework-specific route files should be thin
wrappers around these feature modules; do not create a second copy of a feature.

| Folder / README | Assignment | Proposed route / placement |
|---|---|---|
| [src/app/](src/app/README.md) | Application shell, navigation, context and routing | Wraps every route |
| [src/features/monitoring/](src/features/monitoring/README.md) | Animated 2D plant and current readings | `/` — default first screen |
| [src/features/equipment/](src/features/equipment/README.md) | Reusable detail inspector and equipment records | `/equipment/:id`; `/equipment` redirects to Engineering; drawer from scene/chat/pilot |
| [src/features/display/](src/features/display/README.md) | The AI display: what the assistant shows (`show_on_display`) | The Overview's second view (`/?view=display`) |
| [src/features/cad-studio/](src/features/cad-studio/README.md) | Drawing review, topology correction and scene editing | `/cad` |
| [src/features/agent/](src/features/agent/README.md) | Conversation, tools, citations and generated data views | `/agent`; contextual drawer |
| [src/features/simulation/](src/features/simulation/README.md) | Scenario setup, lifecycle and results | `/simulation` |
| [src/features/prediction/](src/features/prediction/README.md) | Cooling-load forecast page and summary panel | `/prediction`; embedded on `/` |
| [src/features/pilot/](src/features/pilot/README.md) | Simulation issues, investigations, corrections and outcomes | `/pilot`; issue links on monitoring |
| [src/features/knowledge/](src/features/knowledge/README.md) | Documents, ingestion state and source reading | `/knowledge` |
| [src/features/installation/](src/features/installation/README.md) | Commissioning steps and readiness | `/setup` |
| [src/features/system/](src/features/system/README.md) | Local health, versions, configuration and maintenance | `/system` |
| [src/components/](src/components/README.md) | Shared accessible controls, charts and status patterns | Reused across features |
| [src/styles/](src/styles/README.md) | Shared visual tokens and global styles | One visual vocabulary |
| [src/lib/api/](src/lib/api/README.md) | Local API client, subscriptions and error handling | All network traffic |
| [src/lib/contracts/](src/lib/contracts/README.md) | Boundary schemas/types and validation | Matches agreed backend contracts |
| [src/fixtures/](src/fixtures/README.md) | Deterministic synthetic UI scenarios | Explicit fixture mode only |

## Main screen composition and prediction connection

```text
Header: installed site label | Live telemetry / Simulation run | time | freshness
Navigation      Monitoring workspace
                Current readings and active issue count
                Animated 2D plant                 Equipment inspector (on selection)
                CoolingForecastSummary            Recent issues / investigation links
```

`CoolingForecastSummary` is owned by `features/prediction/`, imported by monitoring,
and linked to the full `/prediction` page. Both use one forecast data controller
keyed by source, run, site revision, input cutoff, horizon and timestep. Do not build
a second forecasting chart or generate forecast numbers inside monitoring.
The [prediction brief](src/features/prediction/README.md) specifies this connection.

## Shared behavior requirements

- Display **Live telemetry**, **Simulation** or **Demo data** unmistakably. Fixture
  mode is an application data mode, never a pretend real sensor source. For
  simulations display run ID/name and simulated time. A site label is not a site selector.
- Keep source/run/revision/selected-equipment context consistent across screens.
  Cancel or discard responses for obsolete context. Changing route or redrawing
  a chart must not step a simulation or rerun a model.
- Show value, unit, sample time and quality. Missing is `Unavailable`, never zero.
  Retained stale readings show their age and no longer animate as live equipment.
- Implement loading, empty/unconfigured, ready, partial, stale, disconnected,
  permission-denied and failed states where relevant. Provide an actionable retry
  or next step without discarding useful context.
- Use keyboard-operable navigation, visible focus, semantic headings/labels, and
  WCAG 2.2 AA contrast. State must use text/icons as well as color. Charts and canvas
  scenes need a table/list equivalent; respect reduced motion.
- Render supplied equipment IDs and counts; do not hard-code two chillers. Scene
  coordinates are presentation and must never become the authoritative topology.
- Browser code calls only the local API. Models, physics, storage and equipment
  adapters run on the DGX. Bundle fonts/icons/assets for offline operation.
- Simulated controls must name the target run. Do not add real equipment start/stop
  or setpoint write controls. Do not present a button as working without backend support.

## Implementation order and collaboration

1. The shell/API owners establish one frontend framework/build setup and record it
   here with working DGX build/run instructions. No framework is selected by this
   handoff. Keep source ownership above even if route conventions differ.
2. Agree the draft contracts with the API owner; create shared types, deterministic
   fixtures, tokens, controls and the shell. Clearly label fixture demonstrations.
3. Implement monitoring and the equipment inspector, then the forecast summary/page.
   Other engineers can implement assigned features against the same fixtures/contracts.
4. Connect capabilities to real local endpoints as they exist. A fixture demo and a
   functioning integration are separate acceptance milestones. Never silently fall
   back to mock success when a backend fails.
5. Exercise cross-feature workflows, offline behavior and responsive/accessibility
   states. Record remaining unsupported integrations instead of claiming completion.

## Definition of done for each UI assignment

- The feature lives in its assigned folder and composes shared controls/tokens.
- The happy path and relevant error/stale/empty states work with deterministic data.
- Selection, navigation and source/run context survive the documented interactions.
- Accessible labels/focus, reduced motion, chart/table equivalents and narrow layouts
  are checked; no decorative animation masks stale or missing data.
- Tests cover meaningful behavior such as stale responses, routing and state
  transitions. Add screenshots for primary and failure states to the PR, identify
  fixture vs live API coverage, and record DGX build/interaction validation.
- Update the feature README with implemented components, real run commands,
  integration status and remaining work; update [PROJECT_CONTEXT.md](../../PROJECT_CONTEXT.md).

Do not replace this brief with a generated framework README. Preserve requirements
and add setup instructions once commands actually exist.

## Running the Version A prototype

Requires Node 20.19+ or 22.12+. From `apps/dashboard/`:

```sh
npm install
npm run demo        # dev server in explicit demo-data mode, http://localhost:5173
npm run build       # typecheck + production build; without demo mode it shows "Local API not connected"
npx playwright install chromium   # once, for browser tests
npm run e2e         # browser tests (starts the demo server)
```

### Local Chinese CAD development

The tracked product interface remains English. For local CAD Studio development,
open `http://localhost:5173/cad?lang=zh`; an ignored
`src/lib/i18n/zh.local.ts` overlay supplies the Chinese CAD text and falls back to
`src/lib/i18n/en.ts` for any untranslated key. Add every new product string to the
tracked English `cad` catalog first, then add its optional Chinese translation to
the local overlay. The overlay is excluded by `.gitignore`, so there is no language
file to swap or restore before committing. Other dashboard features remain English
unless their keys are deliberately added to the local overlay.

`/asset-sheet.html` (dev server only) is the equipment artwork review page. Runtime
dependencies: `react`, `react-dom`, `react-router`, `zod`, `lucide-react` and the
locally bundled `@fontsource/barlow-semi-condensed`; no chart/UI/state libraries.
All data is synthetic (`src/fixtures/`), labeled `Demo data`, and never a fallback
for a failed backend. Validated on a Windows workstation only; DGX build and test
validation is still outstanding.
