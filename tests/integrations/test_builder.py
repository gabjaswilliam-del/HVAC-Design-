"""Assembling a plant from a site definition.

The acceptance for this step is that a plant can be built from the configuration files
and that changing the machine counts changes the plant rather than breaking it. Both are
checked here against real engine objects.

Every site these tests build is written into a temporary directory, including its
performance workbook, which the shipped example deliberately does not carry. A workbook
is customer data; `conftest.write_spec_workbook` generates a synthetic one, which is also
what makes these tests reproducible from this repository alone.
"""

from __future__ import annotations

import io
import pathlib
import shutil
from contextlib import redirect_stdout

import pytest

yaml = pytest.importorskip("yaml")

from hvac_agent.core.metrics import DeviceFamily
from hvac_agent.core.site import load_site
from hvac_agent.integrations.phyvac.builder import PlantBuildError, build_plant
from hvac_agent.integrations.phyvac.hydraulics import solve_header

from .conftest import write_spec_workbook

EXAMPLE = pathlib.Path(__file__).resolve().parents[2] / "configs" / "site"


def site_at(directory: pathlib.Path, **counts: int) -> pathlib.Path:
    """A copy of the shipped example, resized, with a workbook beside it."""
    shutil.copytree(EXAMPLE, directory, dirs_exist_ok=True)

    if counts:
        topology = yaml.safe_load((directory / "topology.yaml").read_text(encoding="utf-8"))
        _resize(topology, counts)
        (directory / "topology.yaml").write_text(
            yaml.safe_dump(topology, sort_keys=False), encoding="utf-8"
        )

    equipment = yaml.safe_load((directory / "equipment.yaml").read_text(encoding="utf-8"))
    table = equipment["equipment"]["chiller_a"]["performance_table"]
    write_spec_workbook(directory / table["workbook"], sheet_name=table["sheet"])
    return directory


def _resize(topology: dict, counts: dict[str, int]) -> None:
    """Change how many machines the plant has, keeping its links consistent.

    Rebuilding the link set rather than editing it is what a CAD extraction would do:
    propose the family's connections for the new counts, each marked for review.
    """
    template = {device["family"]: device for device in topology["devices"]}
    for family, count in counts.items():
        others = [d for d in topology["devices"] if d["family"] != family]
        pattern = dict(template[family])
        pattern.pop("role", None)
        resized = []
        for index in range(1, count + 1):
            device = dict(pattern)
            device["id"] = f"{family}_{index}"
            resized.append(device)
        topology["devices"] = others + resized

    ids = {
        family: [d["id"] for d in topology["devices"] if d["family"] == family]
        for family in {d["family"] for d in topology["devices"]}
    }
    chillers = sorted(ids.get("chiller_plant", []))
    towers = sorted(ids.get("cooling_towers", []))
    chw = sorted(ids.get("chilled_water_pump_pri", []))
    cw = sorted(ids.get("cooling_water_pump", []))

    links = []
    for tower in towers:
        links += [
            {"from": [tower, "water_out"], "to": ["bus", "cw_supply"],
             "medium": "cw", "evidence": "drawing"},
            {"from": ["bus", "cw_return"], "to": [tower, "water_in"],
             "medium": "cw", "evidence": "drawing"},
        ]
    for pump in cw:
        links.append({"from": ["bus", "cw_supply"], "to": [pump, "suction"],
                      "medium": "cw", "evidence": "drawing"})
    for pump, chiller in zip(cw, chillers):
        links.append({"from": [pump, "discharge"], "to": [chiller, "cond_in"],
                      "medium": "cw", "evidence": "inferred"})
    # A condenser pump beyond the chiller count is a header pump: it discharges to the
    # header rather than into a chiller of its own.
    for pump in cw[len(chillers):]:
        links.append({"from": [pump, "discharge"], "to": ["bus", "cw_supply"],
                      "medium": "cw", "evidence": "unknown"})
    for chiller in chillers:
        links += [
            {"from": [chiller, "cond_out"], "to": ["bus", "cw_return"],
             "medium": "cw", "evidence": "drawing"},
            {"from": ["bus", "chw_return"], "to": [chiller, "evap_in"],
             "medium": "chw", "evidence": "drawing"},
        ]
    for chiller, pump in zip(chillers, chw):
        links.append({"from": [chiller, "evap_out"], "to": [pump, "suction"],
                      "medium": "chw", "evidence": "inferred"})
    for pump in chw:
        links.append({"from": [pump, "discharge"], "to": ["bus", "chw_supply"],
                      "medium": "chw", "evidence": "drawing"})
    links += [
        {"from": ["bus", "chw_supply"], "to": ["terminal", "water_in"],
         "medium": "chw", "evidence": "drawing"},
        {"from": ["terminal", "water_out"], "to": ["bus", "chw_return"],
         "medium": "chw", "evidence": "drawing"},
    ]
    topology["links"] = links

    keep = {"chw_bypass", "cw_bypass", "terminal_valve"}
    valves = [valve for valve in topology["valves"] if valve["id"] in keep]
    for chiller in chillers:
        valves += [
            {"id": f"{chiller}_chw", "equipment": "isolation_valve_chw",
             "evidence": "drawing", "at": [chiller, "evap_out"]},
            {"id": f"{chiller}_cw", "equipment": "isolation_valve_cw",
             "evidence": "drawing", "at": [chiller, "cond_in"]},
        ]
    for tower in towers:
        valves.append({"id": f"{tower}_cw", "equipment": "isolation_valve_ct",
                       "evidence": "drawing", "at": [tower, "water_in"]})
    topology["valves"] = valves


