"""PHYVAC integration.

Everything specific to the selected simulation engine lives under this package: the
vendored engine in `vendor/`, and — as they are built — the adapter that translates site
configuration and actions into it, equipment curve loading, hydraulic closure, and the
plant builder.

Nothing outside this package should import the engine. `simulation/` owns what a run is
and talks to the engine through the adapter's interface, so that replacing or upgrading
the engine stays a change confined here.
"""
