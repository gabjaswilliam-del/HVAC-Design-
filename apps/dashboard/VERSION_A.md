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
| M6 | Simulation, AI pilot (their mock services move here from M2) | Built on labelled mock services, 2026-10-06; consolidated revision, the AI Pilot console revision and the live operator and recorded replay correction, 2026-10-07; uncommitted, awaiting the owner's review. The Assistant reads simulations and points to operator controls; it has no control or action tools (F10) |
| M7 | Knowledge workspace: Graph RAG and Graph Memory, with a local knowledge and memory service (Python standard library, SQLite) | Built 2026-10-08/09 at the owner's request; uncommitted, awaiting the owner's review |
| M7.1 | The knowledge graph in 3D (react-force-graph-3d), with the 2D view kept | Built 2026-10-09 at the owner's request; uncommitted, awaiting the owner's review |
| — | CAD Studio, Installation, System (formerly listed under M7) | Planned |
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
- **Navigation**: a rail with Overview (`/`), Analytics (`/prediction`), Engineering
  (`/equipment`, with Simulation and CAD Studio tabs) and Knowledge; System and
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
