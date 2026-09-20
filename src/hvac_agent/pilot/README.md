# AI pilot

HVAC-informed monitoring, anomaly assessment, and correction policy. During a
running simulation, consume observations, identify problems, request corrective
simulation actions, and record their outcomes for the dashboard and operator.
Use prediction and retrieved knowledge through public interfaces as needed.

The simulation module owns physics and state transitions; this module owns the
monitoring/correction decisions. Keep run identity, observation origin, action
limits, and correction history explicit. Physical equipment actuation is a separate
scope decision, not an implied consequence of enabling the simulation pilot.

Placeholder only; no monitoring loop or control policy is implemented.
