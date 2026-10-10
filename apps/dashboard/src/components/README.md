# Shared UI components

**Assignment:** provide reusable controls for all [dashboard](../../README.md)
features. No feature-specific physics or API calls here. Status: brief only.

Build buttons, labeled fields, selects, tabs, dialogs/drawers, tables, skeletons,
empty/error states, notices, badges and tooltips. Add shared `MetricValue`
(value/unit/quality/time), `SourceBadge`, `FreshnessLabel`, `JobProgress`,
`TimeSeriesChart` and accessible `DataTable` patterns. Names are proposed exports.

Provide hover, focus, active, disabled, loading and failure behavior where applicable.
Prefer native semantics. Dialogs trap/restore focus, have a labeled close action,
and escape scrolling containers. Field errors stay beside the field and are announced.

Charts take explicit units, source and timestamps. Missing points remain gaps;
observed/forecast lines differ by style and label; intervals appear only when supplied.
Expose keyboard-readable values and a table view. Do not use unlabeled dual axes,
random data, implicit interpolation, or color alone to communicate meaning.

Use [style tokens](../styles/README.md). Equipment inspectors belong in
`features/equipment/`; forecast summaries in `features/prediction/`; generic rendering
belongs here. Demonstrate every component state with [fixtures](../fixtures/README.md),
including no data, long labels and partial readings. Check focus, contrast and zoom.
