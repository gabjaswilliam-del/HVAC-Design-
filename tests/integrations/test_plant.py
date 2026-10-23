"""A whole plant, stepped.

These are the first tests in which every piece runs together: the builder assembles the
machines, the baseline decides what to run, the solver closes both headers, the engine
computes the machines, and an observation comes out. Everything here uses the shipped
example site with a generated workbook, so it is reproducible from this repository alone
and depends on no customer data.

The properties under test are the ones that say a plant is behaving as a plant rather
than merely running: what the header carries matches the load it was given, a plant with
nothing to do stops and stays stopped, and a day passes without the arithmetic falling
over. Agreement with a particular real plant is a different question and is measured
separately.
"""

from __future__ import annotations

import math
import pathlib
import shutil
from datetime import UTC, datetime

import pytest

yaml = pytest.importorskip("yaml")

from hvac_agent.core.actions import Action, ControlMode
from hvac_agent.core.metrics import DeviceFamily
from hvac_agent.core.observation import Origin
from hvac_agent.core.site import load_site
from hvac_agent.core.units import water_heat_flow_kw
from hvac_agent.integrations.phyvac.plant import PhyvacPlant
from hvac_agent.simulation.corrections import CorrectionGate, EquipmentLimits
from hvac_agent.simulation.run import PlantInputs, Run, Scenario

from .conftest import write_spec_workbook

EXAMPLE = pathlib.Path(__file__).resolve().parents[2] / "configs" / "site"
START = datetime(2026, 7, 1, tzinfo=UTC)

RATED_KW = 700.0
SHUTDOWN_BELOW_KW = 0.45 * 0.5 * RATED_KW  # down_at * last_unit_shutdown_factor


@pytest.fixture(scope="module")
def site_dir(tmp_path_factory) -> pathlib.Path:
    directory = tmp_path_factory.mktemp("site") / "site"
    shutil.copytree(EXAMPLE, directory)
    equipment = yaml.safe_load((directory / "equipment.yaml").read_text(encoding="utf-8"))
    table = equipment["equipment"]["chiller_a"]["performance_table"]
    write_spec_workbook(directory / table["workbook"], sheet_name=table["sheet"])
    return directory


@pytest.fixture
def plant(site_dir) -> PhyvacPlant:
    plant = PhyvacPlant(load_site(site_dir))
    plant.bind_run("run-test")
    return plant


def steady(load_kw: float, steps: int) -> tuple[PlantInputs, ...]:
    return tuple(
        PlantInputs(
            cooling_load_kw=load_kw, dry_bulb_temp_c=32.0, relative_humidity_percent=70.0
        )
        for _ in range(steps)
    )


def a_day() -> tuple[PlantInputs, ...]:
    """Twenty-four hours at ten-minute steps, load and weather both swinging."""
    return tuple(
        PlantInputs(
            cooling_load_kw=max(
                0.0, 1200.0 * (0.55 + 0.45 * math.sin((index - 40) / 144 * 2 * math.pi))
            ),
            dry_bulb_temp_c=28.0 + 6.0 * math.sin((index - 50) / 144 * 2 * math.pi),
            relative_humidity_percent=70.0,
        )
        for index in range(144)
    )


def drive(plant: PhyvacPlant, inputs: tuple[PlantInputs, ...]) -> Run:
    run = Run(
        plant,
        Scenario(name="test", start=START, inputs=inputs, step_minutes=10.0),
        config_revision="rev1-nameplate",
    )
    plant.bind_run(run.run_id)
    run.start()
    while run.status().steps_taken < len(inputs):
        run.step()
    return run


def chillers_on(observation) -> int:
    return int(
        sum(
            observation.value_of(f"{device}:running_state")
            for device in ("chiller_plant_1", "chiller_plant_2")
        )
    )


# --- it steps --------------------------------------------------------------------------


def test_a_plant_assembles_and_reports_its_initial_state(plant):
    observation = plant.reset(START)
    assert observation.timestamp == START
    assert observation.origin is Origin.SIMULATED
    assert chillers_on(observation) == 0


def test_every_point_in_the_site_vocabulary_is_reported(plant):
    observation = plant.reset(START)
    missing = set(plant.metrics.points) - set(observation.points)
    assert not missing, f"{len(missing)} points never reported, e.g. {sorted(missing)[:5]}"


def test_units_come_from_the_vocabulary_not_from_the_producer(plant):
    observation = plant.reset(START)
    assert observation["SYSTEM:chws_main_temp"].unit == "C"
    assert observation["SYSTEM:chw_main_current_flow"].unit == "m3/h"
    assert observation["chilled_water_pump_pri_1:frequency_setpoint"].unit == "Hz"


def test_observing_does_not_advance_the_plant(plant):
    from datetime import timedelta

    plant.reset(START)
    stepped = plant.step(steady(800.0, 1)[0])
    first, second = plant.observe(), plant.observe()

    assert first == second == stepped
    assert first.timestamp == START + timedelta(minutes=10)


# --- the header carries what the load asked for -------------------------------------------


def test_once_settled_the_chillers_remove_what_the_load_puts_in(plant):
    # The property that says the arithmetic is coupled rather than merely running: once
    # the second chiller is up, what the chillers remove — from the engine's own inlet and
    # outlet — is the load, to a fraction of a percent, and nothing accumulates. It fails
    # if the bypass mixing node is missing, if a chiller is given the wrong flow, or if the
    # units are mismatched anywhere along the way.
    #
    # Not from the first steps. One chiller runs until the switch interval lets the
    # second start, the loop warms meanwhile, and the step that brings the second in
    # removes more than the load while it pulls the loop back down. This test once
    # required the header cooling to equal the load from step 4, which only held because
    # it was reconstructed from the demand rather than taken from the chillers.
    run = drive(plant, steady(800.0, 12))
    for observation in run.history()[5:]:
        assert observation.value_of("SYSTEM:chw_main_current_cooling") == pytest.approx(
            800.0, rel=1e-3
        )
        assert abs(observation.value_of("SYSTEM:chw_loop_heat_accumulation")) < 0.8
        assert observation.value_of("SYSTEM:cooling_unmet") == 0.0


