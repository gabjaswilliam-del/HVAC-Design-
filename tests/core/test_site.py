"""The site loader, and mainly the things it refuses.

Loading a correct configuration is the easy half and one test covers it. The rest of this
file is about rejection, because every check here stands for a way the reference
implementation goes wrong quietly: a name resolved with `dict.get(key, default)` so a typo
becomes a default, a fitted constant indistinguishable from a nameplate one, a workbook
path reaching into another customer's data directory. A loader that accepted those would
be no better than no loader.

The fixtures build a configuration in a temporary directory rather than copying the
shipped example, so a test that breaks points at the rule it was testing instead of at
whatever the example happens to contain today.
"""

from __future__ import annotations

import pathlib
import shutil
from typing import Any

import pytest

yaml = pytest.importorskip("yaml")

from hvac_agent.core.metrics import DeviceFamily
from hvac_agent.core.site import (
    Evidence,
    SiteConfigError,
    TopologyFamily,
    load_site,
)

EXAMPLE = pathlib.Path(__file__).resolve().parents[2] / "configs" / "site"


# --- a minimal well-formed site ------------------------------------------------------
#
# One chiller, one pump each side, one tower. Smaller than any real plant, and the
# smallest thing the family will accept.


def minimal() -> dict[str, Any]:
    return {
        "site.yaml": {
            "schema_version": 1,
            "revision": 1,
            "topology_family": str(TopologyFamily.WATER_COOLED_CHILLER_PLANT_V1),
            "files": {
                "topology": "topology.yaml",
                "equipment": "equipment.yaml",
                "control": "control.yaml",
                "boundary": "boundary.yaml",
                "calibration_physics": "calibration/physics.yaml",
                "calibration_display": "calibration/display.yaml",
            },
        },
        "topology.yaml": {
            "devices": [
                {"id": "chiller_plant_1", "family": "chiller_plant",
                 "equipment": "chiller_a", "evidence": "confirmed"},
                {"id": "chilled_water_pump_pri_1", "family": "chilled_water_pump_pri",
                 "equipment": "pump_a", "evidence": "confirmed"},
                {"id": "cooling_water_pump_1", "family": "cooling_water_pump",
                 "equipment": "cw_pump_a", "evidence": "confirmed"},
                {"id": "cooling_towers_1", "family": "cooling_towers",
                 "equipment": "tower_a", "evidence": "drawing"},
            ],
            "buses": [
                {"id": "cw_supply", "medium": "cw"},
                {"id": "cw_return", "medium": "cw"},
                {"id": "chw_supply", "medium": "chw"},
                {"id": "chw_return", "medium": "chw"},
            ],
            "terminal": {"id": "terminal", "evidence": "confirmed"},
            "links": [
                {"from": ["cooling_towers_1", "water_out"], "to": ["bus", "cw_supply"],
                 "medium": "cw", "evidence": "confirmed"},
                {"from": ["cooling_water_pump_1", "discharge"],
                 "to": ["chiller_plant_1", "cond_in"],
                 "medium": "cw", "evidence": "inferred", "note": "positional pairing"},
                # The rest of the family's connections for one of each machine. Every
                # port has its connection, so the site is complete and nothing more.
                {"from": ["bus", "cw_return"], "to": ["cooling_towers_1", "water_in"],
                 "medium": "cw", "evidence": "confirmed"},
                {"from": ["bus", "cw_supply"], "to": ["cooling_water_pump_1", "suction"],
                 "medium": "cw", "evidence": "confirmed"},
                {"from": ["chiller_plant_1", "cond_out"], "to": ["bus", "cw_return"],
                 "medium": "cw", "evidence": "confirmed"},
                {"from": ["bus", "chw_return"], "to": ["chiller_plant_1", "evap_in"],
                 "medium": "chw", "evidence": "confirmed"},
                {"from": ["chiller_plant_1", "evap_out"],
                 "to": ["chilled_water_pump_pri_1", "suction"],
                 "medium": "chw", "evidence": "confirmed"},
                {"from": ["chilled_water_pump_pri_1", "discharge"], "to": ["bus", "chw_supply"],
                 "medium": "chw", "evidence": "confirmed"},
                {"from": ["bus", "chw_supply"], "to": ["terminal", "water_in"],
                 "medium": "chw", "evidence": "confirmed"},
                {"from": ["terminal", "water_out"], "to": ["bus", "chw_return"],
                 "medium": "chw", "evidence": "confirmed"},
            ],
            "valves": [
                {"id": "chw_bypass", "equipment": "valve_a", "evidence": "confirmed",
                 "across": [["bus", "chw_supply"], ["bus", "chw_return"]]},
                {"id": "chiller_plant_1_chw", "equipment": "valve_a",
                 "evidence": "drawing", "at": ["chiller_plant_1", "evap_out"]},
            ],
        },
        "equipment.yaml": {
            "equipment": {
                "chiller_a": {
                    "family": "chiller_plant",
                    "performance_table": {"workbook": "equipment_spec.xlsx",
                                          "sheet": "ChillerA"},
                },
                "pump_a": {"family": "chilled_water_pump_pri",
                           "curve": {"pressure": [300.0, 85.0, -51.0]}},
                "cw_pump_a": {"family": "cooling_water_pump",
                              "curve": {"pressure": [330.0, 68.0, -29.0]}},
                "tower_a": {"family": "cooling_towers",
                            "design": {"fan_power_kw": 5.5}},
                "valve_a": {"family": "valve", "cv_max": 1800.0},
            }
        },
        "control.yaml": {"pid": {"terminal_valve": {"kp": 0.04, "ti": 400.0}}},
        "boundary.yaml": {"heat_rejection_ratio": 1.25},
        "calibration/physics.yaml": {
            "defaults": {"hydraulics": {"chw_pump_branch": {"kr_pipe": 0.30}}},
            "fits": [],
        },
        "calibration/display.yaml": {
            "defaults": {"pressure_mapping": {"chw_return_base_kpa": 350.0}},
            "fits": [],
        },
    }


