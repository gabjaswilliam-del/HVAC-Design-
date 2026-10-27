# Version A prototype: milestones and acceptance

"Industrial Control Center" fixture prototype, authorized by the owner on
2026-10-04 within `apps/dashboard/` only. All data is synthetic; nothing connects to
PHYVAC, models or equipment. Since M7 the Knowledge workspace alone can use a real local
service, when the address asks for it (`?knowledge=local`). Version C is a separate, later
exercise.

| Milestone | Scope | Status |
|---|---|---|
| M0 | Vite/React/TS setup, tokens, shell, routes | Done, commit `4376230` |
| M1 | Equipment artwork, asset sheet, static scene preview | Done; artwork and style approved by owner |
| M2 | Contracts, deterministic scenarios, fixture client, operating context | Done; awaiting owner review with M3 |
| M3 | Interactive monitoring: fit/zoom/pan, selection, inspector, playback, KPIs, forecast summary, issues, list view | Done; reviewed by owner |
| M3.1 | Interactive KPI cards and indicator details panel (owner request) | Done |
| M4 | Cooling prediction page, Equipment screen | Done |
| M5 | AI assistant page and drawer (scripted demonstration) | Done; **owner review gate closed 2026-10-05 (F10)** |
| R1–R2 | Redesign phases 1–2: design system, navigation, header, permanent workspace, Overview | Done; superseded by Treatment A; included in the 2026-10-06 checkpoint commit |
| TA | Treatment A, Graphite (machined bezel): v2 Phase 2 refinement, decisions F1–F9 | Done; **local checkpoint commit 2026-10-06** (with the Assistant refinement), not pushed |
| M6 | Simulation, AI pilot (their mock services move here from M2) | Built on labelled mock services, 2026-10-06; consolidated revision, the AI Pilot console revision and the live operator and recorded replay correction, 2026-10-07; committed by the owner in `cd94b78` (2026-10-10). The Assistant reads simulations and points to operator controls; it has no control or action tools (F10) |
| M7 | Knowledge workspace: Graph RAG and Graph Memory, with a local knowledge and memory service (Python standard library, SQLite) | Built 2026-10-08/09 at the owner's request; committed by the owner in `cd94b78` (2026-10-10) |
| M7.1 | The knowledge graph in 3D (react-force-graph-3d), with the 2D view kept | Built 2026-10-09 at the owner's request; committed by the owner in `cd94b78` (2026-10-10) |
| M7.2 | The 3D knowledge graph as planetary systems: one per document, spacious, with group focus | Built 2026-10-16 at the owner's request; uncommitted, awaiting the owner's review |
| — | CAD Studio fixture UI; Installation and System | CAD Studio built 2026-10-17 as uncommitted fixture-only UI; separate Topology/Review sections removed by owner decision. Side-by-side Drawing/Compare canvases with synchronized pan/zoom and an accessible draggable divider, upload placeholder, smooth finding location, whole-equipment review colors, on-canvas connection highlighting, compact evidence inspector, actionable fixture port resolution, persistent Findings and a draft Overview preview are implemented; Installation and System planned |
| M8 | Hardening, full test suite, DGX validation, documentation | Planned |

## M2: data foundation

- `src/lib/contracts/`: zod boundary schemas for topology, scene manifest, readings
  snapshot, history, issues and the cooling-load forecast. The forecast schema enforces
  the grid rules in `docs/ui-data-contracts.md` (as_of + step … as_of + horizon, no
  nowcast, ordered intervals, unavailable results carry a reason and no series).
- `src/fixtures/`: the synthetic demo plant (3 chillers, 4 towers, 4 + 4 pumps,
  PR #2-style evidence), seven deterministic scenarios (normal, afternoon peak, tower
  fan fault, CHW pump trip, missing/stale sensors, telemetry disconnected, scene
  revision mismatch) and documented fixture arithmetic (not physics, not PHYVAC).
- Forecast fixture: a seasonal-profile **baseline** that only reads demand at or before
  its cutoff (unit-tested by tampering with future demand). It is labeled as a demo
  baseline, never as the pretrained or site-adapted model; its spread is uncalibrated.
- `src/lib/api/`: the `DataClient` interface, boundary validation and `useResource`
  (cancellation, obsolete-response discard, same-context data retention).
- `src/fixtures/fixtureClient.ts`: the explicit demo adapter with latency, abort,
  JSON round-trip and failure injection (`?fail=snapshot:timeout` etc.).
- `src/app/operatingContext.ts`: scenario, demo clock (live / replay), selection.
  URL parameters for demos and tests: `?scenario=`, `?time=HH:MM`, `?equipment=`.

## Milestone 3 acceptance (owner requirements, 2026-10-04)

| # | Requirement | Implementation | Automated check (`e2e/monitoring.spec.ts`) |
|---|---|---|---|
| 1 | Whole plant visible on open (fit to screen) | Viewport fits on first size and refits on resize while in fit mode | Every equipment artwork inside the viewport, viewport inside the window |
| 2 | Zoom in, Zoom out, 100%, Fit to screen | Toolbar above the schematic; the % button sets 100% | Zoom factors and fit restore |
| 3 | Wheel zoom at pointer; drag to pan | Pointer-anchored zoom (Ctrl+wheel for trackpad pinch); 4 px drag threshold; a drag never selects | Equipment under the pointer stays within 3 px; drag offset matches |
| 4 | Every item individually clickable | Each node is a keyboard-operable button; its readings also select it | All 16 items clicked, inspector names each |
| 5 | Highlight selection and connected pipes; inspector with status, measurements, connections, issues | Connected links/headers glow, neighbours stay bright, the rest dims | Active links, related nodes, inspector sections, connection navigation |
| 6 | Inspector never crops the schematic | Inspector is a grid column; the viewport refits when its box changes (or keeps its centre after manual zoom) | Refit on open/close; Fit recovers after manual zoom; focus returns |
| 7 | Detailed illustrations preserved | Same M1 sprites; no simplified icons | Sprite counts and element detail per drawing |
| 8 | Several desktop resolutions; all equipment reachable | Pan clamped so the plant cannot be lost | Fit at 1280×720, 1366×768, 1440×900, 1920×1080, 2560×1440; at 2× zoom every item panned to and clicked |

Also covered: keyboard zoom/pan/selection with Escape and focus return, deep links and
unknown IDs, Locate on plant, playback and scenario changes, disconnected telemetry,
scene revision mismatch fallback, a retryable readings failure, forecast summary
identity and link, narrow-screen list and full-screen inspector, and axe checks.

Known limits: touch pinch-zoom is not implemented (buttons and Ctrl+wheel work);
"Live demo" advances the demo clock in real time, so readings change every 5 minutes;
the AI assistant panel (requirement 6, later part) arrives in M5.

## M3.1: interactive KPI cards (owner request, 2026-10-04)

All nine KPI cards are buttons. Each opens an **indicator details panel** in the same
right-hand column as the equipment inspector (one side panel at a time), so schematic
fit/zoom, replay and scenario switching behave exactly as with the inspector.
`?kpi=<key>` deep-links a panel.

- Every panel: a "synthetic scenario value" notice, what the indicator shows, how it
  is derived (with its reported inputs, never recalculated in the browser), current
  measurements, nameplate design references where relevant, data quality (stale and
  unavailable inputs listed, never filled in), today's trend, and related equipment
  with **Locate** (centres it on the plant) and **Inspect** (opens the equipment
  inspector). Related equipment is highlighted on the plant while the panel is open.
- **Open issues**: the scenario's issues at the playback time with severity, status,
  ID, first/last seen, the scenario's own description (labeled synthetic), affected
  equipment with actions and supporting readings with quality. Resolved issues are
  listed separately. No recommendations are generated.
- **Cooling demand / delivered**: a demand-vs-delivered chart with running chiller
  capacity, the current shortfall and today's shortfall periods derived from the
  reported unmet-demand series. Running capacity is a backend-reported metric
  (`plant:available_capacity_kw`: rated capacity of running chillers), not installed
  capacity and not an overload prediction.
- **Plant electrical power** lists each machine's contribution, largest first.

Fixed while testing: on a cold page load the viewport could miss its first
ResizeObserver notification and leave the schematic undrawn; it now measures itself
synchronously on mount.

Tests: `e2e/kpi.spec.ts` (16 tests: every card, Escape/focus return, toggling and
refit, indicator content, issues with evidence and actions, empty state, shortfall
and replay consistency, scenario changes, stale/missing inputs, panel/inspector
exclusivity, keyboard, 1024×768 / 1280×720 / 1920×1080 fits, 390 px, axe) and
`src/features/monitoring/kpi.test.ts`.

## M4: Cooling prediction and Equipment pages (2026-10-04)

**Cooling prediction** (`/prediction`, `features/prediction/PredictionPage.tsx`):
context bar (source, site revision, data cutoff, forecast ID); horizon and interval
offered only from backend-advertised capabilities; 24 h / 7 day history; chart of
observed demand, predicted demand (dashed) with its uncalibrated spread, and optional
delivered cooling and running chiller capacity (history only; future capacity is not
forecast); a figures panel that keeps **predicted peak demand**, **running capacity**
and **cooling delivered** as separate, labeled quantities, each linking to its
existing monitoring KPI panel instead of duplicating it; full provenance; forecasting
readiness (baseline available; pretrained and site-adapted unavailable, with reasons);
and a visual comparison of an earlier forecast with what was later observed, with no
accuracy metric. `?forecast=<id>` pins the exact forecast linked from the monitoring
summary (same ID, peak and horizon); unknown IDs say so. States: insufficient history
(`new-site` scenario), stale and too-stale inputs (`disconnected`), request failure
with retry. The page states that the baseline is a demonstration method, not a trained
or validated AI model.

**Equipment** (`/equipment/:id?`, `features/equipment/EquipmentPage.tsx`): roster
with search, type, state and open-issue filters, state counts, open issues and
topology evidence per item, the shared `EquipmentInspector`, deep links, "Locate on
plant" (opens monitoring with the item selected and centred), selection shared with
monitoring, and replay.

Shared data only: both pages use the same `DataClient`, snapshot, issues,
`ForecastDataController` cache and playback clock as monitoring. Added data: forecast
capabilities, forecast lookup by ID, backend-reported running capacity, and a
`new-site` scenario. Fixed: day-boundary step in synthetic demand; negative axis room
for non-negative charts; an unlabeled control group (IDs containing spaces).

## Test results (Windows 11 workstation, Node 24.19, Playwright 1.63 Chromium)

| Check | Result |
|---|---|
| `npm run typecheck` | Pass |
| `npm test` (Vitest) | 28 passed |
| `npm run e2e` (Playwright) | 70 passed, 6 opt-in screenshot captures skipped; three consecutive full runs |
| `npm run build` | Pass (bundle ~520 kB, size advisory only) |

Not validated: DGX Spark build/test, touch pinch-zoom, any live API or model.

## M5: AI assistant, scripted demonstration (2026-10-04)

**No language model is connected.** Questions are matched by keywords to five
prepared investigations (open issues, equipment investigation, cooling shortfall,
demand forecast, plant efficiency) plus an honest fallback. Every figure in an answer
comes from **simulated tools** that read the same synthetic scenario data as the
screens; missing or stale data is stated, and no operational recommendation is
generated. The UI labels this everywhere ("Scripted demo", "Simulated tool", a
standing notice), and nothing can control equipment.

Architecture, designed for replacement by a local-LLM harness and genuine tools:

- `src/lib/contracts/agent.ts`: conversation, turn and streamed **event** contract
  (`turn_start`, `text_delta`, `tool_call`, `tool_result`, `view`, `turn_end`), typed
  **data views** (equipment, issues, chart, link) and typed navigation targets: model
  output never supplies HTML, scripts or URLs. `applyEvent` folds events into a turn.
- `src/lib/api/agent.ts`: the `AgentClient` interface (capabilities, conversations,
  streamed `sendMessage`, `cancelTurn`). A local harness implements the same methods.
- `src/fixtures/agentTools.ts`: simulated tools (`get_plant_snapshot`, `list_issues`,
  `get_equipment`, `get_history`, `get_forecast`, `search_knowledge`) over the shared
  `DataClient`. `search_knowledge` reports the knowledge base as unavailable.
  Simulation tools for M6 fit the same shape (name, typed args, summary, value).
- `src/fixtures/agentScripts.ts` / `fixtureAgent.ts`: intent matching, the scripted
  investigations, streaming with confirmed cancellation, failure injection
  (`?fail=agent:unavailable`, data failures reach the tools), three recorded demo
  conversations, and per-conversation context: a conversation always runs against the
  scenario and time it was recorded with.
- UI (`src/features/agent/`): assistant drawer as its own shell column (pages narrow;
  the plant view refits instead of being covered), full `/agent` page with history and
  the tool list, Claude Code-style turns with expandable tool rows and typed views,
  composer with cancel, and recorded-context notice with "Ask in the current context".
  Links from answers (Inspect, Locate, Show on plant, issue details, KPI panels, the
  exact forecast) first switch the dashboard to the conversation's scenario and time.
- Entry points: "Ask the assistant" in the equipment inspector, and in KPI panels that
  have a prepared investigation.

Fixed while testing: monitoring now follows URL changes while open (assistant links),
with a single URL writer so concurrent updates cannot restore a previous selection;
KPI highlight clearing no longer removes assistant highlights; viewport Fit/Zoom/100%
measure the box at action time (resize notifications can arrive late); navigation
focus uses a `PageHeading` that takes focus after a screen change, and focus restore
after closing panels runs after the commit (both were rare timing flakes under load);
the narrow-screen assistant button has an accessible name.

## Test results after M5 (Windows 11 workstation, Node 24.19, Playwright 1.63 Chromium)

| Check | Result |
|---|---|
| `npm run typecheck` | Pass |
| `npm test` (Vitest) | 41 passed (13 new harness tests) |
| `npm run e2e` (Playwright) | 84 passed (14 new assistant tests), 6 opt-in captures skipped; five consecutive full runs |
| `npm run build` | Pass |

Not validated: DGX Spark build/test, any real model, harness, API or equipment.

## Redesign phases 1–2 (owner approval, 2026-10-04)

The design proposal (`PROPOSAL-hvac-dashboard-redesign-2026-10-04.md`) is kept outside
the repository. Phases 3–5 have not started.

- **Design system** (`src/styles/tokens.css`, `src/components/components.css`):
  interface surfaces, one accent (`#5B9BF0`), type and spacing scales, radii 12/8/6
  (containers, controls, chips), control borders at 3:1 contrast, and hatching on
  every value that is not live. Scene tokens are unchanged, so the M1 artwork renders
  as before.
- **Navigation**: a rail with Overview (`/`), Analytics (`/prediction`), Engineering,
  CAD Studio (`/cad`) and Knowledge; System and
  Installation in a System menu; a bottom bar at 760px and below. URLs are unchanged.
- **Header**: a title block with the site, data mode and scenario, replay or live time
  with freshness, and the configuration revision.
- **Workspace** (`src/app/workspace/`): one right-hand column on every screen except
  `/agent`. Details (equipment or indicator) sit above the Assistant and Pilot tabs.
  It is docked and open by default at 1440px and wider. Below that it floats over the
  page until pinned, and docks (at most 320px wide) while Details are open. At 760px
  and below it is a full-screen sheet. It resizes from 320 to 560px by pointer or
  keyboard; width, tab and pin are remembered. Details leave the Assistant at least
  420px, so its composer is never pushed out of the window. The conversation lives in
  a module session (`src/features/agent/conversationSession.ts`), so a streaming answer
  survives screen changes and expanding to the full page. The Pilot tab is a planned
  state that says it works on simulations only.
- **Overview**: a status band (cooling with a demand/delivery/capacity balance,
  efficiency, chilled water, heat rejection, 6-hour outlook, attention), one line for
  the most severe open issue, and the plant with its toolbar (zoom, Fit, Readings,
  Legend) and topology disclosure. Site, readings and issues load once for the whole
  shell (`SiteProvider`).

