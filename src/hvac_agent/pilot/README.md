# AI pilot

HVAC-informed monitoring, anomaly assessment, and correction policy. During a
running simulation, consume observations, identify problems, request corrective
simulation actions, and record their outcomes for the dashboard and operator.
Use prediction and retrieved knowledge through public interfaces as needed.

The simulation module owns physics and state transitions; this module owns the
monitoring/correction decisions. Keep run identity, observation origin, action
limits, and correction history explicit. Physical equipment actuation is a separate
scope decision, not an implied consequence of enabling the simulation pilot.

Carry an issue through detection, investigation, proposed/applied correction, and
measured outcome. Repeated observations should update that issue rather than create
unrelated alerts. Keep screening and deeper model reasoning off the simulation's
step path, and validate run identity and observation freshness before corrections.
The reference project's pilot is advisory; its code is not a ready-made correction loop.

Placeholder only; no monitoring loop or control policy is implemented.

UI assignment: [pilot issues and correction history](../../../apps/dashboard/src/features/pilot/README.md).
The frontend displays this module's issue/evidence/outcome states and reuses the
simulation command boundary. It does not duplicate policy or decide that an accepted
action achieved its goal. Coordinate API contracts with `apps/api/`.