@pytest.fixture
def plant(tmp_path):
    return build_plant(load_site(site_at(tmp_path / "site")))


# --- it assembles ---------------------------------------------------------------------


def test_the_shipped_example_becomes_a_plant(plant):
    assert len(plant.chillers) == 2
    assert len(plant.chilled_water_pumps) == 3
    assert len(plant.cooling_water_pumps) == 3
    assert len(plant.cooling_towers) == 2
    assert plant.terminal is not None
    assert set(plant.valves) >= {"chw_bypass", "cw_bypass", "terminal_valve"}


def test_the_machines_carry_the_configured_data(plant):
    # The chiller's rating comes from the workbook, the pump's from the catalogue.
    assert plant.ratings.chiller_capacity_kw > 0.0
    assert plant.chilled_water_pumps[0].g_d == pytest.approx(1.83)
    assert plant.cooling_water_pumps[0].g_d == pytest.approx(2.58)
    assert plant.cooling_towers[0].pw_d == pytest.approx(5.5)


def test_the_layout_matches_the_topology(plant):
    # Standby machines are counted, but not as duty.
    assert plant.layout.chilled_water_pumps == 3
    assert plant.layout.chilled_water_pumps_duty == 2
    assert plant.layout.cooling_water_pumps_duty == 2


def test_device_ids_come_through_for_the_point_vocabulary(plant):
    assert plant.device_ids[DeviceFamily.CHILLER] == ("chiller_plant_1", "chiller_plant_2")
    assert plant.device_ids[DeviceFamily.COOLING_TOWER][0] == "cooling_towers_1"


# --- any number of machines -----------------------------------------------------------


@pytest.mark.parametrize("chillers", [1, 3, 4, 5])
def test_a_plant_of_any_size_assembles(tmp_path, chillers):
    # The acceptance criterion for this step. The reference builder is written around one
    # site's counts and clamps indices when they run out.
    site = site_at(
        tmp_path / "site",
        chiller_plant=chillers,
        chilled_water_pump_pri=chillers + 1,
        cooling_water_pump=chillers + 1,
        cooling_towers=chillers * 2,
    )
    plant = build_plant(load_site(site))

    assert len(plant.chillers) == chillers
    assert len(plant.cooling_towers) == chillers * 2
    assert len(plant.chilled_header.sources) == chillers + 1
    # Every tower is a consumer on the condenser header, plus the bypass.
    assert len(plant.condenser_header.sinks) == chillers * 2 + 1


