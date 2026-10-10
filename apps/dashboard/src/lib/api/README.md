# Local API client and update subscriptions

**Assignment:** own browser-to-DGX communication. Coordinate with
[API composition](../../../../api/README.md) and the
[contract brief](../../../../../docs/ui-data-contracts.md). Status: no client yet.

Implement one configured client: boundary validation, timeout, cancellation,
normalized errors, polling/subscription cleanup and bounded reconnection. Use a
configured local origin or same-origin paths; do not embed the developer DGX address.
No browser calls to models, PHYVAC, databases or equipment protocols.

Cache keys include source, run, site revision, equipment and time range. Forecasts
also include cutoff, target, horizon and timestep. Cancel or ignore responses for
obsolete keys. Reject older sequence/revision updates and refresh snapshots after
reconnect rather than applying an incomplete event stream.

Retry reads with bounded backoff. Do not replay start/stop, corrections, forecast
generation, adaptation or activation writes after ambiguous failures unless their
endpoint has an agreed idempotency contract. Reconcile job/run state before retry.
HTTP success does not mean an asynchronous job completed.

An explicitly selected fixture adapter may implement the same interface. Display
`Demo data` throughout that mode and prevent production writes. Never turn a real
error into a successful fixture response.

Acceptance: timeout, malformed payload, denial, reconnect, old/out-of-order response,
duplicate click and navigation cleanup. Polls stop when unused; subscriptions do
not multiply on repeat visits. Document real configuration/run instructions later.