def test_the_chillers_are_what_pulls_the_loop_back_after_a_shortfall(plant):
    # While one chiller carries 800 kW the loop gains heat; when the second starts, the
    # chillers remove more than the load until the loop is back. Both signs are real.
    history = drive(plant, steady(800.0, 12)).history()
    gains = [o.value_of("SYSTEM:chw_loop_heat_accumulation") for o in history[1:5]]
    assert all(gain > 0.0 for gain in gains[:3])
    assert gains[3] < 0.0
    assert history[4].value_of("SYSTEM:chw_main_current_cooling") > 800.0


@pytest.mark.parametrize("load_kw", [400.0, 800.0, 1200.0])
def test_the_balance_closes_at_every_load_the_plant_serves(plant, load_kw):
    # Within a percent rather than a tenth of one: four hours in, the pump-speed loop is
    # still creeping, the flow rises a little, and the loop gives up a few kilowatts of
    # stored heat as it cools towards its new operating point. That shows as removal
    # slightly above the load and a small negative accumulation, which is what it is.
    run = drive(plant, steady(load_kw, 24))
    last = run.history()[-1]
    removed = last.value_of("SYSTEM:chw_main_current_cooling")
    assert removed == pytest.approx(load_kw, rel=1e-2)
    assert last.value_of("SYSTEM:cooling_demand") == load_kw
    assert last.value_of("SYSTEM:cooling_unmet") == 0.0
    assert last.value_of("SYSTEM:chw_loop_heat_accumulation") == pytest.approx(
        load_kw - removed, abs=1e-6
    )


def test_what_a_chiller_reports_is_what_it_did_to_the_water(plant):
    # A chiller's cooling comes from the engine; the header's supply and flow come from
    # the mixing node and the solver. They are independent routes to the same heat, so
    # agreement here means neither was reconstructed from the other.
    history = drive(plant, steady(900.0, 10)).history()
    for before, after in zip(history[1:], history[2:]):
        removed = sum(
            after.value_of(f"{device}:plant_chw_current_cooling")
            for device in ("chiller_plant_1", "chiller_plant_2")
        )
        assert removed == pytest.approx(after.value_of("SYSTEM:chw_main_current_cooling"))
        header = water_heat_flow_kw(
            after.value_of("SYSTEM:chw_main_current_flow") / 60.0,
            before.value_of("SYSTEM:chwr_main_temp") - after.value_of("SYSTEM:chws_main_temp"),
        )
        assert removed == pytest.approx(header, rel=1e-6)


def test_a_whole_day_runs_without_the_arithmetic_failing(plant):
    inputs = a_day()
    run = drive(plant, inputs)

    assert run.status().last_error is None
    assert run.status().steps_taken == 144

    removed = absorbed = 0.0
    for observation, given in zip(run.history()[1:], inputs):
        assert observation.value_of("SYSTEM:cooling_demand") == given.cooling_load_kw
        if observation.value_of("SYSTEM:terminal_current_flow") > 0.0:
            # Whatever the chillers manage, the terminal puts the whole load into the water.
            assert observation.value_of("SYSTEM:terminal_current_cooling") == pytest.approx(
                given.cooling_load_kw, abs=1e-6
            )
        removed += observation.value_of("SYSTEM:chw_main_current_cooling")
        absorbed += observation.value_of("SYSTEM:terminal_current_cooling")
    # Over a day the loop ends near where it began, so what went in has come out.
    assert removed == pytest.approx(absorbed, rel=1e-2)


def test_a_load_below_the_shutdown_threshold_is_left_unserved(plant):
    # Not a defect in the coupling but in the staging law it faithfully reproduces:
    # `last_unit_shutdown_factor` of 0.5 against a stage-down threshold of 0.45 stops the
    # plant entirely below 22.5% of one machine, with the building still asking for
    # cooling. Pinned here as well as in the controller's own tests, because this is where
    # its consequence is visible: nine steps of a simulated day carry no cooling at all.
    run = drive(plant, steady(SHUTDOWN_BELOW_KW * 0.8, 10))
    last = run.history()[-1]
    assert chillers_on(last) == 0
    assert last.value_of("SYSTEM:chw_main_current_cooling") == 0.0
    # And it is reported as unmet, rather than simply absent.
    assert last.value_of("SYSTEM:cooling_unmet") == pytest.approx(SHUTDOWN_BELOW_KW * 0.8)
    assert any("not removed" in note for note in last.notes)


# --- more than the plant can carry --------------------------------------------------------


def test_an_overloaded_plant_reports_what_its_chillers_actually_removed(plant):
    # 1,600 kW against two chillers rated about 700 kW each. The chillers are capped at
    # their rating, and the cooling points say so: they used to report the demand,
    # because the header's cooling was reconstructed from a return temperature that is
    # itself derived from the demand.
    last = drive(plant, steady(1600.0, 6)).history()[-1]
    chillers = ("chiller_plant_1", "chiller_plant_2")
    rated = sum(engine_of(plant, device).q_ch_d for device in chillers)

    removed = last.value_of("SYSTEM:chw_main_current_cooling")
    assert removed == pytest.approx(rated, rel=1e-6)
    assert last.value_of("SYSTEM:cooling_demand") == 1600.0
    assert last.value_of("SYSTEM:cooling_unmet") == pytest.approx(1600.0 - removed)
    assert last.value_of("SYSTEM:chw_loop_heat_accumulation") > 0.0
    for device in chillers:
        assert last.value_of(f"{device}:operating_load_percentage") == pytest.approx(100.0)


def test_an_overloaded_chiller_is_reported_as_uncertain_and_says_why(plant):
    from hvac_agent.core.observation import Quality

    last = drive(plant, steady(1600.0, 6)).history()[-1]
    for device in ("chiller_plant_1", "chiller_plant_2"):
        assert last[f"{device}:plant_chw_current_cooling"].quality is Quality.UNCERTAIN
        assert last[f"{device}:total_active_power"].quality is Quality.UNCERTAIN
        assert any(note.startswith(f"{device}: overloaded") for note in last.notes)
    # Readings the engine's shortcut does not touch stay good.
    assert last["SYSTEM:outdoor_temperature"].quality is Quality.GOOD