Deviations from the proposal: Details stack above the conversation instead of using a
third tab, so an answer stays in view when its links open Details. Docking by default
starts at 1440px, not 1280px, because docking at 1280px cost 14 zoom points. The
Analytics page keeps its "Cooling prediction" heading until phase 4. Legible readings
at fit (D10) has not been tried.

Schematic zoom, measured with the workspace open / collapsed / showing Details:

| Window | Normal operation | Tower fault (issue line shown) |
|---|---|---|
| 1920x1080, docked | 78.3% / 78.3% / 78.3% | 73.9% / 73.9% / 73.9% |
| 1440x900, docked | 59.5% / 59.5% / 59.5% | 55.1% / 55.1% / 55.1% |
| 1280x800, floating | 49.1% / 49.1% / 39.0% | 44.7% / 44.7% / 34.6% |
| 1024x768, floating | 35.7% / 35.7% / 27.9% | 31.3% / 31.3% / 23.5% |

Before the redesign: 55% at 1440x900 with no panels, 52% with the assistant and 25% with
the assistant and inspector; at 1024x768, 37% and 17% with the assistant and a KPI panel.

## Test results after redesign phases 1–2 (Windows 11 workstation, Node 24.19, Playwright 1.63 Chromium)

| Check | Result |
|---|---|
| `npm run typecheck` | Pass |
| `npm test` (Vitest) | 43 passed (2 new: chart tick decimals, indicator inputs) |
| `npm run e2e` (Playwright) | 93 passed (9 new: 7 workspace, rail section, Details and plant size), 6 opt-in captures skipped; three consecutive full runs |
| `npm run build` | Pass (JS 619.7 kB, 187.2 kB gzip; size advisory only) |

Tests changed for the new navigation: screens are reached through the rail, Engineering
tabs, System menu and workspace instead of one flat list; the narrow-screen test checks
the bottom bar instead of a drawer; "Close assistant" became "Collapse workspace"; the
three refit tests collapse the workspace first and run at 1440x1100, where the fit is
width-bound and a narrower plant shows as a smaller zoom.

Not validated: DGX Spark build/test, touch input, any real model, API or equipment.

## M5 review gate closed (owner decision F10, 2026-10-05)

The scripted assistant (`709e642`) is approved as reviewed: its behaviour, its "Scripted
demo" and "Simulated tool" labelling, its workspace integration, and the paced replay,
kept and labelled "Replay paced for demonstration".

- **M6 adds no Assistant simulation control or action tools.**
- Read-only Assistant access to simulation results (inspect, analyse, explain) is not
  excluded: it may come later if the M6 architecture supports it safely.
- Any simulation control or action capability needs a separate confirmation design
  and the owner's approval.
- M6 starts only after the owner's localhost review of Treatment A, and follows the M6
  line above and the Simulation and Pilot briefs as written.

## Treatment A, Graphite (machined bezel), 2026-10-05

The owner chose Direction A "Permit" and, of three visual treatments, Treatment A:
Graphite. The decision record (F1–F10) and the prototype that is the source of truth for
the look are kept outside the repository, in
`redesign-v2-proposal-2026-10-04/` (`F-DECISIONS-treatment-A.md`,
`prototype/treatment-graphite.html`). The built system is described in `DESIGN.md`.

- **Identity (F1, F2).** A satin anthracite bezel with a fine grain (a 22 kB tile,
  `src/assets/grain.png`) holds two recessed charcoal displays, the plant or page and the
  workspace. Laminate is the only light material: filled tags for attention, outline
  tags for provenance, dashed tags for planned work, severity marks away from the
  drawing. The accent hue and the lilac "not live" hatch are gone. Interface safety
  colours are separate tokens (danger, warning, caution, notice, ok); the scene tokens
  and pipe-media colours are unchanged, so the M1 artwork renders as approved.
- **Shell (F3).** The top bar shows "site / page" (the h1), the Demo data tag,
  Demand, Delivered, Running capacity and COP with a balance meter, More readings (a
  tray), and the attention slot. The deck has the scenario, Live demo or Replay,
  playback, the timeline and the only clock, with freshness. The dock has the four
  sections, Shortcuts and System; it magnifies near the pointer, has a sliding
  indicator, is one tab stop with arrow keys, and becomes a bottom tab bar on a phone.
  The status band, issue line, title block, rail and in-page playback bar are removed.
- **Plant (F4, F5).** The drawing fills the display. Three corner controls only: view
  switch, drawing controls (readings Auto, Key, All, Off; zoom; Fit; Legend) and the
  disclosure. Below 80% zoom, Auto shows key readings and names in screen space from the
  scene geometry (`StageOverlay.tsx`; header positions in the scene manifest,
  `keyHeaders`). Open issues hang as laminate tags. Selection dims what is unrelated,
  never equipment in fault or named by an open issue.
- **Workspace (F6).** Docked at 1440 px and wider (352 px default); below that a 52 px
  dock and a floating panel, with the plant refitting beside it when it can stay at half
  size or more. Details lead, with the open issue as a tag and its evidence rows marked;
  typing (or opening Details from an answer) folds them to a strip. The pin is removed.
- **List and Engineering (F7).** The Overview's list view has filters, a live count and
  faults first. `/engineering` is a hub (Investigations, Equipment records, Simulation
  and CAD and topology as planned rows with real topology evidence). `/equipment`
  redirects to `/?view=list`; `/equipment/:id` is the equipment record (trend read
  against the nameplate, operating point, measurements, issue timeline); `/simulation`
  and `/cad` open the hub with that row focused.
- **Accessibility (F8).** Acknowledge is its own button (this browser only, never a
  shortcut); new issues are announced, prefix the page title and swing in once.
  Shortcuts: 1 to 4, `.`, F, L, R, `/`, Escape, `?`. Reduced motion, reduced
  transparency and forced colours are handled.

Measured fits: 99.6% at 1920x1080, 69.0% at 1440x900 docked, 80.8% collapsed, 67.1% at
1366x768, 70.4% at 1280x800, 61.1% at 1024x768; beside a floating panel 59.6% at
1366x768 and 53.7% at 1280x800 (at 1024x768 the panel covers part of the plant).

Fixed while building and testing:
- The drawing again blocks text selection (a second drag was cancelled as a native text
  drag), and non-scrolling containers use `overflow: clip` again (focus could scroll a
  hidden overflow).
- The System menu sat under the deck.
- `?view=list` was re-read late and could flip the view back.
- Clicking "Locate" in an answer hid the answer behind Details.
- "Investigate Cooling tower 4" was suggested in Normal operation.
- An unknown `?kpi=` was dropped silently.
- At 200% zoom, crowded names shrink (to 10 px) instead of colliding.
- Under forced colours, text fill now follows the system colours.

Tests changed where behaviour intentionally changed: navigation through the dock, the
top bar's h1, readouts in the top bar or More readings, Locate keeping the zoom when the
item is in view, Details first, floating panels below 1440 px, the roster becoming the
Overview's list and records. New tests: the attention slot and Acknowledge
(`e2e/attention.spec.ts`), the corner overlap guarantee (`e2e/overlap.spec.ts`, 18 fit
cases plus floating panels), key readings and readings modes, Details first, floating
refit, Engineering redirects, records, shortcuts, forced-colour axe checks, and a
floating-fit unit test.

## Test results after Treatment A (Windows 11 workstation, Node 24.19, Playwright 1.63 Chromium)

| Check | Result |
|---|---|
| `npm run typecheck` | Pass |
| `npm test` (Vitest) | 44 passed |
| `npm run e2e` (Playwright) | 141 passed, 6 opt-in captures skipped (the last full run on the final code) |
| axe | 0 serious or critical on ten screens, in normal and forced colours |
| Reduced motion | Pulse, swing, flow and fans stop; states remain |
| Reduced transparency | Glass becomes solid (Chromium DevTools emulation) |
| 200% zoom | No horizontal overflow at 1440x900 and 1920x1080 windows |
| `npm run build`, `npm run build:demo` | Pass (JS 645 kB, 195 kB gzip; size advisory only) |

Not validated: DGX Spark build and frame time, a real operating-system reduced
transparency or high-contrast setting, touch input, any real model, API or equipment.

## Assistant refinement before M6 (2026-10-06)

Still the scripted demonstration: no model, every figure from a simulated tool, the
"Scripted demo", "Simulated tool" and "Replay paced for demonstration" labels kept.

- **Pacing** (`fixtureAgent.ts`, harness side): a short pause before the first step,
  tool steps of 0.36 to 0.6 s, a pause before the answer, then the text in pieces of
  one to three words (`paceText`) with varied gaps that lengthen after a clause, a
  sentence and a paragraph; about 22 to 26 words a second. `?agentSpeed=fast` (tests)
  runs the same events at 4% of the pace.
- **Answers take their content's shape** (`agentScripts.ts`): a sentence or two for a
  simple reading, paragraphs for an explanation, a list only for several separate
  issues, a table only for several readings or shortfall periods.
- **Rendering** (`Prose.tsx`): a safe Markdown subset (paragraphs, headings, lists, pipe
  tables), text only, never HTML. Mid-stream the line being written fades in word by
  word behind a still caret; a table shows once its header is complete and grows a row
  at a time; what is already shown keeps its DOM nodes.
- **Activity** (`TurnView.tsx`): the question shows at once (before the harness
  replies), then a quiet "Working" line, then each step in plain words ("Checking plant
  data…", then "Check plant data, Complete"); the steps fold into "Used N simulated
  tools" when the answer begins. No reasoning is narrated.
- **Following** (`ConversationView.tsx`): the view glides to each new line while the
  reader is at the end. Scrolling up, wheel up, Home/PageUp/ArrowUp, or a pointer or
  focus in the conversation stops following at once and halts any glide in flight;
  "Jump to latest" returns and follows again. Reduced motion: no fades, instant moves.
- **Session**: Cancel works from the moment of asking; an answer keeps streaming into
  its own conversation if another is opened meanwhile.
- **Later, not built**: assistant actions (show a chart, focus equipment, a report, an
  export) would arrive as new typed parts or events, validated like views, dispatched
  to an allow-list of app capabilities and rendered from their own payload in
  `TurnView`; model output never becomes UI code.

| Check | Result |
|---|---|
| `npm run typecheck` | Pass |
| `npm test` (Vitest) | 53 passed (pacing, renderer and answer-shape tests added) |
| `npm run e2e` (Playwright) | 147 passed, 6 opt-in captures skipped (6 new response tests) |
| `npm run build`, `npm run build:demo` | Pass |


## M6: Simulation and AI pilot, on labelled mock services (2026-10-06)

Built on the owner's go-ahead of 2026-10-06, then audited and corrected in the same
session (the audit's findings are in `M6_HANDOFF.md`). Uncommitted, awaiting the owner's
review. **Nothing here is PHYVAC, a solver, a trained model or a real pilot**, and nothing
reaches physical equipment.

- **Services.** `SimulationClient` and `PilotClient` (`src/lib/api/simulation.ts`) over
  typed, zod-validated contracts (`src/lib/contracts/simulation.ts`): capabilities, run
  status and detail, the correction ledger, held overrides, run events, per-step results,
  and pilot issues with evidence. Shaped after PR #2 (`origin/feat/simulation-foundation`
  at `3d5663d`, read from the local ref; the remote was not reachable): run states
  created, running, paused, stopped and failed; start leaves a run paused with its
  initial observation; a correction gate whose rejection (run not active, stale, out of
  limits, unknown point, malformed) is an answer, not an error; one pending correction
  (a later one supersedes it; a run that ends expires it); "accepted is not applied";
  held manual overrides with explicit release; outcomes measured after the step that took
  the correction.
- **Mock service** (`src/fixtures/simulationService.ts`, demo mode only): replays a
  synthetic scenario day and adjusts it for the controls in force by fixed rules of thumb
  (fixture arithmetic, not physics). It owns the run: a run keeps stepping whatever screen
  is open, its state is kept in session storage so a reload reconnects to it and catches
  up, and reading never advances the clock. Failure injection: `?fail=simulation:unavailable`,
  `simulation:solver`, `simulation:disconnect`, `pilot:unavailable`, `pilot:slow`;
  `?simSpeed=fast` (tests) runs at a tenth of the pace. A heat-wave scenario leaves the
  mock's envelope (wet bulb 29.5 °C) and fails, keeping its last valid observation.
- **Mock pilot** (same module): screening rules on each observation of a run it was
  explicitly asked to monitor; slower reasoning on its own timers (never on the step
  path); one issue per detection key, so repeated detections update the issue; tool calls
  recorded as evidence, including a forecast call that fails because the forecasting
  service supports telemetry sources only; proposals that the operator applies to the
  simulation through the same correction gate; outcomes and resolution recorded with the
  evidence they rest on. An ended run stops monitoring and abandons unfinished reasoning.
- **Screens.** `/simulation` (Engineering section): scenario form from the service's
  capabilities, a run band held at the top (Simulation label, run ID, revision, simulated
  time, steps, controls from the run's state), the simulated plant (the approved artwork,
  its own provenance note, pilot issues hanging on it, the selected item's simulated
  readings), results as distinct metrics with a matched-run comparison, corrections,
  held overrides, the ledger and the timeline. `/pilot`: issue list and the chosen
  issue's lifecycle, facts, investigation, proposal, applications and outcomes, evidence
  timeline and resolution. The workspace's Pilot tab is the concise monitor beside every
  screen. Addresses are typed targets (`{ type: "simulation" | "pilot", … }`) mapped by
  one `targetPath` in `src/app/navigation.ts`.
- **Assistant (F10 kept).** No simulation or pilot tools, scripts or control events. Two
  read-only navigation targets exist in the typed allow-list; nothing emits them yet.
  Stop is immediate (the view stops drawing at once; the scripted harness ends the turn
  without waiting out a pause), Escape in the composer stops, focus returns to the
  composer. Attachment and voice are Planned controls: inert, explained, no upload, no
  microphone.

| Check | Result |
|---|---|
| `npm run typecheck` | Pass |
| `npm test` (Vitest) | 73 passed (20 new: mock service, pilot lifecycle, typed targets, Stop, F10) |
| `npm run e2e` (Playwright) | 175 passed, 6 opt-in captures skipped (28 new: 14 simulation, 10 pilot, 4 assistant; 4 existing tests updated for the built screens) |
| `npm run build`, `npm run build:demo` | Pass (JS 742 kB, 224 kB gzip; size advisory only) |

Not validated: the real PHYVAC service or pilot, PR #2's current review state, a real
screen reader, touch input, browsers other than Chromium, the DGX Spark.


## M6 consolidated revision: AI Pilot runs the simulation, the Assistant reads it (2026-10-06/07)

The owner's final M6 revision (the "consolidated revision", chosen 2026-10-06) supersedes
the Screens and Assistant bullets of the section above. Uncommitted, awaiting the owner's
review. Still **no PHYVAC, no solver, no trained model, no real pilot and no language
model**, and nothing reaches physical equipment.

- **AI Pilot is where a simulation runs** (`/pilot?run=&issue=&view=`). The form comes
  from the service's capabilities; "Start simulation" (or "Start paused") is one launch:
  create the run, have the pilot monitor it from its first observation, start it, play
  it. The run band holds the lifecycle (resume, pause, step, stop; New simulation once it
  has ended). Under it: the pilot's status strip (detected and open counts, last scan,
  reasoning, a secondary Pause or Resume monitoring), the simulated readings
  (source=simulation) and three views, Live (the simulated plant with the pilot's issues
  on it, run trends, the latest findings), Findings and Corrections. When the run ends
  (Stop, completion or a failure, which is announced), the Run summary replaces Live and
  takes focus; someone reading Findings or Corrections stays there.
- **Run summary** (`src/fixtures/runSummary.ts`, contract `runSummary`): written
  deterministically from what was recorded, the run's results, corrections and events
  and the pilot's issues and evidence: identity, performance, pilot, corrections, a
  timeline in simulated time, an assessment (observation, improved, did not improve,
  concern) and recommendations, each with its basis. `PilotClient.getRunSummary` and
  `listRunSummaries`; not available while a run is active (CONFLICT).