def write(directory: pathlib.Path, documents: dict[str, Any]) -> pathlib.Path:
    for name, document in documents.items():
        path = directory / name
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(yaml.safe_dump(document, sort_keys=False), encoding="utf-8")
    return directory


@pytest.fixture
def site_dir(tmp_path: pathlib.Path) -> pathlib.Path:
    return write(tmp_path, minimal())


def problems_from(directory: pathlib.Path) -> tuple[str, ...]:
    with pytest.raises(SiteConfigError) as raised:
        load_site(directory)
    return raised.value.problems


def broken(tmp_path: pathlib.Path, **changes: Any) -> pathlib.Path:
    """A minimal site with one file replaced, for a test that expects a rejection."""
    documents = minimal()
    documents.update(changes)
    return write(tmp_path, documents)


# --- it loads ------------------------------------------------------------------------


def test_a_well_formed_site_loads(site_dir):
    site = load_site(site_dir)
    assert site.revision == 1
    assert site.topology.family is TopologyFamily.WATER_COOLED_CHILLER_PLANT_V1
    assert site.topology.counts() == {
        DeviceFamily.CHILLER: 1,
        DeviceFamily.CHILLED_WATER_PUMP: 1,
        DeviceFamily.COOLING_WATER_PUMP: 1,
        DeviceFamily.COOLING_TOWER: 1,
    }
    assert len(site.topology.valves) == 2


def test_the_shipped_example_loads():
    site = load_site(EXAMPLE)
    assert site.topology.counts()[DeviceFamily.CHILLER] == 2
    assert not site.is_calibrated


# --- evidence ------------------------------------------------------------------------


def test_an_inferred_link_is_reported_as_an_assumption(site_dir):
    site = load_site(site_dir)
    assumptions = site.topology.assumptions()
    assert any("inferred" in line and "positional pairing" in line for line in assumptions)
    # A link read off the drawing is evidence, weak but real, and is not listed.
    assert not any("cooling_towers_1.water_out" in line for line in assumptions)