def test_a_sustained_overload_stops_the_run_before_the_loop_leaves_the_model(plant):
    # 5,000 kW against 1,400 kW of chillers heats the loop without limit — the reported
    # reproduction reached 195 C. The run now fails at the first step that would leave
    # the operating envelope, says why, and records nothing past it.
    from hvac_agent.integrations.phyvac.plant import OperatingEnvelopeError
    from hvac_agent.simulation.run import RunState

    run = Run(
        plant,
        Scenario(name="overload", start=START, inputs=steady(5000.0, 24), step_minutes=10.0),
        config_revision="rev1-nameplate",
    )
    plant.bind_run(run.run_id)
    run.start()
    with pytest.raises(OperatingEnvelopeError):
        for _ in range(24):
            run.step()

    status = run.status()
    assert status.state is RunState.FAILED
    assert "operating_envelope" in status.last_error
    assert "5000 kW" in status.last_error
    for observation in run.history():
        assert observation.value_of("SYSTEM:chwr_main_temp") <= 40.0
        assert observation.value_of("SYSTEM:chws_main_temp") <= 40.0


# --- a plant with nothing to do ------------------------------------------------------------


def test_no_load_means_nothing_runs_and_it_stays_that_way(plant):
    run = drive(
        plant,
        tuple(
            PlantInputs(
                cooling_load_kw=0.0, dry_bulb_temp_c=24.0, relative_humidity_percent=60.0
            )
            for _ in range(30)
        ),
    )
    for observation in run.history():
        assert chillers_on(observation) == 0
        assert (
            sum(
                observation.value_of(point)
                for point in observation.points
                if point.endswith(":total_active_power")
            )
            == 0.0
        )


def test_a_plant_starts_when_the_load_arrives(plant):
    run = drive(plant, steady(0.0, 4) + steady(900.0, 10))
    assert chillers_on(run.history()[4]) == 0
    assert chillers_on(run.history()[-1]) >= 1


# --- power ---------------------------------------------------------------------------------


def test_power_is_reported_for_every_machine_that_runs(plant):
    run = drive(plant, steady(900.0, 10))
    last = run.history()[-1]
    for family in DeviceFamily:
        for device in plant.plant.device_ids[family]:
            running = last.value_of(f"{device}:running_state")
            power = last.value_of(f"{device}:total_active_power")
            if running:
                assert power > 0.0, f"{device} runs but draws nothing"
            else:
                assert power == 0.0, f"{device} is stopped but draws {power}"


def test_a_heavier_load_costs_more(plant):
    light = drive(plant, steady(400.0, 10)).history()[-1]
    plant.reset(START)
    heavy = drive(plant, steady(1100.0, 10)).history()[-1]

    def total(observation):
        return sum(
            observation.value_of(point)
            for point in observation.points
            if point.endswith(":total_active_power")
        )

    assert total(heavy) > total(light)


# --- physics and display calibration are separate -------------------------------------------


def variant(site_dir: pathlib.Path, tmp_path: pathlib.Path, file: str, change) -> PhyvacPlant:
    """A plant from a copy of the site with one configuration file edited."""
    directory = tmp_path / "variant"
    shutil.copytree(site_dir, directory)
    path = directory / file
    document = yaml.safe_load(path.read_text(encoding="utf-8"))
    change(document)
    path.write_text(yaml.safe_dump(document, sort_keys=False), encoding="utf-8")
    plant = PhyvacPlant(load_site(directory))
    plant.bind_run("run-test")
    return plant


def readings(observation) -> dict[str, float]:
    return {point: observation.value_of(point) for point in observation.points}


GAUGE_PRESSURES = {
    "SYSTEM:chws_main_pressure",
    "SYSTEM:chwr_main_pressure",
    "SYSTEM:cws_main_pressure",
    "SYSTEM:cwr_main_pressure",
}


def test_display_calibration_never_changes_what_the_plant_does(plant, site_dir, tmp_path):
    # display.yaml promises that changing it changes a reading, never a flow, a
    # temperature or a power. Initial water temperatures were once read from it, so a
    # display-only edit moved the first step's chiller power. The edit below includes
    # that one — an offline chilled-water return of 25 C instead of 12 — alongside a
    # change to the gauge mapping, which is the only thing display is allowed to move.
    def change(document):
        defaults = document["defaults"]
        defaults["offline_readings"] = {"chw_return_temp_c": 25.0}
        defaults["pressure_mapping"]["chw_return_base_kpa"] += 40.0

    edited = variant(site_dir, tmp_path, "calibration/display.yaml", change)
    inputs = steady(900.0, 6)
    original = drive(plant, inputs).history()
    changed = drive(edited, inputs).history()

    for before, after in zip(original, changed, strict=True):
        a, b = readings(before), readings(after)
        assert {p: v for p, v in a.items() if p not in GAUGE_PRESSURES} == {
            p: v for p, v in b.items() if p not in GAUGE_PRESSURES
        }
    assert readings(changed[-1])["SYSTEM:chwr_main_pressure"] == pytest.approx(
        readings(original[-1])["SYSTEM:chwr_main_pressure"] + 40.0
    )


def test_initial_conditions_are_physics_and_reach_the_first_step(plant, site_dir, tmp_path):
    def change(document):
        document["defaults"]["initial_conditions"]["chw_return_temp_c"] = 25.0

    edited = variant(site_dir, tmp_path, "calibration/physics.yaml", change)
    inputs = steady(900.0, 1)
    original = drive(plant, inputs).history()
    changed = drive(edited, inputs).history()

    assert changed[0].value_of("SYSTEM:chwr_main_temp") == 25.0
    assert original[0].value_of("SYSTEM:chwr_main_temp") == 12.0

    def chiller_power(observation):
        return sum(
            observation.value_of(f"{device}:total_active_power")
            for device in ("chiller_plant_1", "chiller_plant_2")
        )

    assert chiller_power(original[1]) > 0.0
    assert chiller_power(changed[1]) != pytest.approx(chiller_power(original[1]))


# --- the topology drives the plant ----------------------------------------------------------


def test_a_topology_with_its_links_removed_does_not_load(site_dir, tmp_path):
    # Once, deleting every link from topology.yaml produced a plant that read the same as
    # the complete one at every step of a 1,000 kW run.
    from hvac_agent.core.site import SiteConfigError

    def strip(document):
        document["links"] = []

    with pytest.raises(SiteConfigError):
        variant(site_dir, tmp_path, "topology.yaml", strip)