- **Simulation history** (`/simulation?run=&compare=&equipment=`) replaces the Simulation
  page: the runs newest first (cards in a narrow display), and a read-only record with
  the summary, the simulated plant, results and a matched comparison. Control stays in AI
  Pilot. The hub's row and the workspace's Pilot tab link to both.
- **Trend** (`/trend?metric=`, Analytics): one indicator across today, the main display's
  answer to "show me COP".
- **Assistant pipeline** (no language model; labelled "No language model connected" and
  "Offline rules"): a message `{ prompt, attachments }`, typed, transcribed or with
  files, takes one path. Offline understanding (`src/lib/agent/understand.ts`) reduces the
  request to concepts (subject: indicator, equipment, run, pilot issue, files; ask: show,
  value, compare, summary, change) and a typed intent, so paraphrases meet. Responders
  (`src/fixtures/agentScripts.ts`) answer from simulated read-only tools, now including
  `list_simulation_runs`, `get_simulation_run`, `get_run_summary` and `get_pilot_findings`
  behind read-only facades (`simulationReader`, `pilotReader`). A request to see
  something emits a typed `action` (open a `NavTarget`), validated with every event at
  the session boundary and applied by the shell through `targetPath` (`useAssistantActions`,
  `src/app/openTarget.ts`): the COP trend, an equipment record, the history, a run's
  record and summary, a matched comparison, a live run or a pilot issue in AI Pilot.
  Ordinary questions are answered in the conversation and open nothing; the conversation
  draws no charts. Capabilities report `mode: offline_rules` and a `connection` (offline,
  unavailable or connected), shown in words.
- **F10 held, with the owner's read-only extension.** The Assistant reads simulation
  runs, summaries and the pilot's findings and can open them; it cannot start, pause,
  step, resume or stop a run, switch monitoring, apply a proposal, change a setpoint or
  release an override. Such requests are declined in words with where the operator acts
  (tests check that the run, its corrections and monitoring are unchanged).
- **Attachments** work in this browser only: text files (.txt, .md, .csv, .tsv, .json,
  .log; three of 512 kB) are read, refused with a reason otherwise, shown as chips and
  sent as text with the question; the harness checks them again; the stored turn keeps
  their names, not their text. The offline assistant describes a file from its content
  (rows, columns, numeric ranges, JSON keys, headings, flagged log lines, equipment and
  indicators named) and says it cannot answer free-form questions about it.
- **Voice** sits behind a speech-to-text boundary (`src/lib/api/speech.ts`, an
  OpenAI-compatible local service: `GET /models`, `POST /audio/transcriptions`). This
  build has no such service, so the microphone control says "not connected", explains
  itself and never opens the microphone. With a service (tests use `?stt=local` and a
  mocked route), it records, transcribes and puts the words in the draft to be sent.
- **Corrected while completing the revision:** the Pilot page could replace an addressed
  run with the previously shown one (any link into a run from another screen); loading
  placeholders were unannounced; a failed run was not announced on the Pilot page; the
  summary took over from Findings or Corrections; the COP chart was named "System COP ()";
  the matched-run rule was duplicated; opening a view moved focus out of the
  conversation; "Stopped" and "Ended" icons read as checkboxes; history headers sat off
  their figures; six readings wrapped five and one.

| Check | Result (Windows 11, Node 24.19, Playwright 1.63 Chromium) |
|---|---|
| `npm run typecheck` | Pass |
| `npm test` (Vitest) | 127 passed (13 files; new: offline understanding paraphrases, attachments, speech boundary, run summary, Assistant actions, F10 readers and refusals) |
| `npm run e2e` (Playwright) | 185 passed, 6 opt-in captures skipped (pilot and history specs rewritten for the AI Pilot flow; Assistant actions, attachments, voice, F10 and Stop added) |
| `npm run build`, `npm run build:demo` | Pass (JS 815 kB, 246 kB gzip; size advisory only) |

One full run had a single 30 s `page.goto` timeout under eight workers (the test passed
5/5 alone and the next full run passed); treat it as dev-server load, like the earlier
intermittent KPI Escape test.

Not validated: a real speech-to-text service or language model, the real PHYVAC service
or pilot, a real screen reader, touch hardware, browsers other than Chromium, the DGX
Spark.


## AI Pilot console and the proactive Assistant (2026-10-07)

The owner's revision toward a text-first "JARVIS for HVAC": a request becomes a typed
intent, then a validated typed action, then a deterministic service, and the main
workspace shows the answer while the conversation keeps a concise one. It supersedes the
consolidated revision's AI Pilot page and the workspace's Pilot monitor. Uncommitted,
awaiting the owner's review. Still **no language model, no PHYVAC, no real pilot**, and
nothing reaches physical equipment.

- **One AI Pilot.** The operator console in the workspace (`src/features/pilot/PilotConsole.tsx`,
  the "AI Pilot" tab) is the only place a simulation is set up and operated, in three
  phases. Set-up: name, scenario, start time, duration, timestep, setpoints; Start
  simulation or Start paused. Operating: rename; resume, pause, step, stop; monitoring;
  Live, Findings and Corrections; Apply or Decline a proposal. Finished: the Outcome (the
  deterministic summary's lead and figures, the next step, the run summary and its
  history) and New simulation. One source of truth: `simulationSession` also holds the
  console's view, the chosen issue, set-up and a pointed control, and the address mirrors
  it. The AI Pilot page (`PilotPage.tsx`) and the Pilot monitor (`PilotPanel.tsx`) are
  deleted; nothing else starts or operates a run.
- **Simulation view** (`/pilot`, `src/features/pilot/SimulationView.tsx`): the main
  display's read-only detail of the console's run, following its view: the live plant,
  readings and trends; a finding's lifecycle and evidence; the corrections ledger and
  timeline; the run summary once it ends (announced). "Operate in AI Pilot" opens the
  console; an issue waiting for a decision offers "Decide in AI Pilot", which points to
  Apply. An address leads only for what it names (run, view, issue), so one arriving late
  never undoes the operator's choice. Simulation history stays a separate, read-only
  destination; its record's "Open in AI Pilot" opens the console.
- **Names and decisions** (mock services): a run has a name (default "Normal operation
  from 12:00"; renamed in place, 1 to 60 characters, recorded as an event) in the band,
  the recent runs, the history (a Name column) and the summary. A proposal is applied
  through the run's correction gate or declined (`PilotClient.declineProposal`): nothing
  is applied, the decision is an evidence entry, the summary's timeline and
  recommendations say so, and a declined proposal cannot be submitted. Storage key
  `hvac-agent.mock-simulation.v3`.
- **Explicit controls operate; conversation never does (F10 kept).** Asked to start,
  stop, pause, resume or step a run, switch monitoring, apply a proposal or change a
  setpoint, the Assistant says it cannot, reads the runs with read-only tools, and emits a
  typed `reveal` action: AI Pilot opens at the view that holds the control, the control is
  outlined and a note says whose it is to press. The control is never pressed or focused.
  A control that does not apply now (Pause on a paused run) is not pointed to; equipment
  control is declined without any tool.
- **Proactive routing by resolved intent** (`present()` in `src/fixtures/agentScripts.ts`):
  when the answer is a view, it opens. "How has COP been today?" opens the COP trend,
  "What cooling demand is forecast for the next 6 hours?" opens Cooling prediction at that
  forecast, "What is happening with Chiller 2?" opens its record, and summaries and
  comparisons of runs open their records. "What's the COP now?" stays in the conversation
  with the trend as a link. Asked from an item's own Details, its record is a link.
- **Follow-ups from structured context:** the conversation's earlier requests are read
  again, in order, into a `Focus` (subject, indicator, equipment, run, issue, time range)
  that `understand()` resolves pronouns, ellipses and bare times against: "What about the
  last 6 hours?", "And power?", "Show me its history", "How about yesterday?". With nothing
  to refer to, the answer asks rather than guesses (`unresolved`). Time ranges: now,
  today, the last N hours (the trend's `hours`, 1 to 24) and the next N hours (the
  forecast). Anything outside the one synthetic day is said plainly.
- **One typed boundary for a future model:** `workspaceAction` is `open` (a `NavTarget`) or
  `reveal` (an operator control, with its run or issue). It is validated at the session
  boundary with every event, applies only while its turn streams in the conversation
  shown and before Stop, and is mapped by `applyAction` (`src/app/openTarget.ts`). A
  language model would emit the same actions through the same read-only tools.
- **Motion, GSAP 3.15 (core only):** `src/lib/motion.ts`, on Treatment A's curves and
  durations, transform and opacity only. It moves a phase arriving in the console or the
  Simulation view (parts settle in turn), new findings rising into the list, a status that
  changed in place, and a pointed control swelling twice inside its still ring. Nothing
  moves under reduced motion; every tween clears its properties; `<html data-motion="busy">`
  while anything moves, so checks read final colours.
- **Smooth scrolling, Lenis 1.3.26** (`src/app/smoothScroll.ts`): the main display's long
  pages only, by wheel on a fine pointer, as far as a native notch. Off on the Overview's
  stage, on a phone, for coarse pointers and with reduced motion. Nested scrollers, the
  plant, fields and the workspace keep native scrolling; keys and focus scroll natively
  and the glide follows. Frames run only while a glide does.
- **Corrected along the way:**
  - Expanding the Assistant to the full page just after asking could show an empty
    conversation, because it was created after the page opened. The page now takes it up.
  - An answer's view could leave the full page before the workspace knew the
    conversation. It is now handed over at once.
  - An applied pointer read "Your control" once the conversation was stored. Action keys
    now ignore property order.
  - Starting a run dropped focus, and the main display's heading then took it. The run's
    first control takes it now, and the top bar leaves focus in AI Pilot.
  - A late `/pilot` address reset the console's view.
  - Lenis drew 60 frames a second on idle pages.

| Check | Result (Windows 11, Node 24.19, Playwright 1.63 Chromium) |
|---|---|
| `npm run typecheck` | Pass |
| `npm test` (Vitest) | 153 passed (13 files; new: time ranges, follow-ups and unresolved references, proactive opens, pointing instead of control, faults by period, run names, Decline) |
| `npm run e2e` (Playwright) | 190 passed, 6 opt-in captures skipped, 0 failed (2.9 min, 8 workers). New: the console's set-up, naming, lifecycle, Apply and Decline, pointing, the Simulation view, proactive opens and follow-ups, smooth scrolling. Earlier full runs found the races corrected above; the pan test (8) timed out under load until Lenis stopped drawing idle frames |
| `npm run build`, `npm run build:demo` | Pass. JS 931.59 kB (287.34 kB gzip) and 936.99 kB (289.02 kB gzip), up 121.79 kB (43.3 kB gzip) on the consolidated revision's 809.80 and 815.20 kB: GSAP core about 70.1 kB (27.2 kB gzip), Lenis about 18.6 kB (5.4 kB gzip), the rest this revision's code. CSS 107.61 kB (19.72 kB gzip; not recorded before) |

Browser checks (Chromium, 1440, 1280, 1024 and 390 px): the console in set-up, operating
and finished; deciding; a pointed Stop; the Simulation view docked, beside a floating
panel and on a phone; the history; no horizontal overflow; no console errors.

Not validated: a language model, a real speech-to-text service, the real PHYVAC service
or pilot, a real screen reader, touch hardware, browsers other than Chromium, the DGX
Spark.


## Live operator and recorded replay (2026-10-07)

The owner's correction to the AI Pilot unification, after a manual review. The previous
revision still showed the live run twice (AI Pilot, and a large Simulation view that
followed it), started that view by itself, and kept a global scenario switch. Now each
surface has one job:

- **AI Pilot** is the live operator. It configures, starts, operates and monitors the run.
- **The main workspace** stays the operator's own while AI Pilot runs.
- **Simulation** is the replay and analysis of a recorded run.
- **Simulation history** is the archive.

Uncommitted, awaiting the owner's review. Still **no language model, no PHYVAC, no real
pilot**, and nothing reaches physical equipment. This supersedes the previous section's
Simulation view and its address mirroring.

- **AI Pilot owns the live run and never moves the main display.**
  - Start and Start paused leave the operator on their screen; the run's first control
    takes focus.
  - Choosing a console tab or a finding changes AI Pilot only.
  - Removed: "Show the simulated plant", the AI Pilot tab's "Show the simulation in the
    main display", and the address mirroring.
  - A finding opened under its row now carries the pilot's investigation and its latest
    three pieces of evidence, so a live decision needs nothing else.
  - On a phone, a console link that changes the main display (the replay, the history)
    closes the sheet.
- **The end is a short result in AI Pilot.**
  - When a run completes, is stopped or fails, the console shows "Simulation completed",
    "stopped" or "failed", with the failure.
  - It shows the run's name and ID, findings detected, corrections applied, average COP
    and energy, taken from the run's record and the pilot's state.
  - The end is announced. "View summary & replay" is in laminate; "New simulation" sits
    raised in the band.
  - Nothing navigates by itself. The live tabs end with the run.
- **One canonical replay at `/simulation/RUN-…`.**
  - `SimulationView.tsx` became the Simulation replay of a recorded run. It is the same
    view from AI Pilot's result, Simulation history and the assistant; History's record
    view merged into it.
  - The run's metadata is read only: name, ID, state, scenario, revision and times.
  - It holds the pilot's run summary and the simulated plant with a **Replay** scrubber,
    one stop per recorded step. What is chosen on the plant shows its readings and what
    was held then.
  - The results (System COP added) mark the replayed moment, with matched comparison.
    The corrections and events sit beside them, and the pilot's findings with their
    evidence follow. An address's `issue` or `equipment` is chosen and brought into view.
  - A live run's address says it is live in AI Pilot, with "Open AI Pilot", and shows the
    replay once the run has ended.
  - `/pilot` is no longer a screen.
- **Recorded steps.**
  - `SimulationClient.getObservation(runId, step)` is read only.
  - The mock reproduces a step from the run's configuration and what it held then
    (`heldAt`, from the corrections ledger). The last step is the run's own final
    observation; a step it did not record is NOT_FOUND.
  - A test checks that a reproduced step's power equals the recorded result.
- **Simulation history** is the archive only. A run opens its replay; the live run's
  "Live in AI Pilot" opens AI Pilot beside the list.
- **No scenario switch outside AI Pilot.**
  - The bottom bar's "Demo scenario" select is gone.
  - The scenarios stay: AI Pilot's set-up, the mock services, fault cases, and
    `?scenario=` for the demo telemetry and the tests.
  - A link in a conversation recorded with another demo scenario still replays that
    context; the conversation says which.
- **Typed targets.**
  - `simulation` is the history, or one recorded run's replay (`issueId`, `equipmentId`,
    `compareWith`).
  - `pilot` is AI Pilot's run, shown in the workspace (`showInPilot`), never a screen.
  - The assistant opens AI Pilot for the live run and the replay for an ended one.
    "Show me the last simulation" opens the replay.
  - F10 pointing is unchanged and moves nothing in the main display. From the full
    assistant page, AI Pilot opens over the Overview.
- **Motion and scrolling.**
  - The console's phases (set-up, running, result) arrive on Treatment A's timings.
  - The replay settles in once, when it is first shown. Under reduced motion nothing
    moves.
  - The replay is smooth-scrolled like every long page, with frames only while gliding.
- **Corrected along the way:** finding rows were 20 px too wide outside the console (a
  sideways scroll at phone width); a failed run was announced as "ended".