def test_drawing_evidence_counts_as_evidence():
    assert Evidence.DRAWING.is_evidence
    assert Evidence.CONFIRMED.is_evidence
    assert not Evidence.INFERRED.is_evidence
    assert not Evidence.UNKNOWN.is_evidence


def test_evidence_is_required(tmp_path):
    topology = minimal()["topology.yaml"]
    del topology["devices"][0]["evidence"]
    problems = problems_from(broken(tmp_path, **{"topology.yaml": topology}))
    assert any("chiller_plant_1" in problem for problem in problems)


# --- references ----------------------------------------------------------------------


def test_a_link_to_an_unknown_device_is_rejected(tmp_path):
    topology = minimal()["topology.yaml"]
    topology["links"][0]["from"] = ["cooling_towers_9", "water_out"]
    problems = problems_from(broken(tmp_path, **{"topology.yaml": topology}))
    assert any("unknown device 'cooling_towers_9'" in problem for problem in problems)


def test_a_link_to_a_port_the_family_does_not_have_is_rejected(tmp_path):
    topology = minimal()["topology.yaml"]
    topology["links"][1]["to"] = ["chiller_plant_1", "inlet"]
    problems = problems_from(broken(tmp_path, **{"topology.yaml": topology}))
    assert any("has no port 'inlet'" in problem for problem in problems)
    # The message names the ports it does have, because the author is guessing otherwise.
    assert any("cond_in" in problem for problem in problems)


def test_a_device_naming_absent_equipment_is_rejected(tmp_path):
    topology = minimal()["topology.yaml"]
    topology["devices"][0]["equipment"] = "chiller_b"
    problems = problems_from(broken(tmp_path, **{"topology.yaml": topology}))
    assert any("chiller_b" in problem for problem in problems)


def test_equipment_for_the_wrong_family_is_rejected(tmp_path):
    topology = minimal()["topology.yaml"]
    topology["devices"][0]["equipment"] = "pump_a"
    problems = problems_from(broken(tmp_path, **{"topology.yaml": topology}))
    assert any("is for 'chilled_water_pump_pri'" in problem for problem in problems)


def test_a_device_id_that_contradicts_its_family_is_rejected(tmp_path):
    # Point names are "<device_id>:<metric>" and core derives the family from the id, so
    # an id saying one thing and a family field saying another would produce observations
    # nothing downstream could interpret.
    topology = minimal()["topology.yaml"]
    topology["devices"][0]["id"] = "chiller_1"
    problems = problems_from(broken(tmp_path, **{"topology.yaml": topology}))
    assert any("does not match family" in problem for problem in problems)


def test_a_missing_required_bus_is_rejected(tmp_path):
    topology = minimal()["topology.yaml"]
    topology["buses"] = [bus for bus in topology["buses"] if bus["id"] != "cw_return"]
    problems = problems_from(broken(tmp_path, **{"topology.yaml": topology}))
    assert any("requires a bus 'cw_return'" in problem for problem in problems)


def test_every_problem_is_reported_not_just_the_first(tmp_path):
    topology = minimal()["topology.yaml"]
    topology["devices"][0]["equipment"] = "nope"
    topology["links"][0]["from"] = ["cooling_towers_9", "water_out"]
    topology["buses"] = [bus for bus in topology["buses"] if bus["id"] != "chw_return"]
    assert len(problems_from(broken(tmp_path, **{"topology.yaml": topology}))) >= 3


# --- connections the family assembles ------------------------------------------------


def test_a_topology_with_no_links_is_rejected(tmp_path):
    # The links were once read for pump pairing and nothing else, so a topology with every
    # link deleted loaded and simulated exactly the same plant as the complete one.
    topology = minimal()["topology.yaml"]
    topology["links"] = []
    problems = problems_from(broken(tmp_path, **{"topology.yaml": topology}))
    for port in (
        "chiller_plant_1.evap_in", "chiller_plant_1.cond_out",
        "chilled_water_pump_pri_1.discharge", "cooling_water_pump_1.suction",
        "cooling_towers_1.water_in", "terminal.water_out",
    ):
        assert any(port in problem for problem in problems), port