def test_the_pump_that_runs_is_the_one_wired_to_the_running_chiller(plant, site_dir, tmp_path):
    # At 400 kW one chiller runs. Pair chiller 1 with pump 2 on both sides and pump 2 is
    # the one that starts; before, "the first n pumps" ran whatever the links said.
    swap = {"chiller_plant_1": "chiller_plant_2", "chiller_plant_2": "chiller_plant_1"}

    def swap_pairing(document):
        for link in document["links"]:
            ends = (link["from"], link["to"])
            if any(end[0].startswith(("chilled_water_pump", "cooling_water_pump")) for end in ends):
                for end in ends:
                    end[0] = swap.get(end[0], end[0])

    rewired = variant(site_dir, tmp_path, "topology.yaml", swap_pairing)
    original = drive(plant, steady(400.0, 6)).history()[-1]
    changed = drive(rewired, steady(400.0, 6)).history()[-1]

    assert original.value_of("chiller_plant_1:running_state") == 1.0
    assert changed.value_of("chiller_plant_1:running_state") == 1.0
    for side in ("chilled_water_pump_pri", "cooling_water_pump"):
        assert original.value_of(f"{side}_1:running_state") == 1.0
        assert original.value_of(f"{side}_2:running_state") == 0.0
        assert changed.value_of(f"{side}_1:running_state") == 0.0
        assert changed.value_of(f"{side}_2:running_state") == 1.0


def test_a_chiller_carries_the_flow_of_its_own_pump(plant):
    # In series, a chiller carries what its pump delivers. With pump 1 corrected faster,
    # chiller 1 carries more than chiller 2 rather than both taking an equal share.
    run = started(plant)
    correct(run, plant, {"chilled_water_pump_pri_1:frequency_setpoint": 45.0})
    after = run.observe()
    assert after.value_of("chiller_plant_1:plant_chw_current_flow") > after.value_of(
        "chiller_plant_2:plant_chw_current_flow"
    )


def test_two_chillers_on_one_header_pump_share_its_water_and_both_cool(site_dir, tmp_path):
    # The reviewer's configuration: neither chiller has a pump of its own, and one header
    # pump a side feeds both. At 1,000 kW the baseline asked for two chillers, but only
    # one ran and reported cooling stopped at its rating, 697.67 kW.
    alone = {
        "chilled_water_pump_pri_1", "chilled_water_pump_pri_2",
        "cooling_water_pump_1", "cooling_water_pump_2",
    }

    def onto_the_header(document):
        document["devices"] = [d for d in document["devices"] if d["id"] not in alone]
        for device in document["devices"]:
            device.pop("role", None)
        document["links"] = [
            link for link in document["links"]
            if link["from"][0] not in alone and link["to"][0] not in alone
        ]
        for chiller in CHILLERS:
            document["links"] += [
                {"from": [chiller, "evap_out"], "to": ["bus", "chw_supply"],
                 "medium": "chw", "evidence": "confirmed"},
                {"from": ["bus", "cw_supply"], "to": [chiller, "cond_in"],
                 "medium": "cw", "evidence": "confirmed"},
            ]

    headered = variant(site_dir, tmp_path, "topology.yaml", onto_the_header)
    after = drive(headered, steady(1000.0, 8)).observe()

    assert chillers_running(after) == list(CHILLERS)
    assert after.value_of("chilled_water_pump_pri_3:running_state") == 1.0
    flows = [after.value_of(f"{device}:plant_chw_current_flow") for device in CHILLERS]
    assert flows[0] == pytest.approx(flows[1])
    assert sum(flows) == pytest.approx(after.value_of("SYSTEM:chw_main_current_flow"))
    assert after.value_of("SYSTEM:chw_main_current_cooling") > RATED_KW
    assert after.value_of("SYSTEM:cooling_unmet") == 0.0


# --- a correction reaches the machines -------------------------------------------------------


def test_a_correction_accepted_by_the_gate_changes_what_the_plant_does(plant):
    # End to end: the gate judges it, the run queues it, the plant applies it, and the
    # observation shows it. Nothing before this exercises all four.
    inputs = steady(900.0, 10)
    run = Run(
        plant,
        Scenario(name="corrected", start=START, inputs=inputs, step_minutes=10.0),
        config_revision="rev1-nameplate",
    )
    plant.bind_run(run.run_id)
    run.start()
    for _ in range(4):
        run.step()

    gate = CorrectionGate(
        run, plant.metrics, EquipmentLimits.from_control(plant.site.control)
    )
    before = run.observe().value_of("chiller_plant_1:chilled_water_temp_set")

    record = gate.submit(
        Action(
            mode=ControlMode.MANUAL,
            setpoints={"chiller_plant_1:chilled_water_temp_set": 9.5},
            run_id=run.run_id,
            issued_at=START,
        ),
        rationale="warmer supply while the load is light",
        based_on=run.status().simulated_time,
    )
    assert record.accepted

    run.step()
    gate.collect_outcomes()

    assert run.observe().value_of("chiller_plant_1:chilled_water_temp_set") == pytest.approx(9.5)
    assert before != pytest.approx(9.5)
    assert record.outcome is not None


def test_a_setpoint_changed_after_the_gate_accepted_it_never_reaches_the_plant(plant):
    # The reviewer's reproduction: 9.5 C accepted, then the caller's dictionary changed
    # to 20 C, outside the 7-12 C limit, before the step. The plant ran at 20 C and the
    # recorded proposal said 20 C.
    run = started(plant, load_kw=1000.0)
    point = "chiller_plant_1:chilled_water_temp_set"
    setpoints = {point: 9.5}
    gate = CorrectionGate(run, plant.metrics, EquipmentLimits.from_control(plant.site.control))
    record = gate.submit(
        Action(mode=ControlMode.MANUAL, setpoints=setpoints, run_id=run.run_id, issued_at=START),
        rationale="warmer supply while the load is light",
        based_on=run.status().simulated_time,
    )
    assert record.accepted

    setpoints[point] = 20.0
    run.step()
    gate.collect_outcomes()

    assert run.observe().value_of(point) == 9.5
    assert engine_of(plant, "chiller_plant_1").tout_ch_sp == 9.5
    assert record.proposal.action.setpoints[point] == 9.5