@pytest.mark.parametrize("chillers", [1, 3, 5])
def test_a_plant_of_any_size_closes_its_headers(tmp_path, chillers):
    # Assembling is not enough: the branches have to be ones the solver can balance.
    # This is C1 and C3 meeting, and it is the first point where the two are exercised
    # together.
    site = site_at(
        tmp_path / "site",
        chiller_plant=chillers,
        chilled_water_pump_pri=chillers,
        cooling_water_pump=chillers,
        cooling_towers=chillers,
    )
    plant = build_plant(load_site(site))

    for header in (plant.chilled_header, plant.condenser_header):
        for sink in header.sinks:
            if sink.valve is not None:
                sink.valve.vlv = 0.8
        for source in header.sources:
            source.pump.inv = 1.0

        balance = solve_header(list(header.sources), list(header.sinks))
        assert balance.total_source_flow == pytest.approx(balance.total_sink_flow, abs=1e-3)
        assert len(balance.source_flows) == len(header.sources)


# --- connections come from the topology -----------------------------------------------


def test_a_pump_is_paired_with_the_chiller_the_links_name(plant):
    for family, prefix in (
        (DeviceFamily.CHILLED_WATER_PUMP, "chilled_water_pump_pri"),
        (DeviceFamily.COOLING_WATER_PUMP, "cooling_water_pump"),
    ):
        assert plant.roster.paired[family] == {
            "chiller_plant_1": f"{prefix}_1",
            "chiller_plant_2": f"{prefix}_2",
        }


def test_an_unpaired_pump_is_reported_rather_than_given_a_neighbour(plant):
    # The third pump is standby and the drawing does not record which chiller it backs.
    # The reference clamps the index (`chillers[min(i, n - 1)]`) so it silently pairs
    # with the last one; here it is a header pump and the unknown link is in the caveats.
    assert plant.roster.header_pumps(DeviceFamily.CHILLED_WATER_PUMP) == (
        "chilled_water_pump_pri_3",
    )
    assert any("unknown" in caveat for caveat in plant.caveats)


def test_the_pairing_follows_the_links_not_the_numbering(tmp_path):
    # Wire chiller 1 to pump 2 and chiller 2 to pump 1. The roster must say so, which is
    # the whole difference from pairing pump n with chiller n.
    site = site_at(tmp_path / "site")
    topology = yaml.safe_load((site / "topology.yaml").read_text(encoding="utf-8"))
    swap_pairing(topology)
    (site / "topology.yaml").write_text(yaml.safe_dump(topology, sort_keys=False), encoding="utf-8")

    plant = build_plant(load_site(site))
    assert plant.roster.paired[DeviceFamily.CHILLED_WATER_PUMP] == {
        "chiller_plant_1": "chilled_water_pump_pri_2",
        "chiller_plant_2": "chilled_water_pump_pri_1",
    }
    assert plant.roster.paired[DeviceFamily.COOLING_WATER_PUMP] == {
        "chiller_plant_1": "cooling_water_pump_2",
        "chiller_plant_2": "cooling_water_pump_1",
    }


def swap_pairing(topology: dict) -> None:
    """Pair chiller 1 with pump 2 and chiller 2 with pump 1, on both sides."""
    swap = {"chiller_plant_1": "chiller_plant_2", "chiller_plant_2": "chiller_plant_1"}
    for link in topology["links"]:
        ends = (link["from"], link["to"])
        if any(end[0].startswith(("chilled_water_pump", "cooling_water_pump")) for end in ends):
            for end in ends:
                end[0] = swap.get(end[0], end[0])


def test_no_exchanger_resistance_is_added_to_a_pump_branch(plant):
    # Recording a finding rather than a preference. The reference's pump branch reads
    # `kr_pipe + getattr(chiller, "kr_ch", 0.0)`, which looks like it adds the
    # evaporator's drop — but `kr_ch` is an attribute of the engine's air-source heat
    # pump, not of Chiller, so the default fires every time and the term is always zero.
    # The drop is therefore inside whatever branch resistance was fitted against
    # measurements, and adding it now would count it twice.
    assert not hasattr(plant.chillers[0], "kr_ch")
    assert plant.chilled_header.sources[0].kr_pipe == pytest.approx(
        plant.chilled_header.sources[2].kr_pipe
    )