def test_a_machine_missing_one_connection_is_rejected(tmp_path):
    topology = minimal()["topology.yaml"]
    topology["links"] = [
        link for link in topology["links"] if link["to"] != ["cooling_towers_1", "water_in"]
    ]
    problems = problems_from(broken(tmp_path, **{"topology.yaml": topology}))
    assert problems == (
        "topology.yaml: cooling_towers_1.water_in has 0 connection(s); "
        "water_cooled_chiller_plant_v1 needs 1",
    )


def test_a_connection_the_family_does_not_have_is_rejected(tmp_path):
    # A tower discharging straight into the terminal is not a plant this family can
    # assemble, and simulating it as though it were would be inventing a plant.
    topology = minimal()["topology.yaml"]
    topology["links"].append(
        {"from": ["cooling_towers_1", "water_out"], "to": ["terminal", "water_in"],
         "medium": "cw", "evidence": "drawing"}
    )
    problems = problems_from(broken(tmp_path, **{"topology.yaml": topology}))
    assert any("has no connection of this kind" in problem for problem in problems)


def test_a_second_pump_on_one_chiller_is_rejected(tmp_path):
    # Two pumps in series with one chiller is a parallel arrangement the family does not
    # model; the port count is what catches it.
    documents = minimal()
    topology = documents["topology.yaml"]
    topology["devices"].append(
        {"id": "chilled_water_pump_pri_2", "family": "chilled_water_pump_pri",
         "equipment": "pump_a", "evidence": "confirmed"}
    )
    topology["links"] += [
        {"from": ["chiller_plant_1", "evap_out"], "to": ["chilled_water_pump_pri_2", "suction"],
         "medium": "chw", "evidence": "drawing"},
        {"from": ["chilled_water_pump_pri_2", "discharge"], "to": ["bus", "chw_supply"],
         "medium": "chw", "evidence": "drawing"},
    ]
    problems = problems_from(broken(tmp_path, **{"topology.yaml": topology}))
    assert any("chiller_plant_1.evap_out has 2 connection(s)" in p for p in problems)


def test_a_link_declaring_the_wrong_medium_is_rejected(tmp_path):
    topology = minimal()["topology.yaml"]
    topology["links"][0]["medium"] = "chw"  # a tower's outlet carries condenser water
    problems = problems_from(broken(tmp_path, **{"topology.yaml": topology}))
    assert any("declared as chw, but this connection carries cw" in p for p in problems)


def test_a_chiller_on_the_header_is_fed_by_a_header_pump(tmp_path):
    # A chiller may open onto the header instead of into a pump of its own; a pump linked
    # to the header and to no chiller then feeds it. That is a supported arrangement.
    topology = minimal()["topology.yaml"]
    for link in topology["links"]:
        if link["from"] == ["chiller_plant_1", "evap_out"]:
            link["to"] = ["bus", "chw_supply"]
    site = load_site(broken(tmp_path, **{"topology.yaml": topology}))
    assert site.topology.paired_pumps(DeviceFamily.CHILLED_WATER_PUMP) == {}


def test_a_chiller_on_the_header_with_no_header_pump_is_rejected(tmp_path):
    # In the shipped example, put chiller 2 on the header and remove every pump that is
    # not already some chiller's own: nothing is left to move chiller 2's water.
    directory = tmp_path / "site"
    shutil.copytree(EXAMPLE, directory)
    topology = yaml.safe_load((directory / "topology.yaml").read_text(encoding="utf-8"))
    gone = {"chilled_water_pump_pri_2", "chilled_water_pump_pri_3"}
    topology["devices"] = [d for d in topology["devices"] if d["id"] not in gone]
    topology["links"] = [
        link for link in topology["links"]
        if link["from"][0] not in gone and link["to"][0] not in gone
    ]
    topology["links"].append(
        {"from": ["chiller_plant_2", "evap_out"], "to": ["bus", "chw_supply"],
         "medium": "chw", "evidence": "drawing"}
    )
    (directory / "topology.yaml").write_text(yaml.safe_dump(topology), encoding="utf-8")

    assert problems_from(directory) == (
        "topology.yaml: chiller_plant_2 has no chilled_water_pump_pri of its own and there "
        "is no header chilled_water_pump_pri to feed it",
    )