def started(plant: PhyvacPlant, *, load_kw: float = 1200.0, steps: int = 4) -> Run:
    """A run with both chillers up and settled, ready for a correction."""
    run = Run(
        plant,
        Scenario(name="corrected", start=START, inputs=steady(load_kw, 10), step_minutes=10.0),
        config_revision="rev1-nameplate",
    )
    plant.bind_run(run.run_id)
    run.start()
    for _ in range(steps):
        run.step()
    return run


def correct(run: Run, plant: PhyvacPlant, setpoints: dict[str, float]):
    """Put a correction through the gate, take one step, and collect its outcome."""
    gate = CorrectionGate(run, plant.metrics, EquipmentLimits.from_control(plant.site.control))
    record = gate.submit(
        Action(mode=ControlMode.MANUAL, setpoints=setpoints, run_id=run.run_id, issued_at=START),
        rationale="test",
        based_on=run.status().simulated_time,
    )
    assert record.accepted, record.reason
    run.step()
    gate.collect_outcomes()
    return record


def engine_of(plant: PhyvacPlant, device: str):
    """The engine object for a device, found through the builder's own device order."""
    machines = {
        DeviceFamily.CHILLER: plant.plant.chillers,
        DeviceFamily.CHILLED_WATER_PUMP: plant.plant.chilled_water_pumps,
        DeviceFamily.COOLING_WATER_PUMP: plant.plant.cooling_water_pumps,
        DeviceFamily.COOLING_TOWER: plant.plant.cooling_towers,
    }
    for family, ids in plant.plant.device_ids.items():
        if device in ids:
            return machines[family][ids.index(device)]
    raise KeyError(device)


def test_pumps_at_different_speeds_each_stay_on_their_own_curve(plant, monkeypatch):
    # The reviewer's reproduction: eight steps at 1,000 kW, then pump 1 to 45 Hz. The
    # header closed at 123.531 kPa with pump 2 given 0.122943 m3/min, a flow at which its
    # own curve makes only 116.168 kPa. Every balance the plant solves must now put each
    # conducting branch on its curve, and that slower pump is held shut by its valve.
    from hvac_agent.integrations.phyvac import plant as plant_module

    from .test_hydraulics import assert_every_branch_is_on_its_curve

    solved = []
    original = plant_module.solve_header

    def checked(sources, sinks, **kwargs):
        # Checked as it is solved: the branches are the engine's own, and the next step
        # changes their speeds.
        balance = original(sources, sinks, **kwargs)
        assert_every_branch_is_on_its_curve(balance, sources, sinks)
        solved.append(balance)
        return balance

    monkeypatch.setattr(plant_module, "solve_header", checked)
    run = started(plant, load_kw=1000.0, steps=8)
    correct(run, plant, {"chilled_water_pump_pri_1:frequency_setpoint": 45.0})
    after = run.observe()

    chilled, _ = solved[-2:]
    assert chilled.source_flows[0] > 0.0
    assert chilled.source_flows[1] == 0.0
    assert after.value_of("chilled_water_pump_pri_2:running_state") == 1.0
    assert after.value_of("chilled_water_pump_pri_2:total_active_power") == 0.0
    assert any(note.startswith("chilled_water_pump_pri_2: running but delivering nothing")
               for note in after.notes)
    # Its chiller gets no water, and the plant says so rather than cooling with it.
    assert after.value_of("chiller_plant_2:plant_chw_current_cooling") == 0.0
    assert after.value_of("chiller_plant_2:plant_chw_current_flow") == 0.0


@pytest.mark.parametrize(
    "target, sibling",
    [
        ("chilled_water_pump_pri_1", "chilled_water_pump_pri_2"),
        ("cooling_water_pump_1", "cooling_water_pump_2"),
        ("cooling_towers_1", "cooling_towers_2"),
    ],
)
def test_a_frequency_correction_moves_only_the_machine_it_names(plant, target, sibling):
    # The baseline commands one speed per family. Stored per family, a correction to one
    # pump moved every running pump of that family; and because the observation was built
    # from the baseline command, it went on reporting the old speed for both.
    run = started(plant)
    assert run.observe().value_of(f"{sibling}:running_state") == 1.0

    record = correct(run, plant, {f"{target}:frequency_setpoint": 45.0})
    after = run.observe()

    assert after.value_of(f"{target}:frequency_setpoint") == 45.0
    assert after.value_of(f"{target}:frequency_feedback") == pytest.approx(45.0)
    assert engine_of(plant, target).inv * 50.0 == pytest.approx(45.0)

    assert after.value_of(f"{sibling}:frequency_feedback") != pytest.approx(45.0)
    assert engine_of(plant, sibling).inv * 50.0 == pytest.approx(
        after.value_of(f"{sibling}:frequency_feedback")
    )

    assert record.outcome.achieved == {f"{target}:frequency_setpoint": pytest.approx(45.0)}
    assert record.outcome.fully_achieved


def test_a_slower_pump_beside_a_corrected_one_keeps_running_and_the_run_goes_on(plant):
    # Correcting one chilled-water pump to 45 Hz while its partner stays near 30 Hz puts
    # the header at the slower pump's highest head. The run must carry on, and the slower
    # pump must show as what it is: still running at its own speed, while the faster one
    # carries the flow. (The engine's pump power is hydraulic, so the slower pump's power
    # falls with its flow; a real pump's shutoff power is not modelled.)
    run = started(plant)
    correct(run, plant, {"chilled_water_pump_pri_1:frequency_setpoint": 45.0})

    assert run.status().last_error is None
    after = run.observe()
    assert after.value_of("chilled_water_pump_pri_2:running_state") == 1.0
    assert after.value_of("chilled_water_pump_pri_2:frequency_feedback") < 45.0
    assert after.value_of("chilled_water_pump_pri_1:total_active_power") > after.value_of(
        "chilled_water_pump_pri_2:total_active_power"
    )

    run.step()
    assert run.status().last_error is None


def test_feedback_is_read_from_the_machine_not_from_the_command(plant):
    run = started(plant)
    for family in (
        DeviceFamily.CHILLED_WATER_PUMP,
        DeviceFamily.COOLING_WATER_PUMP,
        DeviceFamily.COOLING_TOWER,
    ):
        for device in plant.plant.device_ids[family]:
            assert run.observe().value_of(f"{device}:frequency_feedback") == pytest.approx(
                engine_of(plant, device).inv * 50.0
            )


