---
name: HVAC Agent dashboard
description: An operator's instrument for a data-centre chiller plant. Direction A "Permit" in Treatment A, Graphite (machined bezel).
colors:
  bezel: "#282c32"
  bezel-top: "#30353b"
  bezel-side: "#262a2f"
  display-top: "#25292e"
  surface: "#1a1d21"
  sheet: "#191c20"
  workspace-top: "#1c1f23"
  workspace-bottom: "#181b1e"
  raised: "#24282d"
  hover: "#2c3136"
  press: "#343a40"
  hairline: "#2b2f35"
  hairline-strong: "#41474e"
  control-border: "#7b828b"
  text-1: "#eceef0"
  text-2: "#b3b9c0"
  text-3: "#9ba1a8"
  laminate: "#e9ecef"
  laminate-ink: "#121417"
  laminate-ink-2: "#4a5159"
  danger: "#f0484e"
  warning: "#ff8a3d"
  caution: "#f6c343"
  notice: "#5b93ff"
  ok: "#46d37e"
  cw-hot: "#e0a630"
  cw-cool: "#34b89a"
  chw-supply: "#6c7cff"
  chw-return: "#5ec8e5"
  chart-observed: "#4d8ee6"
  chart-forecast: "#cf7a2e"
  chart-delivered: "#3a9e72"
  chart-capacity: "#8c97aa"
  chart-neutral: "#e9ecef"
  graph-document: "#c8c2b6"
  graph-section: "#6a707a"
  graph-plant: "#20aa8b"
  graph-problems: "#9f8418"
  graph-guidance: "#5e56de"
  graph-space-top: "#181b21"
  graph-space-deep: "#0b0d10"
  graph-star: "#d6e0ef"
  graph-star-warm: "#f2e6d4"
typography:
  page:
    fontFamily: "Barlow Semi Condensed, system-ui, Segoe UI, sans-serif"
    fontSize: "22px"
    fontWeight: 600
    lineHeight: 1.2
  hero:
    fontFamily: "Barlow Semi Condensed, system-ui, Segoe UI, sans-serif"
    fontSize: "24px"
    fontWeight: 600
    lineHeight: 1.1
    fontFeature: "tnum"
  readout:
    fontFamily: "Barlow Semi Condensed, system-ui, Segoe UI, sans-serif"
    fontSize: "19px"
    fontWeight: 600
    lineHeight: 1
    fontFeature: "tnum"
  title:
    fontFamily: "Barlow Semi Condensed, system-ui, Segoe UI, sans-serif"
    fontSize: "16px"
    fontWeight: 600
    lineHeight: 1.2
  prose:
    fontFamily: "Barlow Semi Condensed, system-ui, Segoe UI, sans-serif"
    fontSize: "14px"
    fontWeight: 400
    lineHeight: 1.55
  body:
    fontFamily: "Barlow Semi Condensed, system-ui, Segoe UI, sans-serif"
    fontSize: "13.5px"
    fontWeight: 400
    lineHeight: 1.45
  label:
    fontFamily: "Barlow Semi Condensed, system-ui, Segoe UI, sans-serif"
    fontSize: "12.5px"
    fontWeight: 500
    lineHeight: 1.3
  micro:
    fontFamily: "Barlow Semi Condensed, system-ui, Segoe UI, sans-serif"
    fontSize: "11.5px"
    fontWeight: 500
    lineHeight: 1.3
rounded:
  tag: "6px"
  control: "9px"
  container: "12px"
spacing:
  "1": "4px"
  "2": "8px"
  "3": "12px"
  "4": "16px"
  "5": "24px"
  "6": "32px"
  "7": "40px"
components:
  button:
    backgroundColor: "{colors.raised}"
    textColor: "{colors.text-1}"
    rounded: "{rounded.control}"
    height: "32px"
    padding: "0 12px"
  button-primary:
    backgroundColor: "{colors.laminate}"
    textColor: "{colors.laminate-ink}"
    rounded: "{rounded.control}"
    height: "32px"
  tag-attention:
    backgroundColor: "{colors.laminate}"
    textColor: "{colors.laminate-ink}"
    rounded: "{rounded.tag}"
    height: "24px"
  tag-provenance:
    textColor: "{colors.text-2}"
    rounded: "{rounded.tag}"
    height: "22px"
  readout:
    textColor: "{colors.text-1}"
    typography: "{typography.readout}"
    rounded: "{rounded.control}"
    padding: "4px 8px"
  key-plate:
    textColor: "{colors.text-1}"
    rounded: "{rounded.tag}"
    padding: "2px 7px"
  dock-item:
    textColor: "{colors.text-2}"
    rounded: "{rounded.container}"
    size: "40px"
  dock-item-current:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.laminate}"
---

# HVAC Agent dashboard: design system