def test_the_shipped_example_pairs_each_chiller_with_its_own_pumps():
    site = load_site(EXAMPLE)
    assert site.topology.paired_pumps(DeviceFamily.CHILLED_WATER_PUMP) == {
        "chiller_plant_1": "chilled_water_pump_pri_1",
        "chiller_plant_2": "chilled_water_pump_pri_2",
    }
    assert site.topology.paired_pumps(DeviceFamily.COOLING_WATER_PUMP) == {
        "chiller_plant_1": "cooling_water_pump_1",
        "chiller_plant_2": "cooling_water_pump_2",
    }


# --- valve placement -----------------------------------------------------------------


def test_a_valve_needs_exactly_one_placement(tmp_path):
    topology = minimal()["topology.yaml"]
    topology["valves"][1]["across"] = [["bus", "cw_supply"], ["bus", "cw_return"]]
    problems = problems_from(broken(tmp_path, **{"topology.yaml": topology}))
    assert any("exactly one of 'at' or 'across'" in problem for problem in problems)


def test_the_schema_avoids_words_yaml_reads_as_booleans():
    # YAML 1.1 parses on/off/yes/no as booleans, so a valve written as
    # `on: [chiller_plant_1, evap_out]` silently becomes a key of True. This caught the
    # first draft of the example; the placement key is `at` for that reason.
    for path in sorted(EXAMPLE.rglob("*.yaml")):
        document = yaml.safe_load(path.read_text(encoding="utf-8"))
        for key in _all_keys(document):
            assert isinstance(key, str), f"{path.name}: {key!r} is not a string key"


def _all_keys(node: Any):
    if isinstance(node, dict):
        for key, value in node.items():
            yield key
            yield from _all_keys(value)
    elif isinstance(node, list):
        for item in node:
            yield from _all_keys(item)


# --- calibration ---------------------------------------------------------------------


def test_an_uncalibrated_site_says_so(site_dir):
    site = load_site(site_dir)
    assert not site.is_calibrated
    assert site.config_revision == "rev1-nameplate"
    assert any("not calibrated" in caveat for caveat in site.caveats())


def test_a_fit_overlays_the_defaults_without_editing_them(tmp_path):
    physics = minimal()["calibration/physics.yaml"]
    physics["fits"] = [
        {
            "provenance": {"fitted_from": "this_site", "fitted_at": "2026-03-15",
                           "method": "optuna_tpe", "data_window": ["2026-01-28", "2026-03-08"],
                           "residual_pct": 4.2},
            "values": {"hydraulics.chw_pump_branch.kr_pipe": 1.9248},
        }
    ]
    site = load_site(broken(tmp_path, **{"calibration/physics.yaml": physics}))

    assert site.is_calibrated
    assert site.config_revision == "rev1-calibrated"
    assert site.resolved_physics()["hydraulics"]["chw_pump_branch"]["kr_pipe"] == 1.9248
    # The default is still the default; the fit is an overlay, not an edit.
    assert site.physics.defaults["hydraulics"]["chw_pump_branch"]["kr_pipe"] == 0.30


def test_a_fit_may_replace_a_manufacturer_curve(tmp_path):
    # equipment.yaml stays nameplate; a refitted curve is an overlay like any other.
    physics = minimal()["calibration/physics.yaml"]
    physics["fits"] = [
        {
            "provenance": {"fitted_from": "this_site", "fitted_at": "2026-05-02",
                           "method": "least_squares"},
            "values": {"equipment.pump_a.curve.pressure": [415.1, 1.13, -0.53]},
        }
    ]
    site = load_site(broken(tmp_path, **{"calibration/physics.yaml": physics}))

    assert site.resolved_equipment()["pump_a"]["curve"]["pressure"] == [415.1, 1.13, -0.53]
    assert site.equipment["pump_a"]["curve"]["pressure"] == [300.0, 85.0, -51.0]


