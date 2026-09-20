"""A trivial test so that `pytest` and CI have something to run.

There is no application code yet. All this checks is that the repo still has the
layout its README describes. Delete it once there are real tests.
"""

from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parents[1]


def test_layout_folders_exist():
    for folder in (
        "apps/dashboard",
        "apps/api",
        "src/hvac_agent/core",
        "src/hvac_agent/agent",
        "src/hvac_agent/cad",
        "src/hvac_agent/simulation",
        "src/hvac_agent/prediction",
        "src/hvac_agent/pilot",
        "src/hvac_agent/knowledge",
        "src/hvac_agent/training",
        "src/hvac_agent/integrations",
        "configs/site",
        "deployment/dgx-spark",
        "scripts",
        "tests",
        "docs",
    ):
        assert (REPO_ROOT / folder).is_dir(), f"missing folder: {folder}/"
