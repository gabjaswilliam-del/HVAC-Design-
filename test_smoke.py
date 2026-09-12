"""A trivial test so that `pytest` and CI have something to run.

There is no application code yet. All this checks is that the repo still has the
layout its README describes. Delete it once there are real tests.
"""

from pathlib import Path

REPO_ROOT = Path(__file__).parent


def test_layout_folders_exist():
    for folder in ("agent", "prediction", "cad", "training"):
        assert (REPO_ROOT / folder).is_dir(), f"missing folder: {folder}/"