Derived from the built implementation in `src/styles/tokens.css`,
`src/components/components.css`, `src/app/app.css`, `src/app/workspace/workspace.css`
and `src/features/*/*.css`, after the owner approved Direction A "Permit" in
Treatment A, Graphite (decisions F1 to F10, 2026-10-05). The product context is in
`PRODUCT.md` beside this file.

## Overview

**The instrument.** The dashboard is one machined object: a satin anthracite bezel with
a fine matte grain, lit from above, holding two charcoal displays, the plant (or the
current page) and the workspace. The bezel carries what frames the work: the top bar,
the dock, the deck and the workspace dock. The displays carry the work itself.

**Permit grammar.** Laminate, the only light material, is used for what asks for a
decision: the attention tag, the selection, the focus ring, the primary action and the
dock indicator. Everything else is graphite and type. Tags say what something is by
their form, not their colour:

- filled laminate: attention (an open issue, hung on its equipment or held in the top bar);
- outline: provenance (Demo data, No language model connected, Offline rules, Simulated
  tool, Mock simulation service, source=simulation, From the recorded run, Synthetic
  plant);
- dashed outline: planned work that is not built (Planned);
- away from the drawing, an issue is a severity mark: an eyelet ring and a word.

**Colour is state, never decoration.** Hue appears only for equipment and data state,
pipe media and chart series, always with a word or an icon beside it.

Operate mode: scanability, honesty and consistency outrank expression. The one
memorable thing is the bezel and its laminate tags; the rest stays quiet.

## Colors

- **Bezel** `#282C32`, top `#30353B`, side `#262A2F`: satin gradients under a 22 kB grain
  tile (`src/assets/grain.png`), lit from above (`inset 0 1px 0 rgb(255 255 255 / .08)`),
  with a dark seam where it meets a display (`rgb(0 0 0 / .7)`).
- **Plant display**: `radial-gradient(120% 80% at 50% 0%, #25292E, #1A1D21 55%, #14171A)`
  with a drawing grid of 200 px at 5% white and 40 px at 2.4%. The grid exists only on
  the plant, which is a drawing surface.
- **Workspace display**: `#1C1F23` to `#181B1E`. Pages: `#1A1D21`. Lists and tables
  on the plant display: sheet `#191C20`.
- **Raised / hover / press**: `#24282D`, `#2C3136`, `#343A40`. Controls on the bezel use
  translucent black instead (`rgb(0 0 0 / .22)` hover, `.32` pressed) so they read as cut
  into it.
- **Lines**: hairline `#2B2F35` (decorative separators only), strong `#41474E`, control
  border `#7B828B` (at least 3:1 on every surface).
- **Text**: `#ECEEF0`, `#B3B9C0`, `#9BA1A8`; each passes AA on every surface it is used on.
- **Laminate** `#E9ECEF` with ink `#121417` (15.6:1) and ink 2 `#4A5159`.
- **Interface safety colours**, for alarm and data state only: danger `#F0484E`,
  warning `#FF8A3D` (orange, kept away from condenser-water amber), caution `#F6C343`
  (stale data, failed tool calls), notice `#5B93FF` (simulation scope, information),
  ok `#46D37E`. A failed assistant tool is caution, never the alarm red.
- **Scene tokens** (`--ink-scene`, `--state-*`, the four pipe media, readout-tag frames)
  are read by the approved equipment artwork and are unchanged since M1. Do not restyle
  the drawing through them.
- **Chart series**: observed `#4D8EE6`, forecast `#CF7A2E` (dashed), delivered
  `#3A9E72`, capacity `#8C97AA`; validated for dark surfaces. A single measurement over
  time (equipment trends) has nothing to tell apart, so it is drawn in the neutral
  `#E9ECEF`; hue is kept for charts with several series.
- **Knowledge graph families** (M7.1): sources in paper `#C8C2B6` (documents) and
  graphite `#6A707A` (sections); plant and process (equipment, components, concepts)
  `#20AA8B`; problems (faults, symptoms) `#9F8418`; guidance (procedures, standards)
  `#5E56DE`. Checked with the dataviz validator on the graph's surface `#1A1D21` with every
  pair side by side, as nodes can be: worst colour-vision separation ΔE 11.3, normal
  vision 15.8, each at least 3:1, and none near the alarm red or warning orange. Nine
  types cannot each keep a colour that stays distinct that way, so colour names the family
  and the shape glyph and the name tell its types apart. They are data categories, like
  chart series, and appear only in the knowledge graph, its legend and its type glyphs.
