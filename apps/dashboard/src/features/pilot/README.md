# AI pilot issues and correction history

**Assignment:** implement `/pilot` and compact issue links for monitoring. Follow
the [dashboard handoff](../../../README.md). Backend policy belongs in
[pilot](../../../../../src/hvac_agent/pilot/README.md). Status: brief only.

Build an issue list, selected-issue investigation panel, evidence timeline,
proposed-action detail and measured outcome view. Group recurring detections into
their backend issue ID. Show severity, equipment, first/last seen, source/run,
status and data freshness without conflating an alert with a verified fault.

An issue follows detection → investigation → proposal → application → outcome →
resolution. Display the backend state, supporting readings/citations, reasoning
summary and uncertainty. Link equipment to the common inspector and forecasts to
the exact result used in the investigation. Preserve historical evidence timestamps.

Enable/disable pilot monitoring only for an explicitly named simulation run when
the backend advertises that capability. Display proposed/queued/rejected/superseded/
expired/applied/achieved corrections distinctly. Reuse simulation command/history
interfaces; the UI neither makes a control decision nor marks success because a
request was accepted. There is no real-equipment autonomous-control switch.

Acceptance: repeated issue updates do not duplicate rows; delayed reasoning does
not freeze monitoring; failed tools and rejected/stale actions remain visible;
resolution links to evidence. Test no issues, no pilot backend, paused/ended runs,
disconnect and accessible timeline navigation. Record fixture/live status and update
this README/project context when implemented.