def test_a_plant_at_rest_reports_no_inverter_running(plant):
    observation = plant.reset(START)
    for point in observation.points:
        if point.endswith(":frequency_feedback"):
            assert observation.value_of(point) == 0.0, point


def test_reordering_the_topology_does_not_move_a_correction(site_dir, tmp_path):
    # The chiller setpoint was once placed by the number at the end of the device ID,
    # used as a list index. With the first two chillers listed the other way round, a
    # correction addressed to chiller_plant_1 changed chiller_plant_2.
    def swap(document):
        devices = document["devices"]
        devices[0], devices[1] = devices[1], devices[0]

    plant = variant(site_dir, tmp_path, "topology.yaml", swap)
    assert plant.plant.device_ids[DeviceFamily.CHILLER] == ("chiller_plant_2", "chiller_plant_1")

    run = started(plant)
    correct(run, plant, {"chiller_plant_1:chilled_water_temp_set": 9.5})
    after = run.observe()

    assert after.value_of("chiller_plant_1:chilled_water_temp_set") == 9.5
    assert after.value_of("chiller_plant_2:chilled_water_temp_set") != pytest.approx(9.5)
    assert engine_of(plant, "chiller_plant_1").tout_ch_sp == 9.5
    assert engine_of(plant, "chiller_plant_2").tout_ch_sp != pytest.approx(9.5)


def test_a_correction_the_gate_refuses_never_reaches_the_plant(plant):
    inputs = steady(900.0, 10)
    run = Run(
        plant,
        Scenario(name="refused", start=START, inputs=inputs, step_minutes=10.0),
        config_revision="rev1-nameplate",
    )
    plant.bind_run(run.run_id)
    run.start()
    run.step()

    gate = CorrectionGate(
        run, plant.metrics, EquipmentLimits.from_control(plant.site.control)
    )
    record = gate.submit(
        Action(
            mode=ControlMode.MANUAL,
            setpoints={"chiller_plant_1:chilled_water_temp_set": 2.0},
            run_id=run.run_id,
            issued_at=START,
        ),
        rationale="colder than the equipment allows",
        based_on=run.status().simulated_time,
    )
    assert not record.accepted

    run.step()
    assert run.observe().value_of("chiller_plant_1:chilled_water_temp_set") >= 7.0


# --- started and stopped by hand ------------------------------------------------------------


def power(observation, device: str) -> float:
    return observation.value_of(f"{device}:total_active_power")


def test_a_chiller_stopped_by_hand_stops_and_stays_stopped(plant):
    # The reported reproduction: running_state 0 passed the gate and the chiller went on
    # drawing about 77 kW. Now it stops at once, and a later step does not restart it.
    run = started(plant, load_kw=1200.0)
    record = correct(run, plant, {"chiller_plant_1:running_state": 0.0})
    run.step()

    for observation in run.history()[-2:]:
        assert observation.value_of("chiller_plant_1:running_state") == 0.0
        assert power(observation, "chiller_plant_1") == 0.0
        assert observation.value_of("chiller_plant_1:plant_chw_current_cooling") == 0.0
    assert record.outcome.fully_achieved
    # One chiller cannot carry 1,200 kW, and the observation says so.
    assert run.observe().value_of("SYSTEM:cooling_unmet") > 0.0


def test_the_baseline_works_around_a_chiller_stopped_by_hand(plant):
    # At 500 kW one chiller runs, and it is chiller 1. Stopped by hand, chiller 2 takes the
    # load; released, the baseline has both to choose from again.
    run = started(plant, load_kw=500.0)
    assert chillers_running(run.observe()) == ["chiller_plant_1"]

    correct(run, plant, {"chiller_plant_1:running_state": 0.0})
    run.step()
    assert chillers_running(run.observe()) == ["chiller_plant_2"]
    assert run.observe().value_of("SYSTEM:cooling_unmet") == 0.0

    release(run, plant, "chiller_plant_1:running_state")
    assert run.overrides() == {}
    assert chillers_running(run.observe()) == ["chiller_plant_1"]


def test_a_chiller_started_by_hand_becomes_the_one_that_runs(plant):
    run = started(plant, load_kw=500.0)
    correct(run, plant, {"chiller_plant_2:running_state": 1.0})
    run.step()
    assert chillers_running(run.observe()) == ["chiller_plant_2"]
    assert run.observe().value_of("chilled_water_pump_pri_2:running_state") == 1.0


def test_stopping_a_chillers_own_pump_takes_the_chiller_out_of_service(plant):
    run = started(plant, load_kw=500.0)
    correct(run, plant, {"chilled_water_pump_pri_1:running_state": 0.0})
    observation = run.observe()
    assert chillers_running(observation) == ["chiller_plant_2"]
    assert observation.value_of("chilled_water_pump_pri_1:running_state") == 0.0
    assert observation.value_of("chilled_water_pump_pri_1:frequency_feedback") == 0.0


def test_a_pump_started_by_hand_moves_water_through_its_stopped_chiller(plant):
    # Pump 2 runs, chiller 2 does not: water goes through chiller 2 uncooled and joins the
    # header at the temperature it arrived with. The chillers' reported removal still
    # equals what the header's flow and temperatures say.
    run = started(plant, load_kw=500.0)
    before = run.observe()
    correct(run, plant, {"chilled_water_pump_pri_2:running_state": 1.0})
    after = run.observe()

    assert after.value_of("chilled_water_pump_pri_2:running_state") == 1.0
    assert after.value_of("chiller_plant_2:running_state") == 0.0
    assert after.value_of("chiller_plant_2:plant_chw_current_flow") > 0.0
    assert after.value_of("chiller_plant_2:plant_chw_current_cooling") == 0.0
    header = water_heat_flow_kw(
        after.value_of("SYSTEM:chw_main_current_flow") / 60.0,
        before.value_of("SYSTEM:chwr_main_temp") - after.value_of("SYSTEM:chws_main_temp"),
    )
    assert after.value_of("SYSTEM:chw_main_current_cooling") == pytest.approx(header, rel=1e-6)


