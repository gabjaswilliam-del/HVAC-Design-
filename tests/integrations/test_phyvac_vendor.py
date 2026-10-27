"""Checks for the vendored engine and its shim.

Two jobs. The shim tests confirm the three import-time side effects are neutralised, in a
fresh interpreter, because by the time a test in this process runs the module is already
cached and the effects have already happened or not.

The patch tests are source-level on purpose. Patch 0001 fixes a failure that only occurs
on NumPy 2.x, so a behavioural test would pass on a NumPy 1.x workstation for entirely the
wrong reason and would go on passing if the patch were lost at the next sync. Checking the
source text is the only guard that works everywhere.
"""

from __future__ import annotations

import os
import subprocess
import sys
from pathlib import Path

import pytest

VENDOR_DIR = (
    Path(__file__).resolve().parents[2]
    / "src"
    / "hvac_agent"
    / "integrations"
    / "phyvac"
    / "vendor"
)
ENGINE_SOURCE = VENDOR_DIR / "phyvac.py"


def run_fresh(code: str) -> subprocess.CompletedProcess[str]:
    """Run code in a new interpreter that can import the package.

    Inherits the environment — matplotlib needs a home directory to resolve its config
    and cache — but drops MPLBACKEND, so a backend chosen outside cannot stand in for the
    shim choosing one.
    """
    repo_root = Path(__file__).resolve().parents[2]
    env = os.environ.copy()
    env.pop("MPLBACKEND", None)
    env["PYTHONPATH"] = str(repo_root / "src")
    return subprocess.run(
        [sys.executable, "-c", code],
        capture_output=True,
        text=True,
        cwd=repo_root,
        env=env,
        timeout=180,
    )


# --- The shim ----------------------------------------------------------------------


def test_importing_the_shim_prints_nothing():
    # The engine prints its version banner at module level. Anything sharing stdout —
    # an API response, a log line — would otherwise pick it up.
    result = run_fresh("from hvac_agent.integrations.phyvac import vendor")
    assert result.returncode == 0, result.stderr
    assert result.stdout == ""


def test_the_shim_selects_a_headless_backend():
    # The engine imports pyplot unconditionally; without a non-interactive backend
    # already selected, that import fails outright on a headless machine.
    result = run_fresh(
        "from hvac_agent.integrations.phyvac import vendor\n"
        "import matplotlib; print(matplotlib.get_backend())"
    )
    assert result.returncode == 0, result.stderr
    assert result.stdout.strip().lower() == "agg"


def test_importing_the_engine_submodule_directly_is_also_quiet():
    # Not the supported entry point, but Python runs the package __init__ first, so the
    # banner is already swallowed and the backend already set.
    result = run_fresh(
        "from hvac_agent.integrations.phyvac.vendor import phyvac  # noqa: F401"
    )
    assert result.returncode == 0, result.stderr
    assert result.stdout == ""


def test_every_exported_name_resolves():
    # The export list is a dependency statement. If a future baseline drops or renames
    # one of these, this fails at once rather than at the first plant assembly.
    from hvac_agent.integrations.phyvac import vendor

    missing = [name for name in vendor.__all__ if not hasattr(vendor, name)]
    assert missing == []


def test_the_engine_computes_through_the_shim():
    from hvac_agent.integrations.phyvac import vendor

    pump = vendor.Pump(figure=0)
    pump.inv = 1.0
    assert pump.f2p(pump.g_d) == pytest.approx(234.1801, abs=1e-4)
    assert vendor.tdb_rh2twb(32.0, 70.0) == pytest.approx(27.344, abs=1e-3)


# --- Patch 0001 --------------------------------------------------------------------


def test_no_float_conversion_of_interpolator_output_remains():
    # NumPy 2.0 removed implicit float() on one-element arrays, which is what the
    # chiller and heat pump COP lookups relied on.
    source = ENGINE_SOURCE.read_text(encoding="utf-8")
    assert "float(cop(" not in source


def test_the_interpolator_output_is_taken_with_item():
    source = ENGINE_SOURCE.read_text(encoding="utf-8")
    assert source.count(").item()") == 3


def test_the_patch_is_recorded():
    patch = VENDOR_DIR / "patches" / "0001-numpy2-item.patch"
    assert patch.is_file()
    text = patch.read_text(encoding="utf-8")
    assert text.count("+            self.cop = cop([[") == 3


# --- Provenance and licence --------------------------------------------------------


def test_the_upstream_licence_is_present():
    licence = (VENDOR_DIR / "LICENSE").read_text(encoding="utf-8")
    assert "The University of Tokyo" in licence
    assert "Redistribution and use in source and binary forms" in licence


def test_provenance_is_recorded():
    upstream = (VENDOR_DIR / "UPSTREAM.md").read_text(encoding="utf-8")
    for required in (
        "ShoheiMiyata/phyvac",  # upstream project
        "5b452aa",  # baseline commit
        "ver20231120",  # engine version
        "0001-numpy2-item.patch",  # applied patch
        "Outstanding",  # the unresolved permission for the fork's own changes
    ):
        assert required in upstream, f"UPSTREAM.md does not record {required!r}"


def test_the_engine_is_stored_with_unix_line_endings():
    # The patches are generated against the LF form; a checkout that rewrote them would
    # make the recorded patches unreplayable.
    assert b"\r\n" not in ENGINE_SOURCE.read_bytes()
