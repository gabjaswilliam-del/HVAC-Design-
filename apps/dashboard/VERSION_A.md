# Version A prototype: milestones and acceptance

"Industrial Control Center" fixture prototype, authorized by the owner on
2026-10-04 within `apps/dashboard/` only. All data is synthetic; nothing connects to
the local API, PHYVAC, models or equipment. Version C is a separate, later exercise.

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
| M6 | Simulation, AI pilot (their mock services move here from M2) | Planned; starts only after the owner's localhost review of Treatment A. No Assistant simulation control or action tools (F10) |
| M7 | CAD Studio, Knowledge base, Installation, System | Planned |
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

