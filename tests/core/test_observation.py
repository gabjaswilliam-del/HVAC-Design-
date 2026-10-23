"""Checks for the observation contract.

Most of these pin the four things that must travel with the values: origin, run identity,
configuration revision, and units. Each has a failure mode that is silent without them.
"""

from __future__ import annotations

from datetime import datetime, timedelta, timezone

import pytest

from hvac_agent.core import metrics as m
from hvac_agent.core.observation import (
    Measurement,
    Observation,
    Origin,
    Quality,
    build_observation,
)

WHEN = datetime(2026, 8, 4, 13, 30, tzinfo=timezone.utc)


@pytest.fixture
def site() -> m.SiteMetrics:
    return m.SiteMetrics.from_counts(
        {m.DeviceFamily.CHILLER: 2, m.DeviceFamily.COOLING_TOWER: 2}
    )


def real(**overrides) -> Observation:
    kwargs = {
        "timestamp": WHEN,
        "origin": Origin.REAL,
        "config_revision": "rev-1",
    }
    return Observation(**{**kwargs, **overrides})


# --- Origin and run identity -------------------------------------------------------


def test_origin_has_no_default():
    with pytest.raises(TypeError):
        Observation(timestamp=WHEN, config_revision="rev-1")  # type: ignore[call-arg]


def test_a_simulated_observation_must_name_its_run():
    with pytest.raises(ValueError, match="run_id"):
        real(origin=Origin.SIMULATED)


def test_a_real_observation_must_not_name_a_run():
    with pytest.raises(ValueError, match="must not carry a run_id"):
        real(run_id="run-1")


def test_a_simulated_observation_with_a_run_is_accepted():
    observation = real(origin=Origin.SIMULATED, run_id="run-1")
    assert observation.origin is Origin.SIMULATED
    assert observation.run_id == "run-1"


# --- Timestamp and revision --------------------------------------------------------


def test_naive_timestamp_is_rejected():
    # Real and simulated observations are compared side by side; a naive timestamp
    # makes that comparison wrong an hour at a time without failing.
    with pytest.raises(ValueError, match="timezone-aware"):
        real(timestamp=datetime(2026, 8, 4, 13, 30))


def test_non_utc_timezone_is_accepted():
    observation = real(timestamp=WHEN.astimezone(timezone(timedelta(hours=8))))
    assert observation.timestamp.tzinfo is not None


def test_empty_config_revision_is_rejected():
    with pytest.raises(ValueError, match="config_revision"):
        real(config_revision="")


# --- Building from bare values -----------------------------------------------------


def test_units_are_taken_from_the_vocabulary(site):
    observation = build_observation(
        site,
        timestamp=WHEN,
        origin=Origin.SIMULATED,
        config_revision="rev-1",
        run_id="run-1",
        values={
            "chiller_plant_1:running_state": 1.0,
            "chiller_plant_1:evaporator_outlet_temp": 7.2,
            "SYSTEM:chws_main_pressure": 441.9,
        },
    )
    assert observation["chiller_plant_1:running_state"].unit is m.Unit.BOOLEAN
    assert observation["chiller_plant_1:evaporator_outlet_temp"].unit is m.Unit.CELSIUS
    assert observation["SYSTEM:chws_main_pressure"].unit is m.Unit.KILOPASCAL


def test_a_producer_cannot_mislabel_a_unit(site):
    # Producers supply values, never units, so there is no argument to get wrong.
    observation = build_observation(
        site,
        timestamp=WHEN,
        origin=Origin.REAL,
        config_revision="rev-1",
        values={"chiller_plant_1:total_active_power": 312.0},
    )
    assert observation["chiller_plant_1:total_active_power"].unit is m.Unit.KILOWATT


def test_an_unknown_point_is_rejected_when_building(site):
    with pytest.raises(m.UnknownPointError) as excinfo:
        build_observation(
            site,
            timestamp=WHEN,
            origin=Origin.REAL,
            config_revision="rev-1",
            values={
                "chiller_plant_1:running_state": 1.0,
                "chiller_plant_1:typo_here": 0.0,
                "boiler_1:running_state": 1.0,
            },
        )
    message = str(excinfo.value)
    assert "chiller_plant_1:typo_here" in message
    assert "boiler_1:running_state" in message


def test_quality_defaults_to_good_and_can_be_overridden(site):
    observation = build_observation(
        site,
        timestamp=WHEN,
        origin=Origin.REAL,
        config_revision="rev-1",
        values={
            "chiller_plant_1:running_state": 1.0,
            "chiller_plant_2:running_state": 0.0,
        },
        quality={"chiller_plant_2:running_state": Quality.BAD},
    )
    assert observation["chiller_plant_1:running_state"].quality is Quality.GOOD
    assert observation["chiller_plant_2:running_state"].quality is Quality.BAD


# --- Access ------------------------------------------------------------------------


def test_lookup_and_membership(site):
    observation = build_observation(
        site,
        timestamp=WHEN,
        origin=Origin.REAL,
        config_revision="rev-1",
        values={"chiller_plant_1:running_state": 1.0},
    )
    assert "chiller_plant_1:running_state" in observation
    assert "chiller_plant_2:running_state" not in observation
    assert observation.value_of("chiller_plant_1:running_state") == 1.0


def test_measurements_are_immutable():
    measurement = Measurement(7.2, m.Unit.CELSIUS)
    with pytest.raises(Exception):
        measurement.value = 9.0  # type: ignore[misc]


def test_an_empty_observation_is_valid():
    # A run that has been created but not yet stepped has nothing to report.
    assert real().points == {}


# --- A snapshot, not a view --------------------------------------------------------


def test_an_observation_does_not_follow_the_mapping_it_was_built_from(site):
    unit = site.unit_of("chiller_plant_1:evaporator_outlet_temp")
    points = {"chiller_plant_1:evaporator_outlet_temp": Measurement(7.0, unit)}
    observation = real(points=points)

    points["chiller_plant_1:evaporator_outlet_temp"] = Measurement(20.0, unit)

    assert observation.value_of("chiller_plant_1:evaporator_outlet_temp") == 7.0
    with pytest.raises(TypeError):
        observation.points["chiller_plant_1:evaporator_outlet_temp"] = Measurement(  # type: ignore[index]
            20.0, unit
        )