def test_borrowed_calibration_declares_itself(tmp_path):
    # The reference implementation copied one plant's fitted constants into at least five
    # others, undetectably, because a fitted value looks like a nameplate value in a file.
    physics = minimal()["calibration/physics.yaml"]
    physics["fits"] = [
        {
            "provenance": {"fitted_from": "another_plant", "fitted_at": "2026-03-15",
                           "method": "optuna_tpe"},
            "values": {"hydraulics.chw_pump_branch.kr_pipe": 1.9248},
        }
    ]
    site = load_site(broken(tmp_path, **{"calibration/physics.yaml": physics}))

    assert site.physics.borrowed_from() == ("another_plant",)
    assert any("fitted from another_plant" in caveat for caveat in site.caveats())


def test_a_fit_without_provenance_is_rejected(tmp_path):
    physics = minimal()["calibration/physics.yaml"]
    physics["fits"] = [{"values": {"hydraulics.chw_pump_branch.kr_pipe": 1.9248}}]
    problems = problems_from(broken(tmp_path, **{"calibration/physics.yaml": physics}))
    assert any("provenance is required" in problem for problem in problems)


def test_a_fit_naming_a_parameter_that_does_not_exist_is_rejected(tmp_path):
    # Otherwise a renamed parameter turns a calibration into a no-op: the overlay writes
    # a key nothing reads, and the site reports itself calibrated while behaving as
    # though it were not.
    physics = minimal()["calibration/physics.yaml"]
    physics["fits"] = [
        {
            "provenance": {"fitted_from": "this_site", "fitted_at": "2026-03-15",
                           "method": "optuna_tpe"},
            "values": {"hydraulics.chw_pump_branch.kr_pipework": 1.9248},
        }
    ]
    problems = problems_from(broken(tmp_path, **{"calibration/physics.yaml": physics}))
    assert any("does not name an existing parameter" in problem for problem in problems)


def test_an_absent_fits_key_is_rejected_but_an_empty_one_is_not(tmp_path):
    # "Not calibrated" has to be stated. A missing key could equally mean "forgot to
    # write it", and the difference decides what a result may claim.
    physics = minimal()["calibration/physics.yaml"]
    del physics["fits"]
    problems = problems_from(broken(tmp_path, **{"calibration/physics.yaml": physics}))
    assert any("'fits' is required" in problem for problem in problems)


# --- customer data -------------------------------------------------------------------


def test_a_workbook_path_may_not_escape_the_site_directory(tmp_path):
    # This is exactly what the reference configuration does: FuZhou falls back to a
    # workbook under another customer's data directory, so one plant simulates with
    # another plant's chiller curves.
    equipment = minimal()["equipment.yaml"]
    equipment["equipment"]["chiller_a"]["performance_table"]["workbook"] = (
        "../../ZhaoQingYiBao/data/1000RT_spec.xlsx"
    )
    problems = problems_from(broken(tmp_path, **{"equipment.yaml": equipment}))
    assert any("never reads another site's equipment data" in problem for problem in problems)


# --- manifest ------------------------------------------------------------------------


def test_a_future_schema_version_is_rejected(tmp_path):
    manifest = minimal()["site.yaml"]
    manifest["schema_version"] = 2
    problems = problems_from(broken(tmp_path, **{"site.yaml": manifest}))
    assert any("schema_version" in problem for problem in problems)


def test_an_unknown_topology_family_is_rejected(tmp_path):
    manifest = minimal()["site.yaml"]
    manifest["topology_family"] = "air_cooled_v1"
    problems = problems_from(broken(tmp_path, **{"site.yaml": manifest}))
    assert any("unknown topology_family" in problem for problem in problems)


def test_a_missing_file_is_reported_by_name(tmp_path):
    site_dir = write(tmp_path, minimal())
    (site_dir / "boundary.yaml").unlink()
    assert any("boundary.yaml: missing" in problem for problem in problems_from(site_dir))
