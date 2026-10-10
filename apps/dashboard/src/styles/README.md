# Shared visual system

**Assignment:** establish one operational visual language. Read the
[design direction](../../README.md). No incumbent theme or stylesheet exists.

Create tokens for surface/text/border, accent, semantic status, typography, spacing,
radii, elevation, focus and motion. Use a neutral base and purposeful emphasis.
Choose one legible locally bundled/system sans; use tabular figures for numerical
readings and always show units. Record actual token choices here after implementation.

Use a compact type scale, repeatable spacing, sections/dividers and aligned values.
Avoid a card around every datum. Meet AA text/non-text contrast and visible focus;
unknown data and critical faults need distinct text/icon cues as well as color.

Use short state transitions, normally 150–250 ms, without page-entry choreography.
Equipment motion represents observed running/flow state. Stale/stopped/unknown and
reduced-motion views retain meaning without animation. One complete accessible
theme is sufficient for first delivery; do not ship incomplete alternate themes.

Respond structurally with collapsing panels, drawers and table overflow, not tiny
fluid text. Support 200% zoom. Fonts/icons must work offline with no CDN calls.
Use only sanitized assets in previews. Status: visual-system brief, not implemented.
