# Application shell and navigation

**Assignment:** build the common frame for the [dashboard](../../README.md).
Put shell, route composition and application context here. Proposed components:
`AppShell`, `SiteHeader`, `MainNavigation`, `OperatingContext`, `ConnectionBanner`.

## Build

- Persistent header: installed site name, data mode, source/run, time and freshness.
  No multi-site selector or tenant management.
- Navigation to the routes in the dashboard handoff. Group setup/maintenance links
  separately from daily operation. Default to monitoring; an unconfigured site
  explains what is missing and links to setup.
- Shared context: selected equipment, observation source, run ID, site revision and
  time range. Distinguish live wall-clock time from simulated time.
- Deep links to equipment, runs, forecasts and issues. Unknown IDs produce an
  explanatory state instead of an unrelated selection.
- Desktop sidebar, collapsible navigation and accessible drawers on smaller screens.
  Preserve browser back behavior and move focus to the new page heading on navigation.
  Never hide the data mode on mobile.

## Integration and acceptance

Compose public feature entry points. Open equipment/agent inspectors without losing
scene selection. On source/run/revision changes, clear incompatible results and
cancel/discard old requests. Backend capabilities determine available operations;
disabled actions explain why. The API enforces permissions, not frontend-only checks.

Use the [API client](../lib/api/README.md). No business calculations or simulation
clock here. Navigate away from a running simulation and back: time comes from the
backend. Test browser back, deep links, keyboard navigation, narrow layouts,
connection loss and late responses after context changes. Update this README and
the project context when implemented. Status now: brief only.
