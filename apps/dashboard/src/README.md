# Dashboard source map

Read the [dashboard handoff](../README.md). These folders express source ownership,
not independently deployed applications. They currently contain instructions only.

- [app](app/README.md): shell, routes and shared operating context.
- `features/`: domain screens and reusable panels, each with its own brief.
- [components](components/README.md): domain-neutral accessible UI primitives.
- [styles](styles/README.md): tokens and global visual rules.
- [lib/api](lib/api/README.md): API access and update subscriptions.
- [lib/contracts](lib/contracts/README.md): boundary schemas/types.
- [fixtures](fixtures/README.md): explicit synthetic development data.

Dependencies flow from app composition to features to shared components/data clients.
Shared components do not import feature modules. Expose documented feature panels
for composition; do not reach into another feature's private files. Proposed route
names are UI navigation, not existing server endpoints. Keep bundles, installed
dependencies and customer assets out of source.
