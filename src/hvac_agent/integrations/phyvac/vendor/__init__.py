"""Import shim for the vendored PHYVAC engine.

Importing the engine module has three side effects that are wrong for a service. This
package neutralises them from the outside so the vendored file itself stays unedited, and
re-exports the components this project uses.

Always import from this package, never from ``.phyvac`` directly. Importing the submodule
happens to work, because Python runs this file first and by then the engine is already
loaded and cached, but the supported entry point is this one.

What is neutralised
-------------------

**A backend is forced before the engine imports pyplot.** The engine imports
``matplotlib.pyplot`` unconditionally at module level, with its own ``matplotlib.use``
call commented out. On a headless machine that import fails outright unless a
non-interactive backend is already selected.

**The version banner is swallowed.** The engine prints its version to stdout on import.
Anything that shares stdout — an API response, a log line, a test's captured output —
would otherwise pick it up.

**Curve plotting stays off by default at the call sites.** ``Pump`` and ``Fan`` default to
``figure=1``, which builds a matplotlib figure during construction and reads the caller's
source line through ``traceback.extract_stack`` to guess a variable name for the title.
Under Agg this is harmless but wasteful, and the stack inspection is brittle — it fails in
a list comprehension. Component construction must pass ``figure=0``; that belongs to the
adapter rather than here, because it is an argument at each call, not an import-time
effect.

What is re-exported
-------------------

Only what this project uses. The list is a dependency statement: if a future baseline
drops or renames one of these, importing this package fails immediately and loudly rather
than at the first plant assembly. Add a name here deliberately when something needs it.

Provenance, licence and the applied patches are in ``UPSTREAM.md``. Do not edit
``phyvac.py``.
"""

from __future__ import annotations

import io
from contextlib import redirect_stdout

import matplotlib

# Must precede the engine import: it pulls in pyplot at module level.
matplotlib.use("Agg", force=True)

with redirect_stdout(io.StringIO()):
    from . import phyvac as _engine

# --- Heat source -------------------------------------------------------------------
Chiller = _engine.Chiller
ParallelChillerGroup = _engine.ParallelChillerGroup

# --- Heat rejection ----------------------------------------------------------------
CoolingTower = _engine.CoolingTower
CoolingTowerBank = _engine.CoolingTowerBank

# --- Hydronic components -----------------------------------------------------------
Pump = _engine.Pump
Pump_para = _engine.Pump_para
Valve = _engine.Valve
AHU_simple = _engine.AHU_simple

# --- Hydraulic branches ------------------------------------------------------------
BranchW = _engine.BranchW
BranchW1 = _engine.BranchW1
quadratic_formula = _engine.quadratic_formula

# --- Control blocks ----------------------------------------------------------------
PID = _engine.PID
UnitNum = _engine.UnitNum
UnitNumChiller = _engine.UnitNumChiller
BypassValve = _engine.BypassValve
PumpWithBypassValve = _engine.PumpWithBypassValve

# --- Psychrometrics ----------------------------------------------------------------
tdb_rh2twb = _engine.tdb_rh2twb
tdb_rh2h_x = _engine.tdb_rh2h_x
tdb_rh2w = _engine.tdb_rh2w
w_tdb2rh = _engine.w_tdb2rh
tdb2den = _engine.tdb2den

ENGINE_VERSION = "ver20231120"
"""The baseline engine's own version string, for provenance in run records."""

__all__ = [
    "AHU_simple",
    "BranchW",
    "BranchW1",
    "BypassValve",
    "Chiller",
    "CoolingTower",
    "CoolingTowerBank",
    "ENGINE_VERSION",
    "PID",
    "ParallelChillerGroup",
    "Pump",
    "PumpWithBypassValve",
    "Pump_para",
    "UnitNum",
    "UnitNumChiller",
    "Valve",
    "quadratic_formula",
    "tdb2den",
    "tdb_rh2h_x",
    "tdb_rh2twb",
    "tdb_rh2w",
    "w_tdb2rh",
]
