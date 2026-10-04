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
| M4 | Cooling prediction page, Equipment screen | In progress |
| M5 | AI assistant page and drawer | Planned |
| M6 | Simulation, AI pilot (their mock services move here from M2) | Planned |
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