def test_a_chiller_started_by_hand_with_no_pump_free_says_so(plant):
    run = started(plant, load_kw=500.0)
    correct(
        run,
        plant,
        {"chiller_plant_2:running_state": 1.0, "chilled_water_pump_pri_2:running_state": 0.0},
    )
    observation = run.observe()
    assert observation.value_of("chiller_plant_2:running_state") == 0.0
    assert any(note.startswith("chiller_plant_2: started by hand but cannot run")
               for note in observation.notes)


def chillers_running(observation) -> list[str]:
    return [
        device
        for device in ("chiller_plant_1", "chiller_plant_2")
        if observation.value_of(f"{device}:running_state") == 1.0
    ]


def release(run: Run, plant: PhyvacPlant, *points: str) -> None:
    gate = CorrectionGate(run, plant.metrics, EquipmentLimits.from_control(plant.site.control))
    record = gate.submit(
        Action(mode=ControlMode.MANUAL, release=set(points), run_id=run.run_id, issued_at=START),
        rationale="back to the baseline",
        based_on=run.status().simulated_time,
    )
    assert record.accepted, record.reason
    run.step()


# --- each machine reports its own water ----------------------------------------------------

CHILLERS = ("chiller_plant_1", "chiller_plant_2")
TOWERS = ("cooling_towers_1", "cooling_towers_2")


def test_each_chiller_reports_its_own_temperatures_under_unequal_setpoints(plant):
    # The reviewer's reproduction: 1,000 kW, chiller 1 corrected to 9.5 C. The engines'
    # outlets were 9.5 and 8.415 C, but both chillers reported the mixed 8.958 C, and
    # both reported the next step's return of 15.141 C instead of the 14.765 C they took in.
    run = started(plant, load_kw=1000.0, steps=8)
    correct(run, plant, {"chiller_plant_1:chilled_water_temp_set": 9.5})
    before, after = run.history()[-2:]

    assert after.value_of("chiller_plant_1:evaporator_outlet_temp") == 9.5
    other = after.value_of("chiller_plant_2:evaporator_outlet_temp")
    assert other == pytest.approx(after.value_of("chiller_plant_2:chilled_water_temp_set"))
    assert other != pytest.approx(9.5)

    took_in = before.value_of("SYSTEM:chwr_main_temp")
    for device in CHILLERS:
        assert after.value_of(f"{device}:evaporator_inlet_temp") == took_in
        outlet = after.value_of(f"{device}:evaporator_outlet_temp")
        assert outlet == engine_of(plant, device).tout_ch
    assert after.value_of("SYSTEM:chwr_main_temp") != pytest.approx(took_in)

    # The mixed supply is what the header reports, and it is the two outlets joined.
    flows = [after.value_of(f"{device}:plant_chw_current_flow") for device in CHILLERS]
    outlets = [after.value_of(f"{device}:evaporator_outlet_temp") for device in CHILLERS]
    assert after.value_of("SYSTEM:chws_main_temp") == pytest.approx(
        sum(f * t for f, t in zip(flows, outlets)) / sum(flows)
    )


def test_each_chillers_temperatures_account_for_its_own_cooling(plant):
    # Cooling and power come from the engine; the temperatures must describe the same
    # calculation, on both sides of the machine.
    run = started(plant, load_kw=1000.0, steps=8)
    correct(run, plant, {"chiller_plant_1:chilled_water_temp_set": 9.5})
    after = run.observe()

    for device in CHILLERS:
        cooling = after.value_of(f"{device}:plant_chw_current_cooling")
        assert cooling > 0.0
        evaporator = water_heat_flow_kw(
            after.value_of(f"{device}:plant_chw_current_flow") / 60.0,
            after.value_of(f"{device}:evaporator_inlet_temp")
            - after.value_of(f"{device}:evaporator_outlet_temp"),
        )
        assert evaporator == pytest.approx(cooling, rel=1e-6)

        condenser = water_heat_flow_kw(
            engine_of(plant, device).g_cd,
            after.value_of(f"{device}:condenser_outlet_temp")
            - after.value_of(f"{device}:condenser_inlet_temp"),
        )
        rejected = cooling + after.value_of(f"{device}:total_active_power")
        assert condenser == pytest.approx(rejected, rel=1e-6)


def test_a_stopped_chiller_reports_the_header_water_and_says_so(plant):
    from hvac_agent.core.observation import Quality

    history = drive(plant, steady(400.0, 6)).history()
    before, after = history[-2:]
    assert chillers_running(after) == ["chiller_plant_1"]

    assert after.value_of("chiller_plant_2:evaporator_inlet_temp") == before.value_of(
        "SYSTEM:chwr_main_temp"
    )
    assert after.value_of("chiller_plant_2:evaporator_outlet_temp") == before.value_of(
        "SYSTEM:chwr_main_temp"
    )
    assert after.value_of("chiller_plant_2:condenser_inlet_temp") == before.value_of(
        "SYSTEM:cws_main_temp"
    )
    assert after.value_of("chiller_plant_2:condenser_outlet_temp") == before.value_of(
        "SYSTEM:cws_main_temp"
    )
    for metric in (
        "evaporator_inlet_temp",
        "evaporator_outlet_temp",
        "condenser_inlet_temp",
        "condenser_outlet_temp",
    ):
        assert after[f"chiller_plant_2:{metric}"].quality is Quality.UNCERTAIN
        assert after[f"chiller_plant_1:{metric}"].quality is Quality.GOOD
    assert any(note.startswith("chiller_plant_2: no water is moving through its evaporator")
               for note in after.notes)
    assert not any(note.startswith("chiller_plant_1: no water") for note in after.notes)


