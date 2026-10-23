"""Synthetic equipment spec workbooks for the engine tests.

The engine loads chiller performance from an Excel workbook, so testing it needs one.
A customer's workbook cannot be used: real plant data does not belong in this repository.
The workbook is therefore generated here, at test time, rather than committed — which
keeps a binary out of git, makes the format visible as code, and removes any chance of a
committed fixture drifting from the generator that documents it.

Layout, which the engine reads positionally rather than by header:

    row 0   headers, ignored entirely
    row 1   rated values in columns 0-8, optional capacity string in column 9
    row 2   blank separator
    row 3   part-load axis: a discarded label in column 0, then the load fractions
    row 4+  one row per condenser inlet temperature: the temperature, then COP values

Both axes must increase strictly, because the engine builds a
``RegularGridInterpolator`` over them.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from pathlib import Path

import pytest
from openpyxl import Workbook

# A plausible mid-size water-cooled chiller. Chosen to be unremarkable rather than to
# match any real machine: 7/12 degree chilled water, 32/37 condenser water.
RATED_CHILLED_OUTLET_C = 7.0
RATED_CHILLED_INLET_C = 12.0
RATED_CHILLED_FLOW_M3_PER_MIN = 2.0
RATED_CONDENSER_INLET_C = 32.0
RATED_CONDENSER_OUTLET_C = 37.0
RATED_CONDENSER_FLOW_M3_PER_MIN = 2.5
RATED_POWER_KW = 120.0
RATED_EVAPORATOR_DP_KPA = 50.0
RATED_CONDENSER_DP_KPA = 55.0

PART_LOAD_AXIS = (0.2, 0.4, 0.6, 0.8, 1.0)
CONDENSER_TEMP_AXIS = (16.0, 20.0, 24.0, 28.0, 32.0)

# COP falls as condenser water warms and peaks around part load, which is the shape a
# real machine has. The numbers are invented, not taken from any equipment.
COP_GRID = (
    (7.80, 9.20, 9.60, 9.10, 8.40),
    (6.90, 8.10, 8.45, 8.05, 7.45),
    (6.05, 7.10, 7.40, 7.05, 6.55),
    (5.25, 6.15, 6.40, 6.10, 5.70),
    (4.50, 5.25, 5.45, 5.20, 4.90),
)


@dataclass(frozen=True)
class SpecWorkbook:
    """A generated workbook and the values that went into it."""

    path: Path
    sheet_name: str
    capacity_label: str | None = None
    part_load_axis: tuple[float, ...] = PART_LOAD_AXIS
    condenser_temp_axis: tuple[float, ...] = CONDENSER_TEMP_AXIS
    cop_grid: tuple[tuple[float, ...], ...] = COP_GRID
    rated: dict[str, float] = field(default_factory=dict)


def write_spec_workbook(
    path: Path,
    *,
    sheet_name: str = "Chiller",
    capacity_label: str | None = None,
    part_load_axis: tuple[float, ...] = PART_LOAD_AXIS,
    condenser_temp_axis: tuple[float, ...] = CONDENSER_TEMP_AXIS,
    cop_grid: tuple[tuple[float, ...], ...] = COP_GRID,
) -> SpecWorkbook:
    """Write a spec workbook the engine can load.

    Args:
        capacity_label: Contents of the optional rated-capacity cell, such as ``"200RT"``
            or ``"700kW"``. Left empty by default, which makes the engine derive rated
            capacity from the design temperature difference and flow instead.
    """
    rated = {
        "tout_ch_d": RATED_CHILLED_OUTLET_C,
        "tin_ch_d": RATED_CHILLED_INLET_C,
        "g_ch_d": RATED_CHILLED_FLOW_M3_PER_MIN,
        "tin_cd_d": RATED_CONDENSER_INLET_C,
        "tout_cd_d": RATED_CONDENSER_OUTLET_C,
        "g_cd_d": RATED_CONDENSER_FLOW_M3_PER_MIN,
        "pw_d": RATED_POWER_KW,
        "dp_ch_d": RATED_EVAPORATOR_DP_KPA,
        "dp_cd_d": RATED_CONDENSER_DP_KPA,
    }

    book = Workbook()
    sheet = book.active
    sheet.title = sheet_name

    sheet.append(
        [
            "chilled outlet [C]",
            "chilled inlet [C]",
            "chilled flow [m3/min]",
            "condenser inlet [C]",
            "condenser outlet [C]",
            "condenser flow [m3/min]",
            "rated power [kW]",
            "evaporator dp [kPa]",
            "condenser dp [kPa]",
            "rated capacity",
        ]
    )
    sheet.append([*rated.values(), capacity_label])
    sheet.append([])
    sheet.append(["condenser inlet / part load", *part_load_axis])
    for temperature, row in zip(condenser_temp_axis, cop_grid):
        sheet.append([temperature, *row])

    book.save(path)
    return SpecWorkbook(
        path=path,
        sheet_name=sheet_name,
        capacity_label=capacity_label,
        part_load_axis=part_load_axis,
        condenser_temp_axis=condenser_temp_axis,
        cop_grid=cop_grid,
        rated=rated,
    )


@pytest.fixture(scope="session")
def spec_workbook(tmp_path_factory: pytest.TempPathFactory) -> SpecWorkbook:
    """A workbook whose rated capacity is derived from temperature difference and flow."""
    path = tmp_path_factory.mktemp("spec") / "chiller_spec.xlsx"
    return write_spec_workbook(path)


@pytest.fixture(scope="session")
def spec_workbook_rated_in_tons(
    tmp_path_factory: pytest.TempPathFactory,
) -> SpecWorkbook:
    """A workbook that states rated capacity as a nameplate tonnage."""
    path = tmp_path_factory.mktemp("spec_rt") / "chiller_spec_rt.xlsx"
    return write_spec_workbook(path, capacity_label="200RT")
