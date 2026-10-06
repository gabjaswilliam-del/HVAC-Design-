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
- outline: provenance (Demo data, Scripted demo, Simulated tool, Synthetic plant);
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
- **Pages** pad 22 px 26 px and scroll inside the display; the Engineering hub is one
  column of flat sections separated by hairlines (max 980 px), records a two-column
  grid of cells (one column at 1180 px and below).
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
  focus after navigation); the Demo data provenance tag; readouts for Demand, Delivered,
  Running capacity ("Capacity" below 1440 px) and COP with a balance meter (delivered
  against demand within running capacity, unmet in danger) and an unmet note; More
  readings (a tray with five indicators and the 6-hour outlook link); the attention
  slot. On a phone it adds an Assistant button.
- **Attention slot**: always reserved, so a new issue never moves the plant. The most
  severe open issue as one laminate tag with two sibling buttons, open (the issues
  details) and Acknowledge (in this browser only, never a single-key shortcut), then
  Locate. New issues swing in once (a fade with reduced motion), pulse their eyelet
  until acknowledged, prefix the page title "(n) Critical ·" and are announced.
- **Dock**: four sections, then Shortcuts and System. Items magnify up to 1.3x near the
  pointer (transform only), show a laminate name tag on hover or focus, and form one tab
  stop with arrow keys; a laminate indicator slides to the current section.
- **Deck**: scenario, Live demo or Replay (a radio group), play and speed in replay, a
  00 to 24 timeline, and the only clock, with freshness ("Replay, readings current", or
  "Newest sample 14:40, 35 min old" in caution).
- **Plant**: equipment nodes are buttons named with their state. Readings: Auto shows
  key readings below 80% zoom (one primary reading per item in a plate, names in screen
  space, state words for Fault and Stopped only) and the drawn readings from 80%; Key,
  All and Off override it; R cycles; a hint appears for 4 s when Auto changes mode.
  Open issues hang from their first item: the most severe in full, others folded to
  their eyelet until hovered or focused, outlining everything they reach. Selection
  dims what is unrelated, never equipment in fault or named by an open issue.
- **Workspace**: Details lead (inspector or indicator), with the assistant's tabs and
  composer below; typing, or opening Details from an answer, folds Details to a
  one-line strip, and the strip restores them with the text kept. Tabs slide a raised
  pill. In the inspector, an open issue sits directly under the actions as a laminate
  tag (severity, ID, title), and the measurements that are its evidence carry the
  alarm: a severity eyelet, the value in the severity colour, and "evidence for issue"
  for assistive technology. The third measurement column is "Signal" (data quality,
  not equipment health).
- **State labels**: an icon and a word, colour secondary. Running is a check in a
  circle, Stopped a dashed circle, Fault a warning triangle, Stale a clock.
- **List view**: find, type, state and open-issue filters with a live count; faults and
  open issues first, issues as severity marks; labelled readings ("Fan" for towers,
  demand and delivered for the data hall); 38 px rows, so all sixteen items fit at
  1440x900; names on one line; an empty state with Clear filters.
- **Engineering hub and records**: a page header (title and description), then
  Investigations, Equipment records (with search), Simulation and CAD and topology as
  planned rows saying what each needs, with real topology evidence. Records: the trend
  today across the whole day with a "now" rule, read from 0 against the nameplate rating
  when there is one, with a caption; operating point against nameplate; measurements;
  issue timeline; Locate and Ask.
- **Assistant**: "Scripted demo" and "Simulated tool" are provenance tags, answers
  carry "Replay paced for demonstration", failed tools are caution. An answer arrives
  as a calm stream: the question at once, a quiet "Working" line (three bars), plain
  step labels folding into one recessed "Used N simulated tools" line, then words
  fading in (320 ms) behind a still laminate caret. Answers shape themselves to their
  content: paragraphs by default, lists and tables only where they help. The view
  follows the end until the reader scrolls or works above it; "Jump to latest" is a
  raised chip over the conversation. Reduced motion: no fades, no glides.

## Do's and Don'ts

- Do keep laminate for attention, selection, focus and the primary action only. Don't
  add a second accent hue.
- Do pair every state colour with a word or an icon. Don't use the alarm red for
  anything but an alarm.
- Do mark everything that is not live: Demo data, Scripted demo, Simulated tool,
  Synthetic plant, Planned. Don't fake an upload, a result or a service.
- Do keep the corners of the plant empty except for the three controls. Don't add
  floating cards over the drawing.
- Do animate transform and opacity only, with `cubic-bezier(.16,1,.3,1)` at 140, 220 or
  320 ms, and honour reduced motion (positions jump, states remain).
- Do keep focus visible: a 2 px laminate ring, drawn in ink inside laminate tags.
- Don't restyle the equipment artwork or the pipe-media colours; they are approved scene
  tokens.
- Don't use glass outside the plant's corners, coloured side stripes, gradients as
  decoration, or monospace for labels.