def test_a_chiller_that_removes_nothing_leaves_the_water_as_it_found_it(
    plant, site_dir, tmp_path
):
    # A chiller asked for a supply warmer than its return removes nothing (engine flag 5),
    # but the engine still sets its outlet to the setpoint and leaves its condenser outlet
    # at the last value it computed. Mixed in, those raised the supply from 10 C to 12 C
    # with no power drawn, and put 37 C water into the condenser return.
    def cool_start(document):
        document["defaults"]["initial_conditions"]["chw_return_temp_c"] = 10.0

    edited = variant(site_dir, tmp_path, "calibration/physics.yaml", cool_start)
    run = Run(
        edited,
        Scenario(name="warm setpoint", start=START, inputs=steady(900.0, 3), step_minutes=10.0),
        config_revision="rev1-nameplate",
    )
    edited.bind_run(run.run_id)
    run.start()
    correct(run, edited, {"chiller_plant_1:chilled_water_temp_set": 12.0})
    after = run.observe()

    assert after.value_of("chiller_plant_1:running_state") == 1.0
    assert after.value_of("chiller_plant_1:plant_chw_current_cooling") == 0.0
    assert after.value_of("chiller_plant_1:total_active_power") == 0.0
    assert after.value_of("chiller_plant_1:evaporator_outlet_temp") == 10.0
    assert after.value_of("chiller_plant_1:condenser_outlet_temp") == after.value_of(
        "chiller_plant_1:condenser_inlet_temp"
    )
    assert after.value_of("SYSTEM:chws_main_temp") == pytest.approx(10.0)
    assert any(note.startswith("chiller_plant_1: asked for a supply warmer")
               for note in after.notes)


def test_each_tower_reports_its_own_outlet(plant):
    # Towers at different speeds give back water at different temperatures; each
    # reports its own, not the mixed supply.
    run = started(plant, load_kw=1000.0, steps=8)
    correct(run, plant, {"cooling_towers_1:frequency_setpoint": 45.0})
    after = run.observe()

    outlets = [after.value_of(f"{device}:ctws_temp") for device in TOWERS]
    assert outlets[0] != pytest.approx(outlets[1])
    for device, outlet in zip(TOWERS, outlets):
        tower = engine_of(plant, device)
        assert outlet == tower.tout_w
        assert after.value_of(f"{device}:ctwr_temp") == tower.tin_w


def test_a_stopped_tower_reports_the_header_water_and_says_so(plant):
    from hvac_agent.core.observation import Quality

    run = started(plant, load_kw=1000.0)
    correct(run, plant, {"cooling_towers_2:running_state": 0.0})
    after = run.observe()

    assert after.value_of("cooling_towers_2:running_state") == 0.0
    assert after.value_of("cooling_towers_2:ctws_temp") == after.value_of(
        "cooling_towers_2:ctwr_temp"
    )
    assert after.value_of("cooling_towers_2:ctwr_temp") == after.value_of(
        "cooling_towers_1:ctwr_temp"
    )
    assert after["cooling_towers_2:ctws_temp"].quality is Quality.UNCERTAIN
    assert after["cooling_towers_1:ctws_temp"].quality is Quality.GOOD
    assert any(note.startswith("cooling_towers_2: no water is moving through it;")
               for note in after.notes)


# --- a chiller needs water on both sides -----------------------------------------------------


def condenser_pumps_at(run: Run, plant: PhyvacPlant, pump_2_hz: float):
    """The reviewer's set-up: pump 1 at 50 Hz, pump 2 slower, through the gate."""
    return correct(
        run,
        plant,
        {
            "cooling_water_pump_1:frequency_setpoint": 50.0,
            "cooling_water_pump_2:frequency_setpoint": pump_2_hz,
        },
    )


def test_a_chiller_with_no_condenser_water_cools_nothing_and_says_so(plant):
    # The reviewer's reproduction: eight steps at 1,000 kW, condenser pumps to 50 and
    # 30 Hz. Pump 2 is held shut by pump 1, so chiller 2 has no condenser water. It was
    # given 1e-6 m3/min anyway, went on removing 513 kW, and reported a condenser outlet
    # of 8.5 million C as good.
    from hvac_agent.core.observation import Quality

    run = started(plant, load_kw=1000.0, steps=8)
    condenser_pumps_at(run, plant, 30.0)
    before, after = run.history()[-2:]

    assert after.value_of("cooling_water_pump_2:running_state") == 1.0
    assert after.value_of("chiller_plant_2:running_state") == 1.0
    assert after.value_of("chiller_plant_2:plant_chw_current_cooling") == 0.0
    assert after.value_of("chiller_plant_2:total_active_power") == 0.0
    assert after["chiller_plant_2:plant_chw_current_cooling"].quality is Quality.UNCERTAIN

    # Chilled water still flows through it, unchanged and reported as it is; the
    # condenser side has no water, so it reads the header it stands in, flagged.
    took_in = before.value_of("SYSTEM:chwr_main_temp")
    assert after.value_of("chiller_plant_2:evaporator_inlet_temp") == took_in
    assert after.value_of("chiller_plant_2:evaporator_outlet_temp") == took_in
    assert after["chiller_plant_2:evaporator_outlet_temp"].quality is Quality.GOOD
    header = before.value_of("SYSTEM:cws_main_temp")
    for metric in ("condenser_inlet_temp", "condenser_outlet_temp"):
        assert after.value_of(f"chiller_plant_2:{metric}") == header
        assert after[f"chiller_plant_2:{metric}"].quality is Quality.UNCERTAIN
    assert any(
        note.startswith("chiller_plant_2: told to run with no water through its condenser")
        for note in after.notes
    )

    # What it did not remove is unmet, and the header reports only what chiller 1 did.
    removed = after.value_of("chiller_plant_1:plant_chw_current_cooling")
    assert after.value_of("SYSTEM:chw_main_current_cooling") == pytest.approx(removed)
    assert after.value_of("SYSTEM:cooling_unmet") == pytest.approx(1000.0 - removed)
    for point, measurement in after.points.items():
        if point.endswith("_temp"):
            assert measurement.value < 50.0, point


def test_a_chiller_on_a_trickle_of_condenser_water_stops_the_run(plant):
    # At 32 Hz pump 2 is not held shut but runs on a trickle, and chiller 2 rejects its
    # heat into it: its own condenser outlet would reach about 67 C while the mixed
    # return stays inside the envelope. Each chiller's outlets are checked as well.
    from hvac_agent.integrations.phyvac.plant import OperatingEnvelopeError
    from hvac_agent.simulation.run import RunState

    run = started(plant, load_kw=1000.0, steps=8)
    with pytest.raises(OperatingEnvelopeError):
        condenser_pumps_at(run, plant, 32.0)

    status = run.status()
    assert status.state is RunState.FAILED
    assert "chiller_plant_2 condenser outlet" in status.last_error
    assert "50 C" in status.last_error
