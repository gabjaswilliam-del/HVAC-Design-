"""The shipped site-configuration example must stay consistent with the core vocabulary.

B3 will add the loader and its validation. This is narrower and exists now for a
different reason: the example in `configs/site/` is the schema's only statement of
itself, and an example that drifts from `core.metrics` teaches the wrong shape to
whoever reads it next. Every check here is one a reader would otherwise have to make by
eye across two directories.
"""

from __future__ import annotations

import pathlib

import pytest

yaml = pytest.importorskip("yaml")

from hvac_agent.core.metrics import DeviceFamily, family_of

CONFIG_DIR = pathlib.Path(__file__).resolve().parents[2] / "configs" / "site"

EVIDENCE = {"confirmed", "drawing", "inferred", "unknown"}


def load(name: str) -> dict:
    return yaml.safe_load((CONFIG_DIR / name).read_text(encoding="utf-8"))


@pytest.fixture(scope="module")
def site() -> dict:
    return load("site.yaml")


@pytest.fixture(scope="module")
def topology() -> dict:
    return load("topology.yaml")


def test_the_manifest_lists_files_that_exist(site):
    for role, name in site["files"].items():
        assert (CONFIG_DIR / name).is_file(), f"{role} -> {name} is missing"


def test_device_families_are_the_ones_core_knows(topology):
    for device in topology["devices"]:
        assert device["family"] in set(DeviceFamily), device["id"]


def test_device_ids_resolve_to_their_declared_family(topology):
    # A point name is "<device_id>:<metric>", so an id that core cannot parse back into
    # a family would produce observations nothing downstream could interpret.
    for device in topology["devices"]:
        assert family_of(device["id"]) == device["family"], device["id"]


def test_every_device_link_and_valve_carries_evidence(topology):
    for section in ("devices", "links", "valves"):
        for entry in topology[section]:
            assert entry.get("evidence") in EVIDENCE, f"{section}: {entry}"
    assert topology["terminal"].get("evidence") in EVIDENCE


def test_links_only_reference_declared_devices_and_buses(topology):
    known = {d["id"] for d in topology["devices"]}
    known.add(topology["terminal"]["id"])
    buses = {b["id"] for b in topology["buses"]}

    for link in topology["links"]:
        for end in (link["from"], link["to"]):
            owner, name = end
            if owner == "bus":
                assert name in buses, f"unknown bus {name!r} in {link}"
            else:
                assert owner in known, f"unknown device {owner!r} in {link}"


def test_devices_and_valves_reference_declared_equipment(topology):
    catalogue = load("equipment.yaml")["equipment"]
    for device in topology["devices"]:
        assert device["equipment"] in catalogue, device["id"]
    for valve in topology["valves"]:
        assert valve["equipment"] in catalogue, valve["id"]


def test_the_example_ships_uncalibrated(site):
    # The point of the two-tier split is that this is visible rather than inferred from
    # the numbers. If someone adds a fit to the example, they must also give it
    # provenance, so this test changes shape rather than simply being deleted.
    for name in ("calibration_physics", "calibration_display"):
        assert load(site["files"][name])["fits"] == []


def test_no_workbook_or_customer_path_is_committed():
    # `workbook` resolves against the configuration directory, and the real file lives
    # beside the real configuration in ignored var/. A path that escapes the directory
    # would be reaching at another site's data, which is how the reference
    # implementation ended up reading one customer's chiller curves at another's plant.
    table = load("equipment.yaml")["equipment"]["chiller_a"]["performance_table"]
    workbook = pathlib.PurePosixPath(table["workbook"])
    assert not workbook.is_absolute()
    assert ".." not in workbook.parts
    assert not (CONFIG_DIR / workbook).exists(), "customer data must not be committed"