- **Knowledge graph space** (M7.2): the 3D viewport is a quiet deep space, lit from above
  (`#181B21` falling to `#0B0D10` at the edges) with a faint cool depth (`rgb(70 96 126 /
  .07)`) where the systems float, and the faintest violet and teal hazes (5% and 4.5%) in
  two far corners. Its lightest point (measured `#191E24`, the same with or without the
  hazes) keeps every family colour at 3:1 or more (violet, the closest, at 3.08).
  - **Stars**, still and faint: cool white (`#D6E0EF`, a few warm `#F2E6D4`), radius 0.5 to
    1.35 px against 4 px or more for any node, 20% to 75% opaque, the brightest with a soft
    halo. About 100 in a desktop view, 35 on a phone. Two tiles of different sizes, so the
    pattern never visibly repeats, and the same sky on every visit (a seeded generator).
  - Nothing moves or twinkles. The stars take no events, stay put when the graph is
    dragged (a backdrop, not data) and are left out in forced-colours and more-contrast
    modes.

## Typography

One family, Barlow Semi Condensed (400, 500, 600, 700, bundled), with tabular figures
(`.num`) wherever values update in place. Sizes are a fixed product scale, not fluid:

| Role | Size / weight | Use |
|---|---|---|
| hero | 24 / 600 | the one value in a details header |
| page | 22 / 600 | page and record headings inside a page |
| readout | 19 / 600 | the four top-bar readouts |
| title, section | 16 / 600 | the page name in the top bar (the screen's h1), panel titles, the clock |
| prose | 14 / 400, line 1.55 | assistant answers |
| body | 13.5 / 400 | tables, panels, controls |
| label | 12.5 / 500 | labels, hints, tags |
| micro | 11.5 / 500 | units, axis ticks, readout labels |

Names on the drawing in Key mode are 12 px and key readings 13 px in screen space, at
any zoom; a crowded row (very small windows) scales a name down to 10 px rather than
letting names collide or truncate. Sentence case everywhere; no all-caps labels.

## Layout

- **Shell grid**: columns dock `56px` | display `1fr` | workspace; rows top bar `52px` |
  display | deck `48px`. The top bar spans the width; the deck sits under the display,
  between the dock and the workspace.
- **Workspace**: docked at 1440 px and wider (352 px, resizable 320 to 560, width and
  tab remembered). Below 1440 px it collapses to a 52 px dock and its panel floats at
  352 px over the display; the plant refits beside the panel when it can stay at half
  size or more, otherwise the panel covers part of it, the selection pans into view and
  hung alarms move to the panel's edge. At 760 px and below it is a full-screen sheet.
- **Plant display**: the drawing fills the display edge to edge (fit padding 12 px).
  Only three things float over it, each in an empty corner: the view switch (top left),
  the drawing controls (bottom right, moved left of a floating panel) and the disclosure
  (bottom left). Measured fits: 99.6% at 1920x1080, 69.0% at 1440x900 docked, 80.8%
  collapsed, 67.1% at 1366x768, 70.4% at 1280x800, 61.1% at 1024x768.
- **RAG Graph display** (M7.3): the Knowledge page's RAG Graph fills the display like the
  plant: one slim header row, then the graph to the display's edges (padding 12 px 16 px
  16 px; 8 px 12 px 12 px on a phone) with no page scroll (it scrolls only on a display
  under 440 px tall). Measured: the graph takes 87% of the display at 1440x900 docked
  (before M7.3, 56% was in view and the rest below the fold), 85% at 1024x768 and 75% on a
  390 px phone, where it fills the display between the top bar and the deck. What is
  browsed or inspected opens in one column beside it (32% of the display, 300 to 400 px),
  or under it (at most 55% of the height) when the display is under 720 px wide; the
  graph resizes into the room left.
- **Pages** pad 22 px 26 px and scroll inside the display, and open at their top; the
  Engineering hub is one column of flat sections separated by hairlines (max 980 px),
  records a two-column grid of cells (one column at 1180 px and below). Simulation history
  and the Simulation replay lay out by the display's own width (container queries, since a
  docked workspace narrows the display): two columns from about 1060 px of display, one
  below, and they make room beside a floating workspace panel instead of sitting under it.
  AI Pilot lays out by the workspace's width the same way.
- **Smooth scrolling** (Lenis): the main display's long pages glide by wheel on a fine
  pointer, exactly as far as a native notch would go. Keys, focus and anchors scroll
  natively and the glide follows them; anything inside a page with its own scroll, the
  plant drawing (its wheel zooms), fields and the whole workspace keep native scrolling.
  Off on the Overview's stage, for touch and coarse pointers, on a phone and with reduced
  motion. Frames run only while a glide does.
- **Breakpoints**: 1440 (dock or float), 1180 (compact top bar: site name and the More
  readings label hide, the attention tag drops its time), 760 (phone: stacked grid,
  bottom tab bar with names, Overview opens in the list).
- **Spacing**: 4 px base (4, 8, 12, 16, 24, 32, 40).

## Elevation & Depth

Depth is physical, not decorative:

- **Recess**: displays sit in the bezel behind a 5 px ring with 12 px corners, drawn over
  the display edge only (layout and fit are unchanged): `inset 0 0 0 1px rgb(0 0 0/.75),
  inset 0 3px 8px rgb(0 0 0/.45), 0 0 0 1px rgb(255 255 255/.07), 0 0 0 48px var(--bezel)`.
- **Cut**: controls on the bezel darken on hover and press; the current dock item is a
  recessed well. Engraved dividers (a 2 px line, dark above a lit lip) separate the top
  bar's fields.
- **Raised**: buttons, segmented selections and popovers carry a satin sheen
  (`linear-gradient(180deg, rgb(255 255 255/.045), transparent 65%)`) and a top edge
  (`inset 0 1px 0 rgb(255 255 255/.07)`). Laminate surfaces carry a stronger sheen.
- **Float**: only floating layers have a drop shadow: `0 20px 48px rgb(0 0 0/.55),
  0 2px 8px rgb(0 0 0/.4)`; tags `0 6px 14px rgb(0 0 0/.38), 0 1px 2px rgb(0 0 0/.45)`.
- **Glass** (`rgb(30 34 38/.78)`, blur 20 px) is used only for the plant's three corner
  controls, and becomes the solid raised surface with reduced transparency or without
  backdrop-filter support.

## Shapes

A shape lock: containers 12 px, controls 9 px, tags and small elements 6 px. Eyelets are
circles (8 to 9 px) with a 2 px ring that carries severity or scope; the provenance
eyelet is hatched (not live). Selection on the drawing is a 2 px laminate frame with a
6 px dark halo, constant in screen space at any zoom. Hairlines are drawn with inset
box-shadows, never borders that shift layout. No coloured side stripes.

## Components

- **Top bar**: mark; "site / page" as one location (the page name is the h1 and takes
  focus after navigation, except when focus is in the assistant or AI Pilot: a view either
  opens appears beside it, which keeps focus); the Demo data provenance tag; readouts for Demand, Delivered,
  Running capacity ("Capacity" below 1440 px) and COP with a balance meter (delivered
  against demand within running capacity, unmet in danger) and an unmet note; More
  readings (a tray with five indicators and the 6-hour outlook link); the attention
  slot. On a phone it adds an Assistant button.
- **Attention slot**: always reserved, so a new issue never moves the plant. The most
  severe open issue as one laminate tag with two sibling buttons, open (the issues
  details) and Acknowledge (in this browser only, never a single-key shortcut), then
  Locate. New issues swing in once (a fade with reduced motion), pulse their eyelet
  until acknowledged, prefix the page title "(n) Critical ·" and are announced.
- **Dock**: five sections (Overview, Prediction, Engineering, CAD Studio, Knowledge), then Shortcuts and System. Items magnify up to 1.3x near the
  pointer (transform only), show a laminate name tag on hover or focus, and form one tab
  stop with arrow keys; a laminate indicator slides to the current section.
