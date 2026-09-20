# Core domain

Shared contracts for the single site's equipment identities, topology, connections,
units, sensor mappings, observations, and common events. Shared scene/configuration
references should preserve the same equipment IDs across modules.

Keep module-private types in their owning module. `core` must not import feature
modules, applications, provider SDKs, or training frameworks. Do not use it as a
generic utilities folder or add tenant/fleet abstractions.

Placeholder only; contracts and schemas will be defined with their first consumers.