| Check | Result (Windows 11, Node 24.19, Playwright 1.63 Chromium) |
|---|---|
| `npm run typecheck` | Pass |
| `npm test` (Vitest) | 154 passed (13 files; new: a recorded step is replayed exactly, with what the run held then; "Show me the last simulation" and recorded runs' replay targets) |
| `npm run e2e` (Playwright) | 193 passed, 6 opt-in captures skipped, 0 failed (2.7 min, 8 workers), twice in a row. New: start, stop and completion leave the main display alone; the completion result; the replay (its scrubber, what was held at each step, the same view from History and from AI Pilot); the deck without a scenario switch. Earlier full runs found timing-only failures, which got wider margins: the long pan test and the five-scan accessibility test, and a clock pause in the cancel test |
| `npm run build`, `npm run build:demo` | Pass. JS 928.53 kB (286.73 kB gzip) and 933.92 kB (288.40 kB gzip), 3.1 kB (0.6 kB gzip) less than before this correction; CSS 107.26 kB (19.83 kB gzip) |

Browser checks (Chromium):
- A run started from Cooling prediction leaves it in place; choosing findings and
  stopping move nothing.
- The completion result and "View summary & replay".
- The replay with the scrubber, the step marked on every chart, and what was held at
  each step.
- History opens the same replay; a live run's replay address points to AI Pilot.
- Checked at 1440, 1280, 1024 and 390 px, with no sideways scrolling and no console
  errors other than the known favicon 404.

Not validated: a language model, a real speech-to-text service, the real PHYVAC service
or pilot, a real screen reader, touch hardware, browsers other than Chromium, the DGX
Spark.

## M7: Knowledge workspace, Graph RAG and Graph Memory (2026-10-08/09)

The owner's M7 specification: replace the Knowledge placeholder with two graph systems on
one page, **Graph RAG | Graph Memory**, each independent of AI Pilot, with real services
where feasible and honest boundaries where not. Uncommitted, awaiting the owner's review.
Still **no language model and no embedding model**: nothing is generated, and the screens
say so.

**Architecture (zero new dependencies).**

- **Backend in Python**, where the architecture docs put it, using only the standard
  library:
  - `src/hvac_agent/knowledge/`: the vocabulary, the pipeline and `KnowledgeService`.
  - `src/hvac_agent/agent/memory.py`: `MemoryService`.
  - `src/hvac_agent/integrations/`: the SQLite stores, the OpenAI-compatible embeddings
    client and the optional pypdf adapter.
  - `apps/api/local_server.py`: a framework-neutral WSGI composition serving
    `/api/knowledge/v1` and `/api/memory/v1`.
- **Storage:** SQLite, one file per system (`knowledge.sqlite3`, `memory.sqlite3`, in the
  ignored `var/` by default), with FTS5 BM25 for keyword search.
  - Neo4j, LightRAG and Graphiti were evaluated and not installed: each needs a server, a
    JVM or a language model that this machine does not have.
  - The store adapters are the seam for a later move.
- **Extraction** is deterministic and schema-guided: an HVAC vocabulary of equipment,
  components, faults, symptoms, concepts, standards and procedure headings, plus
  sentence-scoped rules.
  - Every relationship keeps its evidence span and the rule that read it.
  - Model extraction and answer generation report "not configured".
- **Retrieval** combines keyword BM25, graph traversal from the entities a question names
  and, when an embedding server is configured, cosine vectors from the same model, merged
  by reciprocal rank fusion.
  - Results are stored passages with their source, section, page, method ranks and
    traversal paths.
  - The fusion score is labelled "not probabilities".

**Demo and real.**

- **Demo** (default under `npm run demo`) is read only:
  - the synthetic documents in `src/fixtures/knowledge/`, indexed by the real pipeline
    (`knowledgeDemo.json`);
  - synthetic memory records created through the real `MemoryService` rules
    (`memoryDemo.json`).

  `scripts/export_knowledge_demo.py` writes both, and a Python test fails if either is
  stale.
- **Real** is `?knowledge=local`, through the dev server's proxy to the local service. It
  persists, shows the service's real capabilities and failures, and never falls back to
  demo data.
- Management (upload, reindex, remove, record, correct, link, delete) exists only in real
  mode; the demo says why.

**Graph RAG.**

- **Library:** capability facts and documents with ingestion status as an icon and a word.
  A failed document shows its reason.
- **Documents:**
  - the eight-stage ingestion diagnostics;
  - the outline, whose sections open in the source reader;
  - Reindex, and Remove… whose confirmation lists what goes with the document.
- **Uploads:** checked in the browser and by the service: type by extension and content,
  20 MB, UTF-8, duplicate by SHA-256 with a link to the existing document, and no
  execution or rendering of markup.
- **Search** shows the three example questions; each finds its evidence first.
- **Graph:** the 150 best-connected nodes at most, type and relationship filters, find,
  expand (300 at most, with existing nodes pinned), and node and relationship inspectors
  with evidence snippets that lead to the passage.
- A missing citation says so.

**Graph Memory.**

- Six kinds, five provenance labels, and three link types checked against kinds and time.
- **The persistent store refuses:**
  - Demo records;
  - Verified operational source (no integration exists);
  - a simulation record without its run;
  - an imported record without its reference;
  - future times;
  - text that looks like a credential.
- **Corrections** supersede: the old version stays as history, valid until the correction.
- **Deletion** removes the record, its links and its keyword entry. The version it
  corrected becomes current again.
- **The timeline** shows "After … on …" sequences per equipment.
- **The memory graph** is laid out in time: lanes by equipment, simulation runs above, day
  markers, and the derived OCCURRED_BEFORE drawn dashed.
- **Rules and retention** are shown on the page.

**Interface.** Treatment A throughout:
- raised-and-outlined tabs;
- laminate only for the selection and the primary action;
- state colours always with a word;
- outline tags for provenance.

The graph explorers are handwritten SVG, with no new UI dependency:
- shapes per type;
- names and shapes kept at screen size;
- pan and zoom, with the wheel left to the canvas by Lenis;
- a single tab stop with arrow-key travel.

GSAP is used for the tab change, panel arrival, node focus (a camera glide), ingestion
status and timeline entries. Reduced motion stops all of it. The workspace is a lazy
chunk.

| Check | Result (Windows 11, Node 24.19, Python 3.14.7, Playwright 1.63 Chromium) |
|---|---|
| `python -m unittest discover -s tests` | 62 passed (knowledge 39, memory 17, local API 6: validation, extraction, relationships with evidence, the ingestion job and restart recovery, the example questions, the bounded graph, deletion cleanup, persistence, isolation, the embeddings adapter against a stub server, the memory rules, supersession and deletion, the HTTP checks, and a real server restarted on its data) |
| `npm run typecheck` | Pass |
| `npm test` (Vitest) | 173 passed (16 files; new: the demo adapters against the shared contracts, the example questions, evidence snippets, the local clients' error handling, layout determinism and pinned expansion) |
| `npm run e2e` (Playwright) | 216 passed, 6 opt-in captures skipped, 0 failed (2.3 min and 2.2 min, twice in a row). New: `knowledge.spec.ts` (13: tabs, library, document stages and outline, the source reader, a missing citation, search with its evidence, the graph and its keyboard path, Graph Memory, failures, address hygiene, reduced motion, phone overflow, axe over six views) and `knowledge-local.spec.ts` (10, on the real Python service: uploads, stages, duplicates, a failed extraction, graph evidence, the memory lifecycle, removal, persistence across a reload and a restart, no demo fallback) |
| `npm run build`, `npm run build:demo` | Pass. Main JS 930.14 kB (287.51 kB gzip) and 935.52 kB (289.18 kB gzip), 1.6 kB (0.8 kB gzip) more than before M7; main CSS unchanged at 107.26 kB. The workspace loads on demand: 95.7 kB JS (27.0 kB gzip) and 16.6 kB CSS (3.5 kB gzip), plus 184.4 kB (27.4 kB gzip) of demo snapshot in demo mode only |

Browser checks (Chromium, the Playwright MCP and a scratchpad script):
- every view at 1440, 1180, 760 and 390 px with no page overflow;
- the real path through the dev server's proxy (upload, indexing stages, outline, the
  empty memory store);
- no console errors other than the known favicon 404.

Not validated:
- PDF ingestion with pypdf (not installed);
- an embedding server;
- a language model;
- a real screen reader;
- browsers other than Chromium;
- the DGX Spark (Python 3.12, aarch64; FTS5 there is unverified).

## M7.1: the knowledge graph in 3D (2026-10-09)

The owner installed `react-force-graph-3d` 1.29.2 (with it `3d-force-graph` 1.80.1,
`three-forcegraph` 1.43.6, `three-render-objects` 1.43.0, `d3-force-3d` 3.0.6 and three.js
0.186.1) and asked for the Graph RAG graph as a colourful, interactive, readable 3D view,
keeping 2D. Nothing else was installed. The M7 contracts, services, SQLite storage and
demo snapshots are unchanged. Uncommitted, awaiting the owner's review.

- **Views:** 3D by default, 2D kept, chosen in the address (`gv`), with one selection
  across both. High contrast opens in 2D; no WebGL, or a lost graphics context, gives 2D
  with a sentence saying why.
- **Colour:** four families, not nine colours:
  - sources: paper documents, graphite sections;
  - plant and process: teal;
  - problems: brass;
  - guidance: violet.

  The dataviz validator, run with every pair side by side, showed that five or more hues
  cannot stay apart for colour-blind readers on this surface while also avoiding the state
  colours. The family set passes: worst colour-vision ΔE 11.3, normal 15.8, each at least
  3:1. Shapes and names tell the types apart, and the grouped type filters are the legend.
  The 2D view uses the same colours. The node types are the graph's own: passages are not
  nodes, they are the evidence in the panels.
- **Clustering and disclosure:**
  - Positions are deterministic and clustered by document (`clusterLayout3d`), with links
    between clusters pulling lightly.
  - The overview names only the documents and the best-connected nodes.
  - Choosing a node names what it relates to and fades the rest; zooming in names what is
    close.
  - Expanding a node adds its neighbours, as in M7.
- **Camera:**
  - Orbit, pan and zoom; Fit, Reset view, + and −.
  - A chosen node (by click, its name, Find with Enter, the panel or the address) brings
    the camera to it and its relationships. A chosen relationship frames both ends.
  - 500 ms, easing in and out; it jumps with reduced motion. Keys do not animate.
- **Explanation:** the existing node and relationship panels (details, relationships,
  evidence with document, section, page and rule) gain a provenance line. Closing a panel
  returns focus to what opened it, in 3D and 2D.
- **Keyboard and screen readers:**
  - The canvas is one tab stop (`role="application"`).
  - Arrow keys move to the nearest node on screen, with a laminate ring and a polite
    announcement. Enter inspects, Shift with an arrow turns the view, + and − zoom, 0 fits,
    R resets, Escape clears.
  - The 2D view remains the fully semantic alternative (every node a button).
- **Performance:**
  - three.js is a separate lazy chunk: 799 kB (211 kB gzip). A build-time stand-in for
    `three/webgpu` (imported by three-render-objects for an option the app never sets)
    keeps the WebGPU renderer out; without it the chunk is 1,406 kB (377 kB gzip).
  - The scene draws only while someone looks round and pauses 1.5 s after (no draws when
    idle, tested). Positions are computed once per graph, not simulated.
- **Graph Memory** keeps its chronological 2D view. Time is its axis and equipment its
  lanes, so a third dimension would hide records behind each other without adding
  meaning.

| Check | Result (Windows 11, Node 24.19, Python 3.14.7, Playwright 1.63 Chromium with SwiftShader WebGL) |
|---|---|
| `python -m unittest discover -s tests` | 62 passed (unchanged); the demo snapshots are current |
| `npm run typecheck` | Pass |
| `npm test` (Vitest) | 178 passed (16 files; new: document weights and homes, the 3D layout's determinism, kept positions and clusters on the demo library, label decluttering, keyboard direction) |
| `npm run e2e` (Playwright) | 224 passed, 6 opt-in captures skipped, 0 failed (2.5 min and 3.0 min, twice in a row). New in `knowledge.spec.ts`: the 3D overview and legend, choosing a node (flight, highlight, panel, clearing), Find with Enter, Fit and Reset, the keyboard path with focus returning, 3D and 2D in one address, drawing only while looked at, no WebGL, high contrast; the 2D tests use `gv=2d`; axe now covers the graph in 3D and 2D |
| `npm run build`, `npm run build:demo` | Pass. Main JS 930.43 kB (287.61 kB gzip) and 935.84 kB (289.26 kB gzip), 0.3 kB more than M7; main CSS unchanged at 107.26 kB. The Knowledge chunk is 104.5 kB JS (30.0 kB gzip) and 19.0 kB CSS (4.0 kB gzip); the 3D chunk 799.0 kB (211.5 kB gzip), loaded only when the 3D view is shown |

Browser checks (Chromium, scratchpad scripts):
- the overview, a turned view, a chosen node and a chosen relationship at 1440 px;
- the phone at 390 px, with no page overflow;
- a click on a sphere itself, the keyboard path and the 2D switch;
- no console errors. SwiftShader prints GPU-stall warnings when screenshots read pixels.

Not validated:
- a hardware GPU (only SwiftShader);
- browsers other than Chromium;
- touch on a real device;
- a real screen reader with the 3D view;
- the DGX Spark's browser.

## M7.2: the knowledge graph as planetary systems (2026-10-16)

The owner's M7.2 specification: the M7.1 graph was too dense, its circles too small and
related nodes crowded together. They asked for spacious, planet-like systems, one per
knowledge group, with group focus, quieter relationships, readable names, a subtle
gradient and smooth selection. Uncommitted, awaiting the owner's review. No dependency was
added; the backend, its contracts and the demo snapshots are unchanged.

**Why M7.1 was cluttered** (measured on the demo graph):
- 31 of the 93 entities are described by two to four documents. M7.1 pulled each to the
  average of its documents' places, so shared entities piled into the middle and the 63
  links between documents converged there.
- Its force layout let links (whose pull grows with length) drag clusters together. The
  closest nodes of different documents were 39 units apart, and six of 122 nodes sat
  nearer another document than their own.
- Spheres were small for the scene: at the overview a document was 7 px in radius and the
  median node 3.6 px.
- Every link was drawn alike (175 of the 252 run from entities to sections), and a chosen
  document showed only its two direct links, with no way to see its group.

**What changed:**
- **Layout** (`planetaryLayout` replaces `clusterLayout3d`):
  - one system per document, the document at the centre (radius 30);
  - sections on the inner orbit, evenly spaced in outline order; important entities next;
    supporting entities outside;
  - each orbit tilted differently and spaced so spheres never touch (tightest gap 11.7
    units, against 6.4 in M7.1);
  - systems in rows with 130 units between outer orbits (the closest nodes of different
    systems are now 193 units apart, against 39);
  - every node nearer its own document than any other (122 of 122, against 116);
  - each entity on the free place nearest what it relates to; one with nothing to lean
    towards fills the widest gap.

  It is placed, not simulated: about 9 ms for the demo graph on its first call and 0.4 ms
  after (M7.1's simulation: about 34 ms), and under 30 ms for 300 nodes. Expanding a node
  moves nothing already shown (see the review below).
- **Shared knowledge.** Each node is drawn once, in the system of the document that
  describes it most, leaning towards its other documents. A "+n" by its name says how
  many more describe it, and links between systems arc between them.
- **Sizes and lens.** At the overview a document is now 19 px in radius and the median
  node 5.3 px (M7.1: 7.4 and 3.6); a 34° lens keeps spheres round.
- **Relationships.**
  - Overview: links within a system at 22% opacity, between systems at 4.5%.
  - A group: its links clear; its links to other systems half-shown, in laminate.
  - A node: its relationships lit with arrows; its own system at 36%; the rest at 12%.
- **Group focus and the trail.** Choosing a document (its sphere or its name) frames its
  whole system. **Overview › group › node** at the lower left says where one is and leads
  back; Overview also resets the camera.
- **Names.** Documents in the body size and always shown; important entities in the
  caption size. Each name tries four places, never covers another name, a planet, the
  chosen node or the controls, and fades in and out. Phones get shorter document names.
- **Motion.** The camera's 500 ms ease in and out is kept for nodes. A group or the
  overview takes 650 ms, because the change of scale is larger. Emphasis now cross-fades
  in 320 ms instead of switching. Reduced motion jumps and switches.
- **Space.** The viewport is a quiet gradient (see `DESIGN.md`) whose lightest point keeps
  every family colour at 3:1 or more.
- **Documents in a cut-short overview.** The overview shows the 150 best-connected nodes,
  and documents, linked only to their top sections, rarely rank among them (the demo's
  rank 76th to 104th of 128). When the overview is cut short, the documents it left out are
  fetched and added (the index's own nodes, nothing invented), so every system keeps its
  centre, and the note under the filters says so. If that request fails, the overview
  stands as it was.

**Review and fixes (2026-10-16).** The implementation was reviewed again after an
interrupted session. By severity:
- **Major: growing the graph crowded it.** On a synthetic 12-document library, expanding
  from the 150-node overview to 300 nodes gave 48 pairs of overlapping spheres. Systems also
  ran into each other: the gap between their outermost members fell from 174 to −147. New
  nodes went on one outer ring sized without regard to the neighbours.
- **Major: the recovered rewrite kept every place ever held.** The rewrite of that growth,
  written before the interruption (331 lines), fixed the overlaps but never released a
  place. Choosing nodes in turn swaps their extra neighbours in and out, so the systems kept
  growing (25 to 35 orbits over eight rounds) and soon needed rings in depth. Its rings in
  depth were as wide as the widest orbit, so they could reach a neighbouring system, and at
  a fixed depth they could meet a tilted orbit.
- **Fixed: growth by places.**
  - Each orbit records the node at each place; a place a node leaves is free again.
  - New nodes take free places of their kind first.
  - Then a new outer orbit, keeping only the places that leave half the gap to every other
    system and are nearer their own planet: all round where there is room, only the open
    side where there is not.
  - Only then a ring in front of or behind the system. It is as wide as the widest orbit
    that goes all the way round, and clear of the deepest node on that side.
- **Fixed: results.**
  - Growing to 300: 0 overlaps, nothing moved, systems 174 units apart throughout.
  - The worst case found, 110 entities arriving in a system laid out with only its
    sections: 0 overlaps, and no sphere covers another on screen. The recovered version
    had 59 overlapping pairs on screen, with 12 nodes more than half hidden.
  - 150 arriving in a system boxed in on every side: rings in depth, 0 overlaps, every node
    nearer its own planet, nothing moved.
  - Choosing nodes in turn: the orbits stop growing.
- **Major: documents dropped from a cut-short overview** (above).
- **Minor:**
  - Sections took the first places on their orbit instead of spreading round it; now they
    are even.
  - The chosen node's name is bolder but kept its earlier width when names were laid out;
    it is now measured again.
  - In the overview, after zooming in, names of off-screen planets were held at the edge of
    the view. Now only the chosen node and what it relates to are.
- **Informational.** Rings in depth, the last resort, can still partly cover each other from
  the front when a boxed-in system grows very large (150 or more late nodes, past the
  300-node cap in these tests). Turning the view separates them.

**The Playwright failures.**
- **The first M7.2 run's failure** (224 passed, 1 failed; the next run passed). The journey
  test expected six document names after "Overview" and found five.
  - Cause, confirmed: router navigations are transitions, so the camera request for the
    trail's group choice rendered after the Overview click, and a resize then re-framed the
    group.
  - Fixed: Overview fits the camera once the overview has rendered; a request for a node no
    longer chosen is ignored; re-framing keeps the direction asked for.
  - Result: 0 failures in 16 runs of the failing route and 36 runs of the test under load
    (before the fix, 4 failures in 12).
- **Cause 1 (confirmed) of the failures found while verifying.** The tests' `open()`
  returned when the app's own heading appeared, before the Knowledge workspace had loaded.
  Under eight parallel workers, an accessibility check then found no workspace, and the
  first 3D check started seconds late. `open()` now waits for the workspace's tabs, in both
  knowledge specs.
- **Cause 2 (confirmed).** Headless Chromium's first WebGL context starts its software
  renderer, which takes 2.2 s; later contexts take 2–6 ms. The first test to draw in each
  worker paid that start-up within its 5 s. The knowledge spec now starts the renderer once
  per worker, before its tests. A stress run of the 3D tests (four repeats, eight workers)
  went from 10 failures in 32 to 1 (the 3D chunk loading after a switch from 2D under that
  concentrated load).
- **Not resolved.** Under full-suite load only, an Escape pressed just after a panel opened
  and took focus was sometimes not acted on:
  - in the 3D keyboard test (two of seven full runs), the indicator details (two) and the
    equipment inspector (one): three features with two Escape mechanisms;
  - not reproduced in isolation: 0 of 64 scripted runs (CPU throttling, a busy main thread,
    the test's exact keys), no Escape failure in three stress runs of the 3D tests, and
    none in two 130-test runs of those three specs;
  - one gap is real by construction: a knowledge side panel takes focus in a layout effect
    but listens for Escape (`useEscapeLayer`) from a passive effect. Making that a layout
    effect was tried and reverted, because it could not be shown to help and the hook is
    shared code (decision 20).

  No assertion was weakened and no test was skipped.

| Check | Result (Windows 11, Node 24.19, Python 3.14.7, Playwright 1.63 Chromium with SwiftShader WebGL) |
|---|---|
| `npm run typecheck` | Pass |
| `npm test` (Vitest) | 181 passed (17 files). New since M7.1: the planetary layout on the demo; growth to the 300-node cap (nothing moves, no two spheres touch, every node nearer its own system); places reused as nodes come and go; rings in depth only for a boxed-in system; sections evenly spread in outline order; names trying alternative places and avoiding planets; the documents a cut-short overview leaves out |
| `npm run e2e` (Playwright) | Three full runs of the reviewed code: 225 passed; 224 passed and 1 failed (the indicator details' Escape, above); 224 passed and 1 failed (the 3D keyboard test's Escape). 6 opt-in captures skipped each time. New: overview to a document's group, a member, a relationship and back by the trail; clicking a document's sphere; the groups at least 150 px apart on screen. Four 3D tests repeated 8 times on 8 workers: 32 of 32 |
| `npm run build`, `npm run build:demo` | Pass. Against M7.1 (`cd94b78`, built the same way): main JS 930.59 kB (287.68 kB gzip) and 936.00 kB (289.33 kB gzip), 0.16 kB more; Knowledge chunk 109.50 kB (31.90 kB gzip), 4.96 kB more; its CSS 20.85 kB, 1.87 kB more; 3D chunk 804.37 kB (213.25 kB gzip), 5.34 kB more; main CSS unchanged at 107.26 kB |
| `python -m unittest discover -s tests` | 62 passed (no backend change) |

Browser checks at 1440 and 390 px (scratchpad screenshots, before and after):
- the overview, a document's group, a node and a relationship;
- a turned and zoomed view, the return to the overview and a mid-transition frame;
- 2D, reduced motion and no WebGL;
- no console errors and no page overflow.

During a group focus on SwiftShader, frames ran at a median 16.7 ms (95th percentile
66.7 ms), with two long tasks of about 70 ms when the side panel opens.

Not validated:
- a hardware GPU or the DGX Spark;
- other browsers;
- touch on a real device;
- a real screen reader with the 3D view;
- a library large enough to cut the overview short (adding the documents is unit-tested
  only).

**Final refinement: stars and map-like dragging (2026-10-16).** After their visual review,
the owner asked for a subtle space background and for dragging that moves the graph.

**Why dragging did not move the graph.**
- The camera controls (three's OrbitControls, created by react-force-graph-3d) kept three's
  default buttons. The left button turned the view round its centre; only right-drag or
  Shift-drag panned.
- The wheel zoomed towards the centre, so zooming into a corner cluster pushed it towards
  the edge.
- 3d-force-graph marked empty space as clickable (empty space clears a choice), so it showed
  a pointer, never the open hand.
- Neighbours of a choice arriving after the reader had moved the view asked the camera back
  to the node. That undid the whole drag: 184 px in the new test.

**What changed** (configured; no library added):
- **Buttons.** Left-drag pans in the plane of the screen, and the point under the cursor
  stays under it (a 150 × 80 px drag moves the node under it 145 × 78). Right-drag or
  Shift-drag turns the view. Middle-drag zooms.
- **Wheel and touch.** The wheel zooms towards the pointer (`zoomToCursor`). On touch, one
  finger pans and two turn and pinch.
- **Names.** A drag that starts on a name is handed to the controls once it moves 4 px; a
  click on a name still chooses it.
- **No choosing by drag.** A drag never chooses (three-render-objects drops the click that
  ends a drag).
- **Cursor.** An open hand over empty space and over links faded below 20%; a pointer over
  nodes and visible links.
- **No snap-back.** A repeated camera request for the node already flown to is ignored once
  the reader has moved the view; a new choice still flies.
- **Phones.** Chromium leaves page coordinates unscrolled on a touch's first event and on a
  handed-over press while the page is scrolled, so touch pans jumped by the scroll (+249 px
  instead of −60). Those coordinates are now set from the client position.
- **The sky.** Still stars as an SVG background, generated once and the same every visit:
  - 190 dim stars on a 1187 × 997 px tile and 55 more on a 1543 × 1301 px tile (40% of them
    brighter, with a halo), so the pattern does not visibly repeat;
  - faint violet and teal hazes in two far corners;
  - the lightest point is unchanged, measured at `#191E24` before and after, so every
    family colour keeps 3:1 or more (violet at 3.08);
  - no animation, no events, nothing to redraw after the first paint; hidden in
    forced-colours and more-contrast modes;
  - colours written as `rgba()` rather than opacity attributes, because the accessibility
    checks wait for inline "opacity" (a GSAP fade).

| Check | Result |
|---|---|
| `npm run typecheck` | Pass |
| `npm test` (Vitest) | 181 passed (17 files) |
| `npm run e2e` (Playwright) | Three full runs: 227 passed; 225 passed and 2 failed; 227 passed. 6 opt-in captures skipped each time. The two failures were the known intermittent ones: the 3D keyboard test's Escape, and the shell's wheel scroll with a freshly started server. The keyboard tests then passed 32 of 32 on 8 workers |
| New browser tests | The graph moves like a map (pan, a drag from a name, Fit, right-drag, Reset view, the wheel towards the pointer; nothing chosen). A view moved after choosing stays put when the choice's neighbours arrive later (the demo service's answers held until the drag is done). 12 of 12 runs together on 8 workers. Both run with reduced motion, so nothing is still gliding when a position is read |
| Mutation checks | With the old buttons, the pan check fails (289 px off). Without the stay-put rule, the stay-put check fails (184 px back) |
| `npm run build`, `npm run build:demo` | Pass. 3D chunk 806.80 kB (214.26 kB gzip), 2.4 kB more; Knowledge CSS 21.12 kB; main JS unchanged |

Browser checks (scratchpad scripts, 1440 and 390 px):
- the mouse: pan, a drag from a name, right-drag, the wheel towards the pointer, panning
  after a choice, Fit and Reset view;
- touch, with synthetic events: one finger pans (81 × −61 for 80 × −60), also from a name,
  and two fingers pinch;
- reduced motion: a drag stops where it is released;
- the stars at 1× and 2×, in a group view and on a phone;
- no console errors and no page overflow.

Not validated: a real touch device.

Seen in the dev server's log and older than this work: an unhandled rejection from
`scrollTo` in `ConversationView.tsx` (the Assistant). It fails no test and is left as it is.

## M7.3: the RAG Graph as a full-page workspace (2026-10-16/17)

The owner's M7.3 specification:
- rename Graph RAG to RAG Graph;
- open Knowledge on the graph itself instead of Library, Search and Graph views;
- let the graph fill the workspace, with compact floating controls;
- keep the library and the search, inside the graph's workspace;
- cut the text;
- keep Graph Memory as the other mode;
- work at 1440 and 390 px;
- preserve everything else.

Uncommitted, awaiting the owner's review. No dependency was added. The knowledge service's
API, contracts and data are unchanged; one setting of the local server changed (below).

**Before** (1440x900, workspace docked):
- The graph started 325 px down the display, under:
  - the tabs and a lead paragraph;
  - the three views, then the count with 3D | 2D;
  - nine type filters in two rows;
  - the find box and "All relationship types".
- 475 of its 540 px were in view (56% of the display), and the display scrolled 219 px.
- A paragraph of mouse and key instructions, and the colour sentence, sat under the canvas.
- On a 390 px phone the graph started 504 px down, with 201 px in view.

**What changed:**
- **Navigation.**
  - The tabs are **RAG Graph | Graph Memory**, and Knowledge opens on the graph.
  - The RAG Graph's header holds the tab, the count ("128 nodes, 252 relationships", a polite
    status) and the provenance tag. Graph Memory keeps its lead.
  - Addresses keep working: `?doc=`, `?passage=`, `?node=` and `?edge=` (the inspection) and
    `?kv=search&q=` (passages). New: `?kv=library` (the library). `?kv=graph` still opens
    the graph.
  - Internal names (`kn=rag`, the components, the service, the contracts) are unchanged.
- **The graph fills the display** (3D, demo library). Its share of the display:
  - 87% at 1440x900 (1000 x 718 px);
  - 85% at 1024x768;
  - 75% at 390x844 (366 x 413 px, between the phone's top bar and its deck).

  Nothing scrolls, the page or the display, and nothing overflows sideways in any state:
  the graph alone, the library, search results, a node, a document from the library, 2D,
  Help, Filters and the search's choices, at 1440, 1024 and 390 px. Beside the floating
  workspace panel (1280x800), nothing lies under the panel.
- **Search, in the graph.** One combobox over the graph:
  - first the nodes in view whose names match (up to six, in the old find box's order);
  - then, set apart, "Search passages for '…'".

  Choosing a node flies to it and inspects it, and Enter takes the highlighted choice. With
  no match, the list says so and offers only the passages. The passages open in the column,
  with what the Search view showed (how they were found, the documents, the hits, "No answer
  is written"). Each hit adds **Show in graph**, and says so when its section is not in the
  graph view. Example questions show while there is no question.
- **The library, beside the graph.** The **Library** button (pressed while open) opens it in
  the column:
  - the count, the demo's note and the capabilities;
  - Add document (local service) and the documents with their status.

  Choosing a document opens its panel over the list, with "‹ Back to the library", and
  focuses its group in the graph. Reindex, Remove… and the outline are unchanged.
- **Text.** Removed from the page:
  - the lead paragraph;
  - the three views and their headings;
  - the instructions under the canvas;
  - the colour sentence.

  The instructions are in Help and stay the canvas's accessible description. The colour
  sentence is in Filters, with the type and relationship filters.
- **Controls.** At the top left: search, Library and Filters, and Clear expansions after an
  expansion. At the top right, the canvas's tools: 3D | 2D, zoom, Fit, Reset view (3D) and
  Help. The trail stays at the bottom left. On a graph 800 px wide or less the buttons show
  only their icons; their names stay for assistive technology and as tooltips. At 560 px or
  less the tools move to the bottom, with the trail above them.
- **Resizing.** When the column opens or the window changes, the graph takes the room left:
  - the 3D view re-frames what it showed (M7.2);
  - the 2D view now keeps what was in its middle.

  Both views frame between the controls along the top and bottom. 3D names avoid the
  controls and any open popover.

**Review and fixes (2026-10-17).** After an interrupted session, the M7.3 changes had a
second, independent review, and every finding was checked against the code. No critical
issues. By severity:
- **Major: indexing moved the camera.**
  - While a local document is queued or processing, the library is read again every
    second. The graph took that counter into its layout key.
  - So every second the graph was read again and laid out again, and the camera went back
    to the overview. Pan and zoom were unusable during an upload, and after Reindex the
    view ended on the overview.
  - This is older than M7.3, but it showed only if the Graph view was open during an
    upload. M7.3 shows the graph all the time.
  - Fixed: the graph is read again only when indexing ends or a document goes. The layouts
    are keyed by what is shown (the filters), so a re-read graph grows or shrinks in place
    and the camera stays.
- **Major: the 3D | 2D switch lost keyboard focus.** It sits among the canvas's tools, so
  switching replaced it along with the canvas. Focus fell to the page and the arrow keys
  stopped working. Fixed: the new switch takes the focus.
- **Minor:**
  - "Back to the library" and "Back to the results" dropped focus to the page. They now
    leave as Escape does: focus returns to what opened the inspection (a row, a result),
    otherwise to the list. An inspection opened from the graph returns focus to the graph
    again, as before M7.3.
  - The list did not keep its place under an inspection. It does now; the column shows the
    inspection from its top.
  - Nodes added for an earlier choice could show again while the next choice loaded. The
    expansions are now always keyed.
  - After a failed re-read, the error and the last graph shared one grid cell, and the
    canvas collapsed. The error now lies over the canvas.
  - The example questions could be reached only by address. The empty search box now
    offers them; Enter takes one only once the arrows reach it.
  - Forced colours: the new controls lost their edges and their pressed, open and
    highlighted states. They now keep an edge, and their states an outline.
  - Escape, or close, with the upload form open closed the whole library. It now puts the
    form away first.
  - Keyboard focus could land on a node under the controls along the top or bottom. Both
    views now bring it into the free space between them.
- **Removed, unused after the redesign:**
  - a class and a string;
  - the library row's "current" mark, never visible now that an inspection covers the list;
  - the `q` left in the address when the library opens;
  - the `.kn-section` rule the three views used.

**Two failures found while verifying:**
- **The local service refused connections. This is a server bug that M7.3 exposed.**
  - `knowledge-local.spec` failed about one run in ten: "The local knowledge service could
    not be reached" after a reload.
  - Cause, confirmed: the local server kept `socketserver`'s default listen queue of 5.
    When more connections arrive at once than the queue holds, Windows refuses them (Linux
    makes them wait).
  - The RAG Graph opens with five requests at once: the graph, the chosen node's
    neighbours, the document, the library and the status. M7.2's Library view opened three.
  - Bursts from Node, sent the way the dev proxy and Playwright's routing send them:
    - 12 at once: 65 of 240 refused;
    - 24 at once: 230 of 480 refused;
    - with a queue of 64: none.
  - Fixed: `request_queue_size = 64` in `apps/api/local_server.py`, with a backend test
    that connects 24 sockets before the server accepts any. The test failed with
    "connection refused" before the fix.
  - Since the fix: 10 of 10 runs of the local spec (100 tests).
- **The shell's accessibility check on `/knowledge`** failed once in a full run: colour
  contrast on the Graph Memory tab, the provenance tag and the search box.
  - Cause: the check ran axe 300 ms after the app's heading appeared. At that moment the
    Knowledge page was still fading in, because the RAG Graph mounts its 3D view first.
    With eight pages loading at once, 22 of 24 samples were mid-fade, at opacity 0 to 0.92.
  - Fixed: the check now waits for motion to end, as the knowledge and simulation specs
    already do.
  - Not reproduced on demand: a stress run passed 48 of 48 both with and without the wait.

| Check | Result (Windows 11, Node 24.19, Python 3.14.7, Playwright 1.63 Chromium with SwiftShader WebGL) |
|---|---|
| `npm run typecheck` | Pass |
| `npm test` (Vitest) | 181 passed (17 files) |
| `python -m unittest discover -s tests` | 63 passed (new: connections made all at once wait their turn) |
| `npm run e2e` (Playwright) | Five full runs, with 6 opt-in captures skipped each time. Before the review fixes: 232 passed; then 231 passed and 1 failed (the shell's accessibility check on `/knowledge`, above). With every fix: 232 passed, three times. The M7.2 intermittent failures (an Escape under load, the cold server's wheel scroll) did not occur in these runs |
| Knowledge tests | 29 in the knowledge spec, 5 of them new: the page filling the display at 1440 and 390 px with nothing to scroll and no control overlapping another; the library beside the graph; the search box; Help; a phone. Updated: every test written for the views, with no assertion dropped. 10 in the local spec. Repeats: the changed tests (keyboard 3D \| 2D, Back and the list's place, the examples, a document's group) 12 of 12; the local spec 10 of 10 runs after the server fix; the shell's six accessibility checks 48 of 48 |
| `npm run build`, `npm run build:demo` | Pass. Against M7.2: Knowledge chunk 116.78 kB (34.58 kB gzip), 7.28 kB more; its CSS 26.87 kB, 5.75 kB more; 3D chunk 807.09 kB, 0.29 kB more; main JS (930.60 and 936.01 kB) and CSS (107.26 kB) unchanged |

Browser checks (scratchpad scripts) at 1440x900, 1024x768 and 390x844, and beside the
floating workspace at 1280x800. States checked:
- the graph, the library, results, a node, a document from the library;
- 2D;
- Help, Filters, typing in the search box, the empty search box's examples;
- forced colours;
- Graph Memory.

No console errors, and no page overflow in any of them. During a group focus that opens the
panel, frames ran at a median 16.7 ms and a 95th percentile of 83 to 100 ms (M7.2: 66.7 ms),
with three long tasks of 65 to 82 ms (M7.2: two of about 70 ms), as the larger canvas is
reallocated.

Not validated:
- a hardware GPU or the DGX Spark;
- other browsers;
- touch on a real device;
- a real screen reader;
- a library large enough to cut the overview short.

## M7.4: Graph Memory as a full-page timeline (2026-10-17)

The owner's M7.4 specification (the redesign prompt, then two prompts to resume it after
interruptions):
- make Graph Memory a full-page, cinematic memory timeline, as M7.3 made the RAG Graph a
  full-page graph;
- the graph is the workspace: no paragraphs, instructions, permanent filter form, legend or
  key list under it; compact floating search and filters, contextual panels, minimal zoom,
  Fit and Help;
- a deterministic timeline: time across, equipment lanes, records placed by their
  timestamps, a distinct look for each kind, existing relationships only, simulation runs
  recognisable;
- never invent chronological or causal relationships or chain stages; keep timestamps,
  provenance, superseded versions and relationships;
- search across titles, equipment, kinds, dates and ranges, and provenance, not only what is
  on screen;
- a dark gradient, a faint still sky, soft glow and restrained accents, with no continuous
  animation: an industrial operations interface, not a game;
- drag, the wheel towards the pointer, click, Fit, keyboard, reduced motion and touch;
- keep the filters, runs, details and evidence; change neither the RAG Graph nor the memory
  service;
- verify at 1440 and 390 px, compare before and after, and update the documents.

Uncommitted, awaiting the owner's review. No dependency was added. The memory service, its
API and contracts, the demo records and their provenance are unchanged.

**Before** (M7.3's Graph Memory, 1440x900, the workspace docked):
- The tab opened on a lead paragraph, the count, the demo's note, a form of filters (Words,
  Equipment, Provenance, Time, Include superseded versions, Apply), six kind chips and
  Timeline | Graph.
- Timeline was a list of entries by day: its section was 1,529 px tall and the display
  scrolled 907 px.
- Graph started about 410 px down the display: small grey shapes (17 nodes, with equipment
  and run nodes; 32 relationships, with the derived "occurred before" order), names for the
  anchors only.
- On a 390 px phone the page scrolled 2,025 px, and the records took 20% of the display.

**What changed:**
- **The timeline fills the display**, as the RAG Graph does: 87% of it at 1440x900 (1000 x
  718 px; 58% with a record's panel beside it) and 70% on a 390 px phone (366 x 387 px; 200
  px with a panel below it). Nothing scrolls, page or display, and nothing overflows sideways
  in any state checked.
- **Header.** Both tabs' headers now hold the count ("12 current records · 1 superseded
  version · 9 links", with correct plurals). The lead paragraph, the demo's note and the
  rules moved into Help.
- **Layout** (`memory/timeline.ts`, pure and tested):
  - Time runs left to right on an elastic axis, by the records' own timestamps: consecutive
    records are at least 70 units apart, more with the time between them (70 + 40·√hours,
    up to 72 hours). More than three days without records is shortened and marked "≈ N
    days".
  - One lane per equipment item, named with its count; simulation runs have the lane above,
    a dashed notice-blue band over the time each run's records span.
  - Records at the same moment on one lane stack (a superseded version under its
    successor); a record about several items echoes on their lanes.
- **Records** are orbs of one size with their kind's icon and colour (six validated
  colours, `memory/kinds.tsx`), a soft glow, a dashed notice-blue ring for simulation, and
  dashed and dimmer when superseded. A record too near the one before it on its lane steps
  up a tier; where no tier is free, it waits for zoom, counted on the nearest record shown
  ("+2"), whose click zooms in until they stand apart.
- **Links.** Only stored links are drawn, as arcs with an arrow towards the linked record.
  The memory graph's derived "occurred before" edges are gone. The line along a lane is only
  the order in time, and Help says so.
- **Names** come in by importance (the chosen record, hovered, focused, linked, the chain,
  then by kind), each clear of the others, the orbs, the counts and the lane names; the
  chosen record's adds its kind and time. On the demo at 1440 px nine names show at once,
  none overlapping.
- **Choosing.** A record's stored links and the records they join light up; the chain they
  lead on to stays readable; the rest fades. The panel adds the linked chain in time
  ("Linked chain: 7 records"), and a link opens its own panel (what it joins, its phrase,
  when it was stored, "none is inferred"). A run's band or a lane's name shows its records;
  a click on empty space clears.
- **Search** is one combobox over every record (titles, notes, equipment, kind, provenance,
  run, date), not only those shown. It offers a day (the timeline goes there), a range of
  days (a filter), equipment (its lane and records, brought into view), records (choosing
  one centres it), a kind or a provenance (filters), and the service's words filter, which
  is said over the timeline with Clear filters.
- **Filters** are a popover and the legend: kinds with icon, colour and count, equipment,
  provenance, time window, Include superseded versions, Clear filters; the button says how
  many are on. **Record memory** (the local service only) is the one primary action.
- **Moving.** Left-drag pans; the wheel and a pinch zoom towards the pointer; Shift or a
  sideways wheel pans. Timeline | List, +, −, Fit and Help are the canvas's tools. One tab
  stop: Left and Right through time, Up and Down across lanes, Home, End, Enter, Escape, +,
  − and 0, each record announced. With reduced motion the camera jumps.
- **The list** keeps the old timeline's entries, in the workspace, with the same search and
  filters (`?mv=list`). The old `?mv=graph` opens the timeline.
- **Removed**: the memory graph's time layout (`timeLayout`) and its test, Graph Memory's
  old page rules and strings. Shared without change: `useFocusAway` and `useMenu` (to
  `shared.tsx`) and the star sky (to `graph/sky.ts`).

**Recovery.** The session was interrupted twice (API errors). Each time the work was
recovered from the repository: the files were intact, the dev server was still running, and
the scratchpad held the scripts and screenshots. Nothing was redone or reverted.

**Fixed while verifying** (found in the browser checks and the new tests):
- **Major: a click zoomed the camera.** Choosing a record zoomed in until its neighbours
  stood clear, losing the overview. Now only search, the keyboard or a count zoom; a record
  in sight stays where it is.
- **Major: a refit used the previous filters' records.** The timeline refitted as the
  filters changed, before their records arrived. After "Only decisions" and Clear filters it
  stayed zoomed on two records. It now refits once the new records are there, and not after
  an edit.
- **Major: closing the panel moved the timeline by half the panel's width.** A finished
  camera move was compared with its target exactly; rounding left it "in progress", and the
  resize replayed it. Now compared within a tolerance. Also, opening or closing a panel now
  moves nothing (before, the middle time was kept and everything shifted); a chosen record
  the narrower view would leave out of sight comes to the middle.
- **Minor:**
  - A record's panel took the focus again when its data arrived. Someone typing in the
    search box right after choosing a record lost the focus and the list closed.
  - A record's glow took clicks meant for links passing near it. Now the ring's 44 px disc
    takes them.
  - A store with one or two records was fitted at the maximum zoom, so the next record
    landed far off screen. Fit now zooms in at most ×2.
  - An equipment item chosen in search was not brought into view.
  - On a phone: the filters' selects overflowed the popover; day names ran into each other;
    the two run bands overlapped; crowded records were dots touching the orbs; the last
    lane lay under the tools; a "+2" lay under a lane's name; the chosen record could fall
    below the stage when the panel opened under it; a day's name was cut at the right edge.
- **Tests.** The phone's overflow test and the accessibility test were first extended for
  Graph Memory, and then ran past their time limits under the full suite's load. Their new
  checks now have two tests of their own; the originals are as they were.

**Independent review (2026-10-17).** A separate review of the M7.4 code (read only, with
its own browser checks against the dev server) reported eight findings. Each was checked
against the code and is fixed, with a test that fails without the fix:
- **Major: camera decisions read the last frame drawn, not the camera just set or on its
  way.**
  - Opening a record's address (`?kn=memory&mem=…`) ran the fit and "show this record" in
    one pass. The second saw the unfitted camera, so the timeline opened zoomed in.
  - A refit cut short by a choice ended at the old zoom.
  - Two quick presses of Zoom in reached ×1.48 instead of ×1.96.
  - Fixed: every decision starts from where the camera is going, else where it was set.
  - Found while testing the fix: a record 40 px from the edge, where a fit leaves the
    first, counted as out of sight. "In sight" now means its orb is whole.
- **Major: after a pinch, the finger left down panned from the camera before the pinch**,
  undoing the zoom. It now pans on from where the pinch left the view.
- **Major: a stretch of time framed while a panel opened kept the zoom worked out for the
  old width.** Choosing an equipment item in search left its first and last records out of
  frame. The framing is redone for the new width, also when the panel arrives after the
  camera does. Widening (closing a panel) still moves nothing.
- **Minor:**
  - Tabbing into the timeline could focus a record out of sight. It now comes into view.
    The tab stop also follows a new choice: it was the last record travelled to, even
    after another was chosen by search.
  - Keys with Ctrl, Cmd or Alt were taken. That included the browser's zoom (Ctrl with +,
    − or 0, which text resizing relies on) and Alt+Left (Back). They are the browser's
    again.
  - Up and Down stopped at a lane holding only echoes of records on other lanes. They now
    pass over it.
  - "Go to …" a day did nothing in the list. The list now scrolls to that day, or the
    nearest earlier one.
  - In forced colours, the date row and the run names kept the dark theme's colours,
    about 2:1 on a light system background, because SVG fills are not forced. The
    timeline now sets system colours itself: text and orbs, grey lines, the highlight for
    the choice and the focus.
- **Found while checking these fixes** (a phone, a record chosen by its address):
  - The chosen record's linked records had been waiting for zoom. The choice draws them,
    so with no zoom on choosing they lay on top of one another. Choosing now zooms until
    they stand apart, if the chosen record or one linked to it waits; the check uses the
    zoom the camera is going to. On a desktop nothing waits, so a click still moves
    nothing.
  - On a short display the lanes scroll; the run bands above them were drawn over the date
    row. The drawing is now clipped to the lanes' area.
- **Checked and sound** (the review's words, verified):
  - Only stored links are drawn. The chain follows stored links only, never supersession.
  - The lane's line joins only its current records.
  - No backend, contract or fixture changed.
  - The RAG Graph only lost the helpers that moved, unchanged.
  - Records waiting for zoom get no links, names, echoes or run threads.
  - No NaN in empty, single-record, superseded-only or no-equipment layouts.
  - Per-frame work is acceptable at the 120-record cap: tiers and counts are O(n²), and
    `declutter` makes about 170,000 comparisons.
  - With reduced motion the camera jumps.

**Full-suite runs, in order.** Every failure was read and either fixed or traced:
1. 236 passed, 3 failed.
   - Two were the extended tests running past their time limits; their new checks were
     split out.
   - One was Escape not closing the equipment inspector. That is the intermittent Escape
     failure under load recorded since M7.2 (decision 20); it passed 3 of 3 alone.
2. 240 passed, 1 failed: the shell's accessibility check found no heading on
   `/equipment/chiller_plant_2` in 5 s under load; 66 of 66 alone.
3. 242 passed, 1 failed: after the review fixes, the local spec's restart test, at the
   library row after the service restarted (before its memory step); 30 of 30 alone.
4. 243 passed, 1 failed: the phone overflow test (six pages, four of them drawing in 3D)
   passed its 30 s budget. It is now `test.slow()`; 3 of 3.
5. and 6. 242 passed with 2 failed, then 239 with 5, across unrelated pages. The dev
   server's module graph had gone stale after many hot reloads ("Failed to fetch
   dynamically imported module"). Touching `vite.config.ts` restarted it in place, with
   no change to its content.
7. 243 passed, 1 failed: the new pinch test read its zoom while the last moves were still
   arriving. It now waits for the pinch's own result; 6 of 6.
8. 243 passed, 1 failed: Escape on a KPI's details panel, the same intermittent as run 1;
   48 of 48 alone.
9. and 10. On the final code: **244 passed, 0 failed, 6 opt-in captures skipped, twice.**

| Check | Result (Windows 11, Node 24.19, Python 3.14.7, Playwright 1.63 Chromium with SwiftShader WebGL) |
|---|---|
| `npm run typecheck` | Pass |
| `npm test` (Vitest) | 187 passed (18 files). New: `timeline.test.ts` (7). Removed: the memory graph's time layout test (1) |
| `python -m unittest discover -s tests` | 63 passed (no backend change) |
| Knowledge tests | 41 in the knowledge spec: 29 before, the memory graph's test replaced by 13 (the display at 1440 and 390 px, the timeline, choosing and the chain, a link, search, the keyboard, the list, a phone, the phone's overflow, accessibility, a record's address, touch, forced colours). 10 in the local spec, its memory test on the timeline. Both specs: 51 of 51 on the final code |
| `npm run e2e` (Playwright) | 250 tests. Final code: 244 passed and 6 skipped, twice (above) |
| `npm run build`, `npm run build:demo` | Pass. Against M7.3: Knowledge chunk 154.48 kB (47.76 kB gzip), 37.70 kB more; its CSS 32.28 kB, 5.41 kB more; 3D chunk 806.28 kB, 0.81 kB less (the sky now shared); main JS 930.61 and 936.02 kB, 0.01 kB more (one address parameter); main CSS 107.26 kB, unchanged |

Browser checks (a scratchpad script) at 1440x900 and 390x844, in these states:
- the timeline, and the old `mv=graph` address;
- a record chosen;
- a superseded record, outside the filters;
- typing in search;
- Filters and Help;
- a "+n" count clicked.

In none of them: page or display scroll, overflow sideways, a control over another, names
over one another, or console errors. On the demo at 1440 px, nine names show at once. The
screenshots before and after are in the session's scratchpad (`m74/before/`, `m74/a9/`,
`m74/a10/`).

Not validated:
- a real touch device (the pinch is tested with synthetic touches);
- a real screen reader;
- other browsers;
- a hardware GPU;
- a memory store with hundreds of records.

## M7.5: Graph Memory as a constellation in 3D (2026-10-17; reviewed and finished 2026-10-26)

The owner's M7.5 specification ("Immersive 3D Graph Memory Redesign", 2026-10-17), after
finding M7.4's timeline "too basic, flat, and small":
- an immersive 3D memory constellation filling the Knowledge workspace, comparable to the RAG
  Graph; a visual and interaction redesign, not a change to the memory data model; every M7.4
  function kept;
- no empty space: frame the actual records, spread the equipment groups through the height,
  centre them, frame again when the view or the details panel changes, no page scroll;
- no grid (no time lines, lane lines or chart structure): a dark spatial background, soft
  light, sparse stars, depth cues, curved links; chronology and grouping still readable, with
  compact date markers;
- 3D spheres with shading, glowing edges, a colour per kind, hover and selection, a gentle idle
  motion and readable labels; simulation records and superseded versions told apart; restrained
  differences that imply no severity the data does not hold; non-colour cues;
- deterministic positions (time left to right, groups by equipment, stored links only, stable
  across reloads, nothing fabricated);
- cinematic focus: a click flies to the sphere, emphasises it and its stored links, keeps
  linked records in view, fades the rest and opens the panel; closing flies back to exactly the
  previous camera; rapid clicks and interrupted flights without glitches;
- left-drag pans, right-drag turns, the wheel zooms to the pointer, Fit, Escape, search flies;
  touch, keyboard and reduced motion;
- reuse the RAG Graph's 3D stack with a layout of its own, no new dependency, the RAG Graph
  unchanged; responsive, no needless scene rebuilds, a WebGL fallback, usable on a phone;
- verification at 1440x900 and 390 px with screenshots of seven states.

Four prompts resumed it after interruptions (one on 2026-10-25, three on 2026-10-26). They added:
recover the state from the repository, never restart; a fresh independent review; investigate
the WebGL fallback and the workspace timeout (raised from 5 to 15 s by an earlier session);
investigate whether a choice rebuilds the links and arrows in three-forcegraph, fix it through
public APIs only and measure; assess the bundle-size warning; run the full suite twice on the
same final code.

Uncommitted, awaiting the owner's review. No dependency was added (three.js is imported directly
but installed through react-force-graph-3d: decision 29). The memory service, its contracts,
records and provenance are unchanged; the RAG Graph only takes helpers moved to a shared file.

**Before** (M7.4's timeline, measured on the same build, `?kn=memory&mv=timeline`): orbs of one
size on lane rules under a date row. At 1440x900 its records span 95% of the stage's width and
64% of its height. At 1920x1080 the lanes keep their height, so the records take 46% of the
height with 32% empty below: the owner's "concentrated in the upper half". On a 390 px phone it
draws 6 of the 12 records; the others wait for zoom.

**What changed** (`DESIGN.md` describes the constellation in full):
- **Graph Memory opens in 3D** (`memory/MemoryConstellation.tsx`, a lazy chunk sharing the RAG
  Graph's 3D library chunk). The timeline (`mv=timeline`) and the list (`mv=list`) stay as
  views; the old `mv=graph` and `mv=3d` open the constellation. Search, filters, the column
  and the address are shared by the three views.
- **Layout** (`memory/constellation.ts`, pure and tested): time runs left to right on the
  timeline's elastic axis, each equipment item is a group spread down the view to the
  display's shape (0.6 as tall as wide on a desktop, square on a phone) at its own depth. Each
  record sits as near its group's line as it can without covering an earlier one from the
  front, never past the middle between groups; same-moment records stack under one another;
  no two spheres ever meet. Dates below, group names at the left, run names above their
  records, quiet stretches marked "≈ N days".
- **Spheres**: lit spheres in their kind's colour with its icon, an additive edge glow and a
  halo; a sphere grows a tenth for each stored link (up to half again), never with its kind;
  a notice-blue ring for simulation records; a smaller ghost under a fine mesh for a superseded
  version.
- **Links**: stored links only, as arcs each bowed its own way, with an arrow towards the
  linked record. Choosing recolours them (lit, chain, faded) and enlarges the lit arrows.
- **Space**: the dark gradient, 1,100 still stars far away, a faint haze round each group, a
  fog for depth. No grid, lane or axis.
- **Choosing** flies the camera (500 ms, 650 ms to or from the whole) to the record and what
  its links join; the chosen sphere grows and takes a ring, the rest fades to 14%. Closing
  flies back to exactly where the camera was before the first choice, framing what it framed
  then. Groups, runs, links and days frame their records.
- **Drawing on demand**: nothing is drawn while no one is about. For 45 s after the last
  interaction the spheres drift very slightly at 30 frames a second, on a graphics processor
  only (not with reduced motion, not in software rendering).
- **Fallbacks**: without WebGL, after a lost graphics context, or when the 3D view cannot start
  (its context or its code fails), Graph Memory shows the timeline with a sentence saying which;
  in high-contrast mode it opens on the timeline, 3D staying a choice.
- **Shared, unchanged in behaviour**: the RAG Graph's vector helpers, camera types, `canDraw3d`,
  `ThreeGuard` and pointer helpers moved to `graph/scene3d.tsx` (new: `drawsInSoftware`);
  `graph/three.d.ts` types the parts of three.js used directly.

**After** (`?kn=memory`, the same build, a hardware GPU): the same 1000x718 stage (87% of the
display at 1440x900). The spheres span 71% of its width and 62% of its height, with the group
names to their left and the dates below them. The framing keeps room for both and is bound by the
height at this shape. At 1920x1080 the spheres take 63% of the height (the 21% below holds the
dates and the controls' band). On a phone all 12 records are drawn, spanning 56% x 61%. In no
state checked does the page or the display scroll, does anything overflow sideways, or do names
overlap.

### Rendering: what a choice rebuilt, and the fix

Read in the installed `node_modules/three-forcegraph/dist/three-forcegraph.mjs` (1.43.6, under
react-force-graph-3d 1.29.2, 3d-force-graph 1.80.1, three-render-objects 1.43.0 and three
0.186.1) and measured in the browser. The scene is captured through three.js's devtools hook;
the library tags its objects (`__graphObjType`, `__linkThreeObjType`).
1. **What a choice changed.** Before the fix: `linkWidth` (wider lit links), `linkColor`,
   `linkDirectionalArrowLength` (no arrow on faded links) and `linkDirectionalArrowColor`, each
   a new accessor on every choice (and, between the second and third reviews, `nodeVal`). Now:
   `linkColor`, `linkDirectionalArrowColor`, `linkDirectionalArrowLength` and
   `showPointerCursor`. `linkWidth` is a constant 0 and `nodeVal` a constant accessor;
   `graphData` never changes on a choice.
2. **What invalidates the link mapper.** A changed `linkThreeObject`, `linkThreeObjectExtend` or
   `linkWidth` clears it (line 901), compared by identity, so a new width accessor rebuilds
   every link object. Node objects are cleared only by `nodeThreeObject` or
   `nodeThreeObjectExtend` (line 831).
3. **Arrows.** The arrow mapper digests the links whose arrow length is not 0. A length that
   went to 0 and back removed and re-made the arrow; colours are set on the arrow's own material
   in place. A changed length replaces the arrow's cone geometry and disposes the old one (line
   1017).
4. **Particles** are not enabled (`linkDirectionalParticles` unset); their digest (line 1026)
   does not run.
5. **Allocations.** Each link update builds its colour-material cache afresh. A recolour
   therefore makes one `LineBasicMaterial` per distinct colour and disposes each link's previous
   material (line 990). Arrow cones are made per changed length.
6. **Shared resources.** A disposed link material shared by other links is re-initialised by
   three.js on its next use: harmless. When nodes are removed (a new set of records), the
   library's `deallocate` also disposes the geometries and textures the spheres share (the
   unit sphere, the glow, the ring, the kinds' icons); three.js uploads them again. That is rare
   and is recorded as a limit.
7. **Is rendering the bottleneck?** Not on a graphics processor. In headless Chromium on this
   machine's AMD Radeon 860M (ANGLE D3D11, vsync off), the constellation drew 794 frames a second
   at 1000x718 (485 at device pixel ratio 2), the RAG Graph's 3D view 678 (394). In software
   (SwiftShader, as the test suite runs), a constellation frame cost 274-278 ms of the GPU
   process's processor time; each effect was measured by leaving it out:
   - multisampling, 54%;
   - the edge shells, about 30%;
   - the hazes, about 14%.

   Several workers drawing continuously starved the machine. The owner's preliminary 17-22
   frames a second come from that setting.
8. **Public APIs only**: the accessors above, `rendererConfig` (multisampling off in software),
   custom node objects whose materials the app changes in place, `pauseAnimation` /
   `resumeAnimation`, and `renderer()`, `scene()`, `camera()`, `controls()`. Nothing in
   `node_modules` was edited and no private state is read.

**The fix.**
- Every link keeps one width (a line) and keeps its arrow. A choice only recolours them, and the
  lit arrows grow from 5 to 10. A version's link to the one it superseded has an arrow only
  while lit: the one arrow that still comes and goes, when superseded versions are shown.
- `nodeVal` reads each sphere's live animated scale. Arrows end at the surface as drawn, growing
  with a choice or under the pointer, and a choice no longer re-digests the nodes.
- Where WebGL is drawn in software, the scene goes without multisampling, the edge shells, the
  hazes and the drift.

Measured over ten choices and ten clearings at 1440x900 (`churn.mjs` in the scratchpad):

| | Before | After |
|---|---|---|
| Link objects made (choices / clearings) | 90 / 90 | 0 / 0 |
| Arrow objects made | 0 / 48 | 0 / 0 |
| Sphere objects made | 0 / 0 | 0 / 0 |
| Link and arrow geometries made | 132 / 180 | 22 / 22 |
| Link and arrow materials made | 26 / 58 | 26 / 10 |
| Click to arrival, GPU (ms) | 606-799 | 590-795 (two runs) |
| Longest frame in a flight, GPU (ms) | 17-183 | 17-50 |
| Click to arrival, software (ms) | 877-1142 | 713-937 |
| Longest frame in a flight, software (ms) | 67-117 | 33-67 |
| Processor time per frame, software (ms) | 274-278 | 96 |

"After" is the final drawing code; the fourth review's fixes, made later, change only how a
press is read. The same fix measured earlier in the day gave 580-628 ms and 17-33 ms on the GPU:
timings vary by about 50 ms between runs on this shared machine, while the object counts are the
same in every run.

The remaining geometries are the lit arrows' cones (5 to 10 and back), and the materials come
from the library's per-update colour cache; each replaced one is disposed. Click to arrival runs
from the press to the end of the flight, which is 500 ms itself. Idle on the GPU: 30 frames a
second while drifting, then none 45 s after the last interaction; with reduced motion none at
all. These numbers come from one integrated GPU and from SwiftShader in headless Chromium. No
discrete GPU, phone or other browser was measured.

### The WebGL fallback and the workspace timeout

- **The stall.** The earlier no-WebGL failure (the Knowledge heading shown, "Loading Knowledge…"
  past 5 s) was the whole machine starved, not a loading defect. The test itself draws no 3D,
  but other workers drew in SwiftShader continuously (the drift, at 274-278 ms of processor time
  a frame), and the dev server's module transforms and the page waited.
  - Measured with `loadtime.mjs`: alone, the workspace appeared 0.64-0.85 s after navigation,
    with WebGL or without.
  - With six pages loading at once while others drew, it took 23-39 s, with or without WebGL.
    A 15 s limit would not have covered that, and would have hidden a workspace that never came.
  - After the software-rendering changes above, nothing draws in software while no one is about.
    The suite then ran with no workspace timeout at 5 s, and `open()` is back to its original
    5 s, as at HEAD.
- **Verified** (`fallback.mjs`, final code), each reaching the timeline with its own sentence,
  with search, choosing a record, its panel and the list working:

| Case | Timeline shown after | Says |
|---|---|---|
| No WebGL | 907 ms | WebGL is unavailable (3D disabled in the switch) |
| WebGL passes the probe, the renderer's context fails | 1,354 ms | the 3D view could not start |
| The 3D chunk fails to load | 1,430 ms | the 3D view could not start |
| Graphics context lost while shown | 1,709 ms | the 3D view stopped |

- Before, a failure to start said "lost its graphics context". The two notes are now told apart
  (`failedStart`). Two e2e tests cover them: without WebGL (with search, a choice and the list),
  and a lost context, a failed chunk and a failed context.

### Bundle size

The over-500 kB warning predates M7.5: the main bundle has exceeded the limit since M6, the 3D
chunk since M7.1. M7.5 added nothing to the main bundle and nothing loaded eagerly:
- main JS 930.61 kB (production) and 936.02 kB (demo), the same as after M7.4;
- the shared 3D chunk (three.js with react-force-graph-3d) 801.70 kB (209.75 kB gzip), 4.58 kB
  less;
- the constellation's own chunk 30.10 kB (11.88 kB gzip). It imports three.js from the shared
  chunk (no copy), and is requested only when the 3D view renders (`lazy`), so not without WebGL
  or for the timeline and the list;
- the Knowledge chunk 159.27 kB (49.21 kB gzip), 4.79 kB more; its CSS 33.53 kB, 1.25 kB more;
  main CSS 107.26 kB, unchanged.

No restructuring was made for the warning.

### Independent reviews

Four separate reviews, read only, each with its own probes. Every finding was checked against
the code; each confirmed one is fixed and, where it could regress, tested.

**First review (2026-10-25)**, of the code as built on 2026-10-17:
- **Major: records close in time stepped out without limit** and landed in another group's
  space (four hourly records: the fourth nearer the next group's line).
  - Fixed: a new placement (each record as near its line as it can without covering an earlier
    one, within the middle between groups).
  - Tests: bursts and 300 crowded random sets.
- **Major: after the first close, a resize never framed again** (the restored placement was an
  unknown "home"). Fixed: the placement is saved with the camera and restored with it. Test:
  resize after a close.
- **Minor:**
  - A click on empty space during a flight called `showChoice()`: a double click to close left
    the camera part way. Rewritten (see the second and third reviews).
  - Stacked records ignored their links' size. Fixed and tested.
  - A ring's turn was invisible (it turned about its own axis). Removed.
  - Every choice rebuilt every link (above). Fixed and tested.
  - The drift worked out every look at 60 frames a second while drawing 30. Skipped on undrawn
    frames.
- **Gaps closed:** a lost context and a failed start had no test, nor a resize after a close or
  a click during Fit; `VERSION_A.md` lacked this section.

**Second review (2026-10-26)**, after those fixes:
- **Major: a press counted as moving the view.** OrbitControls says "start" for every press.
  After a sphere click, the restored placement was "free" and the overview never re-framed.
  Fixed: only a pointer that moves more than 3 px (or the wheel on the canvas) takes the camera
  over.
- **Major: a flight's own camera moves were read as the person's**. On a sleeping GSAP ticker,
  a press during a flight then cleared the flight's destination. Fixed by the same change: the
  controls' events no longer decide anything.
- **Minor:**
  - In bursts the fallback height could still overlap in 3D on phones (4.5% of random sets).
    Fixed: a record stands behind whatever it covers, far enough that no two spheres meet. Phone
    groups are at least 10 radii apart. Test: 300 random sets.
  - A slow window drag (under 8 px per frame) never re-framed. Fixed: the size is compared with
    the size at the last framing.
  - Arrows hid inside a chosen sphere that grew. Fixed: arrows end at the grown surface.
  - Faded links took clicks. Fixed: a click on one is a click on empty space.
  - Stale comments. Fixed.

**Third review (2026-10-26)**, of the press rework:
- **Medium: a click during a flight was resolved when the button came up.** The library takes
  its click target from a look under the pointer at most every 50 ms and fires it a frame after
  the release; the scene had moved on. In its model of the demo, a press of 50-100 ms on a
  sphere mid-flight found nothing in up to two thirds of cases (67 of 99 on the way to
  mem_demo004) and another record in a few (6 of 99). A second click on the chosen sphere
  restarted the flight from rest.
  - Fixed: the press takes the record under the pointer in the last frame drawn (`recordAt`, a
    pick by projected centre, reach and depth). A click made while flying counts for that, or
    for nothing: the flight goes on, and is not restarted by its own record.
  - Test: a press held 200 ms on the fastest-moving sphere, a second click on the chosen one,
    with the page's clock held. It fails on the old handling, as checked by putting the old code
    back for a run.
- **Low:**
  - The press was kept after the release, for any pointer. A drag starting outside the view
    (selecting the panel's text) took the camera over, and a second finger replaced the first.
    Fixed: each pointer is tracked from its press to its release or cancel, wherever that is.
    Tested, and checked to fail without it.
  - The double-click test could not fail. It is now a real double click on a running flight.
  - The slow-resize test could merge its steps into one. It now waits two frames between them,
    and fails with the old comparison.
  - Untested: right-drag, the wheel over a name, a drag from a name, and nodes in the rebuild
    count. New test: the constellation moves like a map, and a drag or the wheel stops a
    flight. The rebuild test counts spheres too.
- **Nits, fixed:** a stale comment; the links' key did not change for an equipment choice with
  no records shown, so the links did not fade; arrows jumped ahead of a growing sphere and hid
  under a hovered one (now `nodeVal` reads the live scale).

**Fourth review (2026-10-26)**, of the third review's fixes. It found fixes 2 to 4 sound (press
tracking, the links' key, the live `nodeVal`), confirmed the new tests fail for the reasons they
state, and found:
- **Medium: a double click on a sphere could end on another record.** The second press lands
  100-200 ms into the flight the first click started, where another sphere may have moved under
  the pointer. In the demo, a double click on mem_demo001 ended on mem_demo007, and one on
  mem_demo003 on mem_demo009. This was not new: the library's own pick found the same.
  - Fixed: a press within 500 ms of the last and within 6 px of it (30 px for touch) chooses
    nothing new while the camera flies.
  - Test: the double click is checked on mem_demo020, mem_demo001 and mem_demo003. Without the
    fix, mem_demo001 ends on mem_demo007.
- **Low: the in-flight pick let a nearer record's click area win over the sphere drawn under
  the pointer.** At close range a record's reach can lie over a grown chosen sphere; early in a
  flight to mem_demo004, a press on its drawn sphere chose mem_demo003.
  - Fixed: `pickAt` (`constellation.ts`) takes a sphere drawn under the point first, then a
    click area, nearest first.
  - Unit test added.
- **Low, from the library: after a drag that starts outside the view and crosses it, the next
  click was lost and nothing showed under the pointer.** three-render-objects marks any move
  with a button held over its canvas as its own drag, and clears that only for a press that
  began there.
  - Fixed: moves of a pointer pressed elsewhere are kept from the library.
  - Test: after such a drag, a sphere under the pointer says so and a click chooses it; without
    the fix, nothing shows under the pointer.
  - The RAG Graph's 3D view still behaves this way (decision 32).
- **Nit, fixed:** a press took the camera over at 3 px but a drag from a name began at 4 px. A
  3-4 px slip on the chosen record's name stopped its flight for nothing; both are now 4 px.

### Results

**Full-suite runs, in order.** Every failure was read and traced:
1. 2026-10-26, before the third review's fixes: 248 passed, 2 failed, 9 did not run, 6 skipped.
   - The local spec's "real mode shows the local service" expects "PDF not configured", but
     pypdf 6.21.2 was installed on this machine on 2026-10-25, not by this work (decision 31).
     The spec's serial mode then skipped its nine other tests. They pass when that test is left
     out, 9 of 9.
   - Escape on a KPI's details panel: the intermittent under load recorded since M7.2
     (decision 20); 3 of 3 alone.
2. The knowledge spec after the third review's fixes: 57 of 58, then 58 of 58.
   - The one failure: the phone overflow test's six navigations. In one, the app's own heading
     did not render within 5 s while the other workers drew 3D in software; it passed 3 of 3
     alone.
   - Found while making the new tests: they read the camera as "back" before a flight had
     begun, or pressed a sphere that the move was not carrying. Fixed in the tests (wait for
     the camera to leave, pick the fastest sphere). The app was checked separately, with and
     without load, and returned exactly.
3. On the final code, after the fourth review's fixes, twice:
   - 251 passed, 1 failed, 9 did not run, 6 opt-in captures skipped. The failure is the pypdf
     test (decision 31); the local spec's serial mode then skips its nine others, which pass 9
     of 9 without it.
   - 249 passed, 3 failed, 9 did not run, 6 skipped: the pypdf test again, and two failures
     under load in code M7.5 did not change, each 5 of 5 alone.
     - The RAG Graph's keyboard test: Escape pressed as its panel appeared was not seen, the
       recorded race in the shared `useEscapeLayer` (decision 20).
     - AI Pilot's reload test: 5 s after its link was clicked, the Engineering page had not
       loaded and the Overview was still shown. The phone test's heading was slow in the same
       way in run 2.

| Check | Result (Windows 11, Node 24.19, Python 3.14.7, Playwright 1.63 Chromium with SwiftShader WebGL) |
|---|---|
| `npm run typecheck` | Pass |
| `npm test` (Vitest) | 198 passed (19 files). New: `constellation.test.ts` (11) |
| `python -m unittest discover -s tests` | 63 passed (no backend change) |
| Knowledge tests | 58 in the knowledge spec: 41 before, 17 new for the constellation. On the final code, 58 of 58 in the first full run and 57 of 58 in the second (the RAG Graph's Escape race, above). 10 in the local spec: 9 of 9 without the pypdf test |
| `npm run e2e` (Playwright) | 267 tests. Final code, twice: 251 passed and 1 failed (pypdf), then 249 passed and 3 failed (pypdf, and two failures under load that pass 5 of 5 alone); each time 9 did not run (the local spec's serial mode) and 6 opt-in captures were skipped |
| `npm run build`, `npm run build:demo` | Pass, with the existing over-500 kB warning; sizes above |

Browser checks on the final code at 1440x900 and 390x844 (`shots.mjs`, a hardware GPU), in
these states:
- the overview;
- a sphere under the pointer;
- a record whose links span the constellation (mem_demo004) and one with near links
  (mem_demo016);
- the linked chain (mem_demo007, from its address);
- a search result ("fan fault");
- a record closed, and the camera restored;
- a group (Cooling tower 4);
- superseded versions shown;
- the timeline, Filters and Help.

The overview, a choice and the restored camera were checked again in software.

In none of them: page or display scroll, names over one another, or console errors. The camera
after closing matched the camera before the choice exactly, on both sizes and in software. On a
phone with a record chosen, its ring touches the search box (a recorded limit). The screenshots
and the measurements (`shots.log`) are in this session's scratchpad, which is temporary:
`C:\Users\Crusher1\AppData\Local\Temp\claude\c--Users-Crusher1-Documents-HVAC-hvac-agent\d74a6fd3-c96b-4b98-997e-b2273c6f041e\scratchpad\m75r\`,
folders `final3-gpu\` and `final3-software\`, with `cover-final.log` for the before and after.

Not validated:
- a discrete or mobile graphics processor (only this integrated one) or software rendering
  outside headless Chromium;
- a real touch device (touches are synthetic), a real screen reader, other browsers;
- a memory store with hundreds of records (the layout and the pick reach are O(n²), fine at the
  120-record cap).

Known limits are listed in `M6_HANDOFF.md` section 9b. Open decisions 28-32 are there too:
approving the constellation; declaring three.js; the drift; the pypdf test; the RAG Graph's drag
from outside.

## M7.6: the memory graph's name, and its icons in 3D (2026-10-26)

The owner's M7.6 request, after looking at the constellation:
- show "Graph Memory" as "memory graph" in the interface: the tab, headings, labels, help. Keep
  `kn=memory`, the memory API and contracts, module names and the test setup;
- investigate why some icons on the 3D spheres look tiny, distorted or awkwardly placed:
  crossed by an outlined ellipse on a simulation record, competing with links, and an event's
  icon like a compressed waveform. Fix the cause, keep every M7.5 interaction, leave the RAG
  Graph unchanged.

Uncommitted, awaiting the owner's review. No dependency was added.

**The name.** The tab reads "Memory graph": the words asked for, in the sentence case
`DESIGN.md` prescribes ("Sentence case everywhere"). Mid-sentence it is "the memory graph".
- Changed: the tab; the view switch's label ("Memory graph view"); the high-contrast note;
  Help's title ("Reading the memory graph") and its heading "What the memory graph stores".
- Unchanged: `kn=memory` and every address, the memory API and contracts, module and
  component names. Code comments and test titles keep "Graph Memory" as identifiers, and so
  do these notes for the feature's history.
- A test checks the tab's text, and that "Graph Memory" appears nowhere on the page.

**What was wrong with the icons, and why.** Investigated in the browser on a hardware GPU, the
scene read through three.js's devtools hook; the before and after shots are listed below.
1. **The ellipse through the simulation records' icons** was the simulation ring. It was a
   torus of 1.62 radii tilted about 68° (rotation 1.18, 0.32, 0), so its near half passed
   between the camera and the icon. Hiding the scene's two torus meshes removed the ellipse
   and nothing else: it was not a selection ring, a link or an arrow.
2. **Icons broken, eaten or sheared in the overview, and flickering**, came from two depth
   problems. The icons were where they should be: measured within 0.1° of the line from
   their sphere to the camera.
   - The library's camera keeps three.js's default near plane, 0.1 (three-render-objects sets
     only the far plane, 125,000). The depth buffer has 24 bits; at the overview's distance
     (about 2,660 units) it resolves about 4 units (z² / (near · 2²⁴)). Each icon sat 0.04
     radii (1.6 units) in front of its sphere, so they fought for depth. As the drift moved
     the spheres, the lost pixels changed frame by frame: one eye, every 500 ms for 6 s, was
     broken in 6 of 13 frames (a crescent, a "C", a cut side). Close up (600-900 units) the
     depth was fine, which is why a chosen record looked right.
   - An icon faces the screen, not its sphere. On a sphere away from the middle of the view,
     the icon's far side dipped into the sphere and was cut, for the same small lead.
3. **Small icons:** an icon took about 30-40% of its sphere's width (a sprite of 1.1 radii, the
   icon in 72% of a 128 px texture, thin strokes). The 128 px textures, the chosen ring's
   included, blurred close up.
4. **The event's "compressed waveform"** is lucide's Activity, a pulse line, mapped as intended
   and not a fallback. On a sphere its long baseline and narrow spikes read as a squiggle.
5. **Links over icons:** icons were drawn before links (render order 2 against the library's
   10), so a link crossing a sphere crossed its icon.

**What changed** (`MemoryConstellation.tsx`; `kinds.tsx`; the strings):
- The camera's near plane is 10. Depth then resolves 0.04 units at the overview and 2.4 at
  the farthest zoom; nothing nearer than 10 units to the camera is drawn.
- An icon sits 0.2 radii in front of its sphere, enough for a sphere at the corner of the view.
- An icon is about half its sphere across: a 1.5-radius sprite, the icon in 200 of 256 px,
  stroke 2.4.
- Icons are drawn after the links (render order 20). A link crossing a sphere passes under its
  icon; a sphere in front still hides it.
- The rings face the screen, so they circle the sphere and never cross its icon. Both come
  from 256 px textures.
  - A simulation record's ring is a dashed notice-blue circle at 1.22 radii, as on the timeline.
  - The chosen record's laminate ring is at 1.45 radii, outside it.
  - The torus is gone; the 3D chunk is 1.07 kB smaller.
- An event's icon is a bolt (Zap), in every view: 3D, timeline, list, filters and the panel.
- Help says "A dashed blue ring…".

**Verified on the final code:**
- The same eye, over the same 6 s: whole in 13 of 13 frames.
- Every icon is whole, upright and centred in the overview at 1440x900 (checked at full
  resolution) and on a 390 px phone.
- The ellipse is gone, and the rings are concentric with their spheres.
- The chosen, linked-chain and search states look right in 3D, and the bolt reads in the
  timeline and the Filters legend.
- No console errors.

| Check | Result |
|---|---|
| `npm run typecheck` | Pass |
| `npm test` (Vitest) | 198 passed (19 files) |
| Knowledge spec | 58 of 58 |
| `npm run e2e` (Playwright) | 267 tests, twice: 251 passed and 1 failed each time, the pypdf test (decision 31); 9 did not run (the local spec's serial mode) and 6 opt-in captures were skipped. The local spec without the pypdf test: 9 of 9 |
| `npm run build`, `npm run build:demo` | Pass, with the existing over-500 kB warning. The 3D chunk is 800.63 kB, 1.07 kB less; the constellation's chunk is 30.22 kB; the Knowledge chunk is 159.51 kB, 0.24 kB more (the bolt) |

Before and after, in this session's scratchpad (temporary):
`C:\Users\Crusher1\AppData\Local\Temp\claude\c--Users-Crusher1-Documents-HVAC-hvac-agent\d74a6fd3-c96b-4b98-997e-b2273c6f041e\scratchpad\m76\`.
- `before\` and `after\` hold the same shots from `icons.mjs`, at 1440x900 with 2x pixels:
  - `overview.png`, the initial constellation, cropped at full resolution in `crop-*.png`;
  - the simulation records `overview-009.png` and `overview-016.png`;
  - a normal record, `overview-004.png`, and every other record;
  - chosen records, `chosen-016.png` (simulation), `chosen-004.png` and `chosen-009.png`;
  - the linked chain, `chain-007.png`;
  - `phone-overview.png`, and the icon textures, `texture-*.png`.
- `before\chosen-016-without-torus.png` is the proof of what the ellipse was.
- `align-sheet.png` and `align2-sheet.png` show the eye over 6 s, before and after the depth fix.
- `after-2d\` holds the timeline and Filters with the bolt.

Limits:
- Seen very close, an icon looks larger against its sphere, being nearer the camera. At 200
  units from a chosen sphere, about 1.4 times as large as from afar.
- The RAG Graph's 3D view also keeps three.js's default near plane. It was not changed or
  checked for the same breakup (decision 34).
- Real devices, other browsers and a discrete GPU were not checked.
