"""Checks for the point vocabulary.

The vocabulary's job is to make a wrong point name impossible to use silently, so most
of these check that something is rejected rather than that something works.
"""

from __future__ import annotations

import pytest

from hvac_agent.core import metrics as m

ROSTER = {
    m.DeviceFamily.CHILLER: 2,
    m.DeviceFamily.CHILLED_WATER_PUMP: 3,
    m.DeviceFamily.COOLING_WATER_PUMP: 3,
    m.DeviceFamily.COOLING_TOWER: 2,
}


@pytest.fixture
def site() -> m.SiteMetrics:
    return m.SiteMetrics.from_counts(ROSTER)


# --- Naming ------------------------------------------------------------------------


def test_point_name_round_trips():
    assert m.split_point(m.point_name("chiller_plant_1", "running_state")) == (
        "chiller_plant_1",
        "running_state",
    )


@pytest.mark.parametrize("bad", ["chiller_plant_1", ":running_state", "a:", "", "a:b:c"])
def test_malformed_point_names_are_rejected(bad):
    if bad == "a:b:c":
        # A second colon belongs to the metric; only the first separates.
        assert m.split_point(bad) == ("a", "b:c")
        return
    with pytest.raises(ValueError):
        m.split_point(bad)


@pytest.mark.parametrize(
    ("device_id", "expected"),
    [
        ("chiller_plant_1", m.DeviceFamily.CHILLER),
        ("chiller_plant_12", m.DeviceFamily.CHILLER),
        ("cooling_towers_7", m.DeviceFamily.COOLING_TOWER),
        ("chilled_water_pump_pri_3", m.DeviceFamily.CHILLED_WATER_PUMP),
        ("SYSTEM", None),
        ("chiller_plant", None),  # no index
        ("boiler_1", None),  # unknown family
    ],
)
def test_family_of(device_id, expected):
    assert m.family_of(device_id) is expected


# --- Roster construction -----------------------------------------------------------


def test_roster_numbers_devices_from_one(site):
    assert site.device_ids[:2] == ("chiller_plant_1", "chiller_plant_2")


def test_roster_covers_every_device_and_system_metric(site):
    expected = sum(len(m.metrics_of(f)) * n for f, n in ROSTER.items())
    expected += len(m.system_metrics())
    assert len(site.points) == expected


def test_zero_count_family_contributes_nothing():
    site = m.SiteMetrics.from_counts({m.DeviceFamily.CHILLER: 0})
    assert site.device_ids == ()
    assert all(p.startswith("SYSTEM:") for p in site.points)


def test_negative_count_is_rejected():
    with pytest.raises(ValueError, match="negative"):
        m.SiteMetrics.from_counts({m.DeviceFamily.CHILLER: -1})


def test_unknown_family_in_an_explicit_roster_is_rejected():
    with pytest.raises(ValueError, match="known family"):
        m.SiteMetrics.from_device_ids(["boiler_1"])


def test_duplicate_device_is_rejected():
    with pytest.raises(ValueError, match="duplicate"):
        m.SiteMetrics.from_device_ids(["chiller_plant_1", "chiller_plant_1"])


# --- Units -------------------------------------------------------------------------


def test_units_come_from_the_catalog(site):
    assert site.unit_of("chiller_plant_1:running_state") is m.Unit.BOOLEAN
    assert site.unit_of("chiller_plant_1:evaporator_outlet_temp") is m.Unit.CELSIUS
    assert site.unit_of("cooling_towers_2:frequency_setpoint") is m.Unit.HERTZ
    assert site.unit_of("SYSTEM:chws_main_pressure") is m.Unit.KILOPASCAL


def test_boolean_and_fraction_units_are_distinct():
    # One transposed character apart in the vocabulary; the enum keeps them separate.
    assert m.Unit.BOOLEAN.value == "0/1"
    assert m.Unit.FRACTION.value == "0-1"
    assert m.Unit.BOOLEAN is not m.Unit.FRACTION


def test_every_point_has_a_unit(site):
    for point in site.points:
        assert isinstance(site.unit_of(point), m.Unit)


# --- Rejecting the unknown ---------------------------------------------------------


def test_unknown_point_is_rejected(site):
    assert "chiller_plant_9:running_state" not in site
    with pytest.raises(m.UnknownPointError):
        site.unit_of("chiller_plant_9:running_state")


def test_misspelled_metric_is_rejected(site):
    # The failure this whole module exists to produce.
    with pytest.raises(m.UnknownPointError):
        site.unit_of("chiller_plant_1:runing_state")


def test_require_names_every_unknown_point_at_once(site):
    with pytest.raises(m.UnknownPointError) as excinfo:
        site.require(
            [
                "chiller_plant_1:running_state",  # fine
                "chiller_plant_1:nonsense",
                "cooling_towers_9:running_state",
            ]
        )
    message = str(excinfo.value)
    assert "chiller_plant_1:nonsense" in message
    assert "cooling_towers_9:running_state" in message
    assert "2 point(s)" in message


# --- Commandability ----------------------------------------------------------------


def test_commandable_points_are_the_handles(site):
    commandable = set(site.commandable_points)
    assert "chiller_plant_1:running_state" in commandable
    assert "chiller_plant_1:chilled_water_temp_set" in commandable
    assert "cooling_towers_1:frequency_setpoint" in commandable


def test_readings_are_not_commandable(site):
    assert not site.is_commandable("chiller_plant_1:total_active_power")
    assert not site.is_commandable("cooling_towers_1:frequency_feedback")
    assert not site.is_commandable("SYSTEM:outdoor_temperature")


def test_setpoint_and_feedback_are_separate_points(site):
    # An accepted command that the plant does not achieve has to stay visible.
    assert site.is_commandable("cooling_towers_1:frequency_setpoint")
    assert not site.is_commandable("cooling_towers_1:frequency_feedback")


def test_no_system_point_is_commandable(site):
    assert not any(p.startswith("SYSTEM:") for p in site.commandable_points)


def test_commandability_of_an_unknown_point_is_rejected(site):
    with pytest.raises(m.UnknownPointError):
        site.is_commandable("chiller_plant_9:running_state")