def test_the_plant_carries_the_caveats_of_the_site_it_was_built_from(plant):
    assert any("inferred" in caveat for caveat in plant.caveats)
    assert any("not calibrated" in caveat for caveat in plant.caveats)


# --- calibration reaches the engine ----------------------------------------------------


def test_a_fitted_pump_curve_reaches_the_engine(tmp_path):
    # equipment.yaml stays nameplate; the overlay is what the engine ends up with.
    site = site_at(tmp_path / "site")
    physics = yaml.safe_load((site / "calibration" / "physics.yaml").read_text(encoding="utf-8"))
    physics["fits"] = [
        {
            "provenance": {"fitted_from": "this_site", "fitted_at": "2026-05-02",
                           "method": "least_squares"},
            "values": {"equipment.chw_pump_a.rated.flow_m3_per_min": 4.25},
        }
    ]
    (site / "calibration" / "physics.yaml").write_text(
        yaml.safe_dump(physics, sort_keys=False), encoding="utf-8"
    )

    plant = build_plant(load_site(site))
    assert plant.chilled_water_pumps[0].g_d == pytest.approx(4.25)
    assert not any("not calibrated" in caveat for caveat in plant.caveats)


def test_fitted_pipe_resistance_reaches_the_branches(tmp_path):
    site = site_at(tmp_path / "site")
    physics = yaml.safe_load((site / "calibration" / "physics.yaml").read_text(encoding="utf-8"))
    physics["fits"] = [
        {
            "provenance": {"fitted_from": "this_site", "fitted_at": "2026-03-15",
                           "method": "optuna_tpe"},
            "values": {"hydraulics.chw_pump_branch.kr_pipe": 1.9248},
        }
    ]
    (site / "calibration" / "physics.yaml").write_text(
        yaml.safe_dump(physics, sort_keys=False), encoding="utf-8"
    )

    plant = build_plant(load_site(site))
    # The branch carries the fitted pipe resistance plus its chiller's exchanger.
    assert plant.chilled_header.sources[2].kr_pipe == pytest.approx(1.9248)


# --- the engine is kept quiet ----------------------------------------------------------


def test_assembly_prints_nothing(tmp_path):
    # CoolingTower warns about its uncalibrated UA on every construction, so a plant with
    # twelve towers would emit twelve lines. One redirect covers the whole assembly.
    site = site_at(tmp_path / "site", cooling_towers=12)
    buffer = io.StringIO()
    with redirect_stdout(buffer):
        plant = build_plant(load_site(site))

    assert len(plant.cooling_towers) == 12
    assert buffer.getvalue() == ""


# --- it refuses rather than guessing ---------------------------------------------------


def test_a_missing_workbook_names_the_machine_and_the_file(tmp_path):
    directory = tmp_path / "site"
    shutil.copytree(EXAMPLE, directory, dirs_exist_ok=True)  # no workbook written

    with pytest.raises(PlantBuildError) as raised:
        build_plant(load_site(directory))

    message = str(raised.value)
    assert "chiller_plant_1" in message
    assert "equipment_spec.xlsx" in message
    assert "never committed" in message


def test_a_workbook_without_the_named_sheet_is_reported(tmp_path):
    site = site_at(tmp_path / "site")
    equipment = yaml.safe_load((site / "equipment.yaml").read_text(encoding="utf-8"))
    equipment["equipment"]["chiller_a"]["performance_table"]["sheet"] = "NotThere"
    (site / "equipment.yaml").write_text(
        yaml.safe_dump(equipment, sort_keys=False), encoding="utf-8"
    )

    with pytest.raises(PlantBuildError) as raised:
        build_plant(load_site(site))
    assert "NotThere" in str(raised.value)