- **Deck**: Live demo or Replay (a radio group), play and speed in replay, a 00 to 24
  timeline, and the only clock, with freshness ("Replay, readings current", or "Newest
  sample 14:40, 35 min old" in caution). No scenario switch: a simulation's scenario is
  chosen in AI Pilot; the demo telemetry's comes with the address (`?scenario=`) or with a
  conversation's recorded context.
- **Plant**: equipment nodes are buttons named with their state. Readings: Auto shows
  key readings below 80% zoom (one primary reading per item in a plate, names in screen
  space, state words for Fault and Stopped only) and the drawn readings from 80%; Key,
  All and Off override it; R cycles; a hint appears for 4 s when Auto changes mode.
  Open issues hang from their first item: the most severe in full, others folded to
  their eyelet until hovered or focused, outlining everything they reach. Selection
  dims what is unrelated, never equipment in fault or named by an open issue.
- **Workspace**: Details lead (inspector or indicator), with the Assistant | AI Pilot tabs
  below (the Assistant's composer at the foot); typing, or opening Details from an answer, folds Details to a
  one-line strip, and the strip restores them with the text kept. Tabs slide a raised
  pill. In the inspector, an open issue sits directly under the actions as a laminate
  tag (severity, ID, title), and the measurements that are its evidence carry the
  alarm: a severity eyelet, the value in the severity colour, and "evidence for issue"
  for assistive technology. The third measurement column is "Signal" (data quality,
  not equipment health).
- **State labels**: an icon and a word, colour secondary. Running is a check in a
  circle, Stopped a dashed circle, Fault a warning triangle, Stale a clock.
- **AI display** (owner change 2026-10-15, replacing the list view): the Overview's second
  view shows what the assistant retrieved (its `show_on_display` tool): a title with
  provenance tags, a caption, then a line or bar chart, a table, headline figures, an
  inline image or a sandboxed page it wrote. Earlier items sit under "Shown earlier";
  with nothing shown it says nothing has been queried yet. Equipment records are in
  Engineering.
- **Engineering hub and records**: a page header (title and description), then
  Investigations, Equipment records (with search), Simulation history (the run open in AI
  Pilot, a link to the history, and "Set up a simulation in AI Pilot", which opens it)
  and CAD and topology as a planned row saying what it needs, with real topology evidence. Records: the trend
  today across the whole day with a "now" rule, read from 0 against the nameplate rating
  when there is one, with a caption; operating point against nameplate; measurements;
  issue timeline; Locate and Ask.
- **Assistant**: what answers is said in words: the panel's badge reads "No language
  model connected" (offline rules; "Assistant unavailable" in caution when the service
  fails), each answer carries "Offline rules" and "Replay paced for demonstration", tools
  are "Simulated tool", failed tools are caution. An answer arrives as a calm stream: the
  question at once (with its attached files as chips), a quiet "Working" line (three
  bars), plain step labels folding into one recessed "Used N simulated tools" line, then
  words fading in (320 ms) behind a still laminate caret. Answers shape themselves to
  their content: paragraphs by default, lists and tables only where they help. The
  conversation draws no charts: a chart is a link, or opens in the main display. A view
  the request asked to see opens there, and the answer ends with one quiet line between
  hairlines, "Opened in the workspace: System COP today" (the icon in laminate when it
  was opened), with "Open again" (on a phone it also closes the sheet to show the view);
  completion is announced with the view's name. A question whose answer is a view opens
  it without being asked ("How has COP been today?" opens the trend, "What is happening
  with Chiller 2?" its record, the forecast question Cooling prediction); a value now
  stays in the conversation with the trend as a link. Asked to operate the simulation, the
  answer says it cannot and ends with "Pointed to in AI Pilot (yours to press): Stop
  simulation for RUN-…" with "Show again"; AI Pilot opens with that control outlined.
  A question about the live run opens AI Pilot on it, never the main display; one about a
  recorded run ("How did the last simulation go?", "Show me the last simulation") opens its
  replay.
  The view follows the end until the reader scrolls or works above it; "Jump to latest" is a raised chip over the
  conversation. Reduced motion: no fades, no glides. While an answer streams, Cancel
  replaces Send, names its shortcut (Esc in the composer) and hands focus back to the
  composer.
- **Composer inputs**: Attach text files (a paperclip icon button with its limits as its
  description; drop works too) puts each file in a chip (name, size, Remove) above the
  text; a refused file is named with the reason in caution (`role=alert`). Voice input is
  a microphone icon button. With no speech-to-text service it stays shown, quiet and
  aria-disabled, and a press says why ("Voice input needs a speech-to-text service…
  The microphone is not used."). With a service it records: a strip under the text with
  a caution dot, "Recording" and the time, "Stop and transcribe" and "Discard
  recording", then "Transcribing…"; the words join the draft to be read and sent. On
  coarse pointers these controls are 44 px with 8 px between them.
- **AI Pilot (the operator console, in the workspace)**: the one place a simulation is
  set up and operated. Its scope line holds the Simulation only, Mock pilot service and
  Mock simulation service tags and "The pilot never controls physical equipment." It has
  three phases. **Set-up:** the form from the service's capabilities (Name first, optional,
  up to 60 characters; scenario, start time, duration, timestep, setpoints), "Start
  simulation" in laminate and "Start paused" raised, and the recent runs. **Operating:**
  the run band, sticky at the console's top: the run's name as its title with the ID
  beside it (Rename edits it in place: Enter saves, Escape cancels), its state as an icon
  and a word (Created a dashed circle, Running play, Paused pause, Stopped a circled stop,
  Failed a caution triangle), simulated and elapsed time, and the controls the state
  allows, the primary one in laminate; after Start, focus moves to the first of them. Then
  the pilot's strip (status word and icon: Waiting, Monitoring, Investigating, Not
  monitoring, Disconnected; detected and open counts; last scan; a secondary Pause or
  Resume monitoring), the readings in three columns, and three tabs (arrow keys, Home,
  End; the selected one raised and outlined, never laminate): Live (status, the latest
  issues, recent activity), Findings (n open) and Corrections. **Finished:** the band
  ("New simulation" raised) and the result: "Simulation completed", "stopped" or "failed"
  (with the failure), the run's name and ID, findings detected, corrections applied,
  average COP and energy, from what the run recorded, and "View summary & replay" in
  laminate, the one way the replay opens from here. The end is announced. New findings
  rise into the list. Failure, rejection and retained data are caution with words, never
  the alarm red. **AI Pilot never moves the main display**: starting, choosing a tab or a
  finding, stopping and a run ending on its own all leave it where the operator left it;
  only links that say so (the replay, the history) change it, and on a phone they also
  close the sheet. AI Pilot has no page of its own.
- **Deciding on a proposal** (in AI Pilot only): a finding's row opens it under the row:
  the stage, the pilot's investigation in a sentence or two, the proposal in one line
  ("Lower the chilled-water supply setpoint to 8.5 °C on RUN-…"), its rationale, a stale
  warning when the run has moved on, then "Apply to simulation RUN-…" in laminate and
  "Decline" raised, then the latest three pieces of evidence (time, kind, text; a failed
  tool in caution). Apply goes through the run's correction gate; Decline applies nothing
  and records the decision in the evidence. Once decided, declined, resolved or ended, the
  controls give way to a sentence saying why.
- **Pointed control**: when the assistant points to an operator control, AI Pilot opens
  at the view that holds it; a
  note says whose it is to press ("Stopping is yours: press Stop simulation to end RUN-….
  The assistant cannot stop it.") and takes focus, with a dismiss button; the control gets
  a still laminate ring and swells twice inside it. The control is never pressed or
  focused. Forced colours: a Highlight outline.
- **Simulation replay** (`/simulation/RUN-…`, the main display; the h1 is Simulation): one
  recorded run, the same view from AI Pilot's result, Simulation history and the
  assistant. It operates nothing. The page header ("Simulation replay" with the Recorded
  run, Mock simulation service and Mock pilot service tags), "All runs", the run band read
  only (name, ID, state, scenario, revision, times; no controls), the Run summary, then the
  simulated plant on its own recessed display (its provenance note, the pilot's issues seen
  by then hanging on it) with the **Replay** scrubber under it: one stop per recorded step,
  the time and "step n of N" beside it, the run's last step at first; what is chosen on the
  plant shows its readings and what was held then. The results (System COP, demand with
  removed cooling, unmet demand, power, energy; a matched run overlaid in the capacity
  grey) mark the replayed moment; the corrections and events sit beside them, and the
  pilot's findings follow (a finding or an item named in the address is chosen and brought
  into view). A live run's address says it is live in AI Pilot, with "Open AI Pilot", and
  shows its replay once it has ended.
- **Pilot findings**: the chosen issue's lifecycle (six stages; the current one raised and
  outlined, never laminate), facts, investigation with uncertainty, the proposal,
  applications and outcomes, the evidence timeline (one tab stop, arrow keys; failed tools
  in caution; the operator's decisions as entries) and the resolution with links to its
  evidence.
- **Run summary**: "Run summary, RUN-…" with the outline tag "From the recorded run"; a
  lead sentence; figures (average COP, energy, demand, unmet demand, pilot issues,
  corrections applied) with their detail beneath; Assessment as icon-and-word items
  (Observation, Improved, Did not improve, Concern in caution); unresolved issues as
  links; Recommendations, each with its "Based on:"; and the timeline in simulated time.
- **Simulation history**: the archive, read only. A data table of runs, newest first
  (name, scenario, start, state, figures right-aligned under right-aligned headers, the
  pilot's issues and summary), that becomes labelled cards in a narrow display. A run
  opens its replay; the live run's "Live in AI Pilot" opens AI Pilot beside the list.
- **Trend**: one indicator across today in the main display, the answer to "show me
  COP": its figures (now, average, range, change since midnight), a chart with a "Now"
  rule, Indicator details, and the other indicators as links. Labelled Demo data and
  "Telemetry, scenario"; never a simulation.
- **Knowledge** (`/knowledge`, the h1 is Knowledge): two systems on one page, **RAG Graph |
  Graph Memory**, as raised-and-outlined tabs (arrow keys, Home, End; the address keeps the
  tab), with the store's provenance tag at the right: Demo library or Demo records, read
  only, or Local knowledge or memory service. The RAG Graph is the default and its header
  adds the count ("128 nodes, 252 relationships", a polite status); Graph Memory keeps its
  one-line lead. Graph Memory has no dock entry of its own.
- **RAG Graph** (M7.3): the knowledge graph fills the page; there are no Library, Search
  and Graph views to choose between. Over the graph, raised like the canvas's tools:
  - **Top left:** one search box, then **Library** and **Filters**, and **Clear
    expansions** once a node has been expanded. The search box is an ARIA combobox: as one
    types it lists the nodes in view whose names match (glyph, name, type; up to six), then,
    set apart, "Search passages for '…'" (the indexed text). Arrows move, Enter takes the
    highlighted choice (the first by default), Escape closes the list. A node flies the
    camera to it and opens it; when no node matches the list says so and offers only the
    passages. Empty, the box offers the three example questions, none taken until the
    arrows reach one. Filters opens the type filters by family (the legend), the colour sentence and
    the relationship filters; a dot on the button, and its name ("Filters (3 hidden)"), say
    when some are hidden.
  - **Top right:** the canvas's tools: **3D | 2D**, zoom in and out, Fit, Reset view (3D)
    and **Help**, which holds how to move round the graph, its keys, the search and the
    library. The same text is the canvas's accessible description; nothing is printed
    under the graph.
  - **Bottom left** (3D): the trail.
  - Popovers (the filters, help, the search's choices) close with Escape, a press elsewhere
    or focus moving on. The camera frames what is shown between the controls along the top
    and bottom, keyboard focus is brought out from under them, and names avoid the controls
    and open popovers. In forced colours the controls keep an edge and their pressed, open
    and highlighted states an outline.
  - On a narrower graph (800 px and below) the buttons keep only their icons, with their
    names for assistive technology and as tooltips, and the search box takes the room left;
    on a phone-sized graph (560 px and below) the canvas's tools move to the bottom, with the
    trail above them.
- **The RAG Graph's column**: one column beside the graph holds what is browsed or
  inspected: the document library (`?kv=library`), or the passages a search found
  (`?kv=search&q=…`), and over either the inspection of what was chosen (a document, a
  passage, a node or a relationship), with "‹ Back to the library" or "‹ Back to the
  results" above it; going back (or Escape) returns focus to what opened the inspection,
  and the list keeps its place. Everything is in the address, so a citation opens the exact
  passage.
  The library states the service's capabilities as facts (storage, formats and limit,
  extraction, vector search, answers) and lists documents with their status as an icon and a
  word: Indexed in ok; Partly indexed and Failed in caution with the reason, never the alarm
  red. Choosing a document focuses its group in the graph. A document's panel lists its
  eight ingestion stages (the indexing diagnostics) and its outline, whose sections open in
  the source reader. Add document, Reindex and Remove… (whose confirmation says what goes
  with it) exist only with the local service; the demo says why it has none. The passages
  are stored passages only: source, section and page, the question's words marked, how each
  was found (Keyword #n, Graph #n with its path in words, Vector #n when configured) and "No
  answer is written: no language model is configured"; each has **Show in graph** (its
  section), and says so when its section is not in the graph view. Ranks and the fusion
  score are not probabilities. With no question yet, the column explains the search and
  offers three example questions.
- **Graph explorers** (2D): SVG on a recessed sheet, shapes per type (graphite in the
  memory graph, the family colours in the knowledge graph), laminate for the chosen node or
  relationship, and what it does not relate to dimmed. Names and shapes keep their screen
  size at any zoom. Drag pans; the wheel zooms (smooth scrolling leaves it to the canvas);
  +, − and Fit sit in the canvas's corner. One tab stop: arrow keys move to the nearest node
  that way, Enter inspects, Escape clears. The memory graph lays records out in time: lanes
  by equipment, simulation runs above, day markers, the derived order dashed; simulation
  records carry a notice eyelet; names show for the anchors, the chosen record, and
  everything when zoomed in.
- **Knowledge graph** (M7.1): 3D by default, with **3D | 2D** (a segmented radio group in
  the address, `gv`) among the canvas's tools (M7.3). The type filters are grouped by
  family and are the legend: each type's glyph in its family colour, with "Colour shows the
  family; the shape and the name tell the types apart" under them, in Filters (M7.3). It
  shows the 150 best-connected
  nodes at most, with the documents those leave out added (each is the centre of its group
  in 3D), and grows by expanding a node (300 at most) without moving what is on screen.
  - **3D** (react-force-graph-3d, a lazy chunk), as planetary systems (M7.2):
    - **Structure.** Each document is a planet, the largest sphere (radius 30). What it
      describes circles it on three orbits: its sections closest, evenly spaced in outline
      order; important entities (four or more connections, or described in other documents
      too) next; supporting entities outside. Orbits are tilted differently, so a system
      keeps its shape when the view turns, and are spaced so no two spheres touch.
    - **Placement.** Systems sit in rows (three across, two on a phone) with 130 units
      between outer orbits. Positions are fixed and deterministic; nothing is simulated.
    - **Growing.** Expanding a node moves nothing already shown. New nodes take free places
      on their system's orbits; then a new outer orbit, all round where the neighbouring
      systems leave room and only on the open side where they do not (half the gap to
      every other system stays empty); only then a ring in front of or behind the system.
      A place a node leaves is used again.
    - **Shared knowledge.** Each node is drawn once, in the system of the document that
      describes it most. One described elsewhere too leans towards those documents'
      systems and carries a muted "+n" by its name; its links to them arc through the
      space between systems.
    - **Sizes.** Planets 30; entities 8 to 14 with their connections; sections 6 to 8. A
      34° lens keeps planets round at the edges of a wide view.
    - **Four ways of looking.** Overview: links within a system faint, between systems
      fainter. A group (a document chosen, by its sphere or its name): the camera frames
      the system, its members and links clear, what they link to elsewhere half-shown, the
      other systems faded. A node: the camera comes to it and what it relates to (its own
      system's neighbourhood when far neighbours would push it too far back; their names
      then wait at the edge), relationships lit with arrows, its own system half-shown.
      A relationship: both ends framed and named, the link lit.
    - **The trail.** At the lower left, **Overview › group › node** says where one is
      and leads back; Overview also resets the camera.
    - **Names.** HTML labels on a dark tag: documents the largest (body size, always
      shown), important entities in the caption size, the rest smaller. Each tries below,
      above, right and left of its node and never prints over another name, a planet, the
      chosen node or the controls. They come in as the camera closes in; names fade in and
      out.
    - **Controls, like a map.**
      - Dragging moves the graph, and the point under the cursor stays under it. This
        works from a name too.
      - Right-drag or Shift-drag turns the view; the wheel zooms towards the pointer.
      - On touch, one finger moves the graph and two turn and pinch it.
      - A click on a node or its name chooses it, and a click on empty space clears. A
        drag never chooses.
      - An open hand over empty space (closed while dragging); a pointer over a node or a
        visible link.
      - Once the reader moves the view, it stays where they put it: neighbours of a choice
        arriving later do not take the camera back.
      - +, −, Fit and Reset view sit at the top right with 3D | 2D and Help (along the
        bottom on a phone-sized graph).
      - One tab stop: arrow keys move to the nearest node on screen (a laminate ring,
        announced politely), Enter inspects, Shift with an arrow turns the view, + and −
        zoom, 0 fits, R resets, Escape clears.
    - It draws only while someone looks round and pauses 1.5 s after.
  - **2D** is the explorer above, and is where the graph opens in high-contrast mode
    (it follows the system colours), without WebGL, or after a lost graphics context, each
    with a sentence saying why.
- **Graph Memory**: filters (words, equipment, provenance, a time window in UTC, superseded
  versions), kind chips, Timeline or Graph, the record inspector, and the rules (what may
  be stored, the provenance labels with what the persistent store refuses, retention). The
  timeline groups records by day: time, kind as an icon and a word, the provenance tag
  (Simulation with its run, in notice; Demo hatched), the equipment and "After … on …". A
  record's panel says when it happened and was recorded, whether it is current or until
  when it held, its provenance in a sentence, its versions and its links in words
  (Supported by, Resolves…). With the local service it adds Correct…, Link… and Delete…,
  whose confirmation says what happens to the versions and links.
- **Knowledge motion**: a tab's content and an inspection panel's parts settle in (the
  panel's heading is there at once and takes focus when the panel was opened from the
  page, and focus goes back to what opened it when it closes); the 2D camera glides to a
  chosen node; the 3D camera travels to it (500 ms, easing in and out, because it turns and
  closes in at once; 650 ms to a whole group or the overview, a bigger change of scale)
  while the emphasis cross-fades in 320 ms, and a drag ends in a short glide; a document
  whose status changed draws the eye once; the timeline's entries rise in. With reduced
  motion none of it moves: the 3D camera jumps, emphasis changes at once and a drag stops
  where it is released. Keys never animate the camera.
- **Loading**: a skeleton is a polite status that says what is loading.

## Do's and Don'ts

- Do keep laminate for attention, selection, focus and the primary action only. Don't
  add a second accent hue. Data categories (chart series, the knowledge graph's families)
  are hue with a word or a glyph beside them, not accents.
- Do pair every state colour with a word or an icon. Don't use the alarm red for
  anything but an alarm.
- Do mark everything that is not live: Demo data, No language model connected, Offline
  rules, Simulated tool, Mock simulation service, Mock pilot service, Synthetic plant,
  Planned. Don't fake an upload, a transcription, a result or a service.
- Do keep the corners of the plant empty except for the three controls. Don't add
  floating cards over the drawing.
- Do keep the RAG Graph's controls along its top and bottom edges and its secondary
  content (filters, the legend, help) in popovers that close. Don't print instructions or
  repeat its name over or under the graph; the canvas's description and Help carry them.
- Do animate transform and opacity only, with `cubic-bezier(.16,1,.3,1)` at 140, 220 or
  320 ms, and honour reduced motion (positions jump, states remain). CSS does hover, focus
  and press; GSAP (`src/lib/motion.ts`) only choreographs meaning: a state arriving
  (parts settle in turn), new items, a state that changed in place, a pointed control.
  The one exception is the 3D graph (WebGL, not CSS): its camera takes 500 ms to a node and
  650 ms to a group or the overview, easing in and out, and its emphasis cross-fades in
  320 ms.
  Don't animate for decoration or in loops.
- Do keep focus visible: a 2 px laminate ring, drawn in ink inside laminate tags.
- Don't restyle the equipment artwork or the pipe-media colours; they are approved scene
  tokens.
- Don't use glass outside the plant's corners, coloured side stripes, gradients as
  decoration, or monospace for labels.
