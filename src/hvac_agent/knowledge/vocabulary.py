"""HVAC vocabulary for rule-based entity extraction.

Deterministic and schema-guided: the entity types, the terms each type recognises, and
the sentence rules that justify a relationship are all listed here. Nothing outside
these lists is extracted, and nothing is inferred by a model. To recognise a new term,
add it here and reindex.

Site equipment instances ("Chiller 2", "CW pump 4") map to the equipment IDs of the
documented `water_cooled_chiller_plant_v1` family (`chiller_plant_2`,
`cooling_water_pump_4`), the IDs the rest of the system uses.
"""

from __future__ import annotations

import re
from dataclasses import dataclass

VERSION = "hvac-vocabulary-1"

# type -> (key, display name, aliases). Aliases match case-insensitively on word
# boundaries; spaces and hyphens are interchangeable, and a plural "s"/"es" is allowed.
TERMS: dict[str, list[tuple[str, str, list[str]]]] = {
    "equipment": [
        ("chiller", "Chiller", ["chiller", "water-cooled chiller", "centrifugal chiller", "screw chiller"]),
        ("cooling_tower", "Cooling tower", ["cooling tower", "open cooling tower"]),
        ("cw_pump", "Condenser water pump", ["condenser water pump", "cooling water pump", "cw pump", "condenser pump"]),
        ("chw_pump", "Chilled water pump", ["chilled water pump", "chw pump", "primary pump"]),
        ("heat_exchanger", "Plate heat exchanger", ["plate heat exchanger", "heat exchanger"]),
        ("crah", "CRAH unit", ["crah", "crah unit", "computer room air handler"]),
        ("ahu", "Air handling unit", ["air handling unit", "ahu"]),
        ("data_hall", "Data hall", ["data hall"]),
    ],
    "component": [
        ("compressor", "Compressor", ["compressor"]),
        ("condenser", "Condenser", ["condenser", "condenser shell"]),
        ("evaporator", "Evaporator", ["evaporator"]),
        ("expansion_valve", "Expansion valve", ["expansion valve", "electronic expansion valve", "exv"]),
        ("condenser_tubes", "Condenser tubes", ["condenser tube", "condenser tubes", "tube bundle"]),
        ("evaporator_tubes", "Evaporator tubes", ["evaporator tube", "evaporator tubes"]),
        ("purge_unit", "Purge unit", ["purge unit"]),
        ("fan", "Fan", ["fan", "tower fan", "fan motor"]),
        ("fill", "Fill media", ["fill media", "tower fill", "fill pack"]),
        ("drift_eliminator", "Drift eliminator", ["drift eliminator"]),
        ("basin", "Cold-water basin", ["cold water basin", "tower basin", "basin"]),
        ("spray_nozzle", "Spray nozzle", ["spray nozzle", "distribution nozzle"]),
        ("gearbox", "Gearbox", ["gearbox", "gear reducer"]),
        ("impeller", "Impeller", ["impeller"]),
        ("mechanical_seal", "Mechanical seal", ["mechanical seal", "pump seal"]),
        ("bearing", "Bearing", ["bearing"]),
        ("motor", "Motor", ["motor"]),
        ("vfd", "Variable frequency drive", ["variable frequency drive", "variable speed drive", "vfd", "vsd"]),
        ("strainer", "Strainer", ["strainer", "y-strainer", "suction strainer"]),
        ("control_valve", "Control valve", ["control valve", "modulating valve"]),
        ("isolation_valve", "Isolation valve", ["isolation valve", "butterfly valve"]),
        ("bypass_valve", "Bypass valve", ["bypass valve"]),
        ("temperature_sensor", "Temperature sensor", ["temperature sensor", "temperature probe"]),
        ("flow_meter", "Flow meter", ["flow meter", "flowmeter"]),
        ("coupling", "Coupling", ["coupling", "shaft coupling"]),
    ],
    "fault": [
        ("condenser_fouling", "Condenser tube fouling", ["condenser fouling", "condenser tube fouling", "tube fouling", "fouled condenser", "fouled condenser tubes", "fouled tubes"]),
        ("scale_buildup", "Scale buildup", ["scale buildup", "scale build-up", "scale deposits", "scaling"]),
        ("refrigerant_leak", "Refrigerant leak", ["refrigerant leak", "refrigerant leakage", "leaking refrigerant"]),
        ("low_refrigerant_charge", "Low refrigerant charge", ["low refrigerant charge", "refrigerant undercharge", "undercharged circuit"]),
        ("non_condensables", "Non-condensable gases", ["non-condensable gases", "non-condensable gas", "non-condensables", "noncondensable gases"]),
        ("compressor_surge", "Compressor surge", ["compressor surge", "surge condition", "surging"]),
        ("bearing_wear", "Bearing wear", ["bearing wear", "worn bearing", "bearing failure"]),
        ("cavitation", "Cavitation", ["cavitation", "cavitating"]),
        ("impeller_wear", "Impeller wear", ["impeller wear", "worn impeller", "impeller erosion"]),
        ("seal_leak", "Seal leak", ["seal leak", "mechanical seal leak", "leaking seal", "seal failure"]),
        ("strainer_blockage", "Strainer blockage", ["clogged strainer", "blocked strainer", "strainer blockage", "fouled strainer"]),
        ("fan_failure", "Fan failure", ["fan failure", "fan fault", "failed fan", "fan trip"]),
        ("fill_fouling", "Fill fouling", ["fill fouling", "fouled fill", "clogged fill"]),
        ("biological_growth", "Biological growth", ["biological growth", "biofilm", "algae growth"]),
        ("stuck_valve", "Stuck valve", ["stuck valve", "sticking valve", "valve failure"]),
        ("sensor_drift", "Sensor drift", ["sensor drift", "sensor fault", "faulty sensor", "sensor offset", "drifting sensor"]),
        ("drive_fault", "Drive fault", ["vfd fault", "drive fault", "drive trip"]),
        ("motor_overload", "Motor overload", ["motor overload", "overloaded motor"]),
        ("misalignment", "Shaft misalignment", ["shaft misalignment", "misalignment"]),
    ],
    "symptom": [
        ("high_condenser_approach", "High condenser approach", ["high condenser approach", "high condenser approach temperature", "rising condenser approach", "increased condenser approach", "high approach temperature"]),
        ("high_evaporator_approach", "High evaporator approach", ["high evaporator approach", "rising evaporator approach"]),
        ("low_delta_t", "Low chilled-water delta-T", ["low delta-t", "low delta t", "low chilled water delta-t", "low chilled water delta t", "low δt", "low Δt"]),
        ("high_head_pressure", "High head pressure", ["high head pressure", "high discharge pressure", "high condensing pressure"]),
        ("low_suction_pressure", "Low suction pressure", ["low suction pressure", "low evaporator pressure"]),
        ("high_cw_temperature", "High condenser water temperature", ["high condenser water temperature", "high entering condenser water temperature", "high leaving condenser water temperature", "high cooling water temperature"]),
        ("high_chw_temperature", "High chilled water supply temperature", ["high chilled water supply temperature", "high leaving chilled water temperature", "chilled water supply above setpoint", "warm chilled water"]),
        ("short_cycling", "Short cycling", ["short cycling", "rapid cycling"]),
        ("vibration", "High vibration", ["high vibration", "excessive vibration", "vibration"]),
        ("noise", "Abnormal noise", ["abnormal noise", "unusual noise", "grinding noise", "rattling noise"]),
        ("high_current", "High motor current", ["high motor current", "high current", "high amps", "high amperage"]),
        ("low_flow", "Low flow", ["low flow", "reduced flow", "low water flow", "flow drop"]),
        ("high_pressure_drop", "High pressure drop", ["high differential pressure", "high pressure drop", "increased pressure drop", "rising pressure drop"]),
        ("low_cop", "Low COP", ["low cop", "reduced cop", "poor cop", "low chiller cop", "falling cop", "low chiller efficiency", "reduced efficiency", "high kw/ton", "high kw per ton", "rising kw/ton"]),
        ("high_power", "High power draw", ["high power draw", "high power consumption", "increased power consumption"]),
        ("compressor_trip", "Compressor trip", ["compressor trip", "chiller trip", "high-pressure trip"]),
        ("drift_loss", "Drift loss", ["drift loss", "water carryover", "carryover"]),
        ("low_basin_level", "Low basin level", ["low basin level", "low water level"]),
    ],
    "concept": [
        ("cop", "Coefficient of performance (COP)", ["coefficient of performance", "cop"]),
        ("kw_per_ton", "kW per ton", ["kw/ton", "kw per ton", "kilowatts per ton"]),
        ("approach_temperature", "Approach temperature", ["approach temperature", "condenser approach", "evaporator approach", "tower approach", "cooling tower approach"]),
        ("delta_t", "Delta-T", ["delta-t", "delta t", "δt", "Δt"]),
        ("wet_bulb", "Wet-bulb temperature", ["wet-bulb temperature", "wet bulb temperature", "wet-bulb", "wet bulb"]),
        ("cooling_range", "Cooling range", ["cooling range", "tower range"]),
        ("pue", "Power usage effectiveness (PUE)", ["power usage effectiveness", "pue"]),
        ("free_cooling", "Free cooling", ["free cooling", "economizer mode", "waterside economizer", "water-side economizer"]),
        ("part_load", "Part-load operation", ["part load", "part-load operation", "iplv", "nplv"]),
        ("lift", "Refrigerant lift", ["refrigerant lift", "compressor lift", "pressure lift"]),
        ("head_pressure", "Head pressure", ["head pressure", "condensing pressure", "discharge pressure"]),
        ("motor_current", "Motor current", ["motor current", "motor amps"]),
        ("staging", "Chiller staging", ["chiller staging", "staging", "sequencing"]),
        ("setpoint", "Setpoint", ["setpoint", "set point"]),
        ("chw_supply_temperature", "Chilled water supply temperature", ["chilled water supply temperature", "chw supply temperature", "leaving chilled water temperature"]),
        ("condenser_water", "Condenser water", ["condenser water", "condenser-water loop"]),
        ("chilled_water", "Chilled water", ["chilled water", "chilled-water loop"]),
        ("heat_rejection", "Heat rejection", ["heat rejection"]),
        ("cooling_load", "Cooling load", ["cooling load", "heat load"]),
        ("water_treatment", "Water treatment", ["water treatment", "chemical treatment", "blowdown", "cycles of concentration"]),
        ("refrigerant", "Refrigerant", ["refrigerant", "refrigerant charge"]),
        ("redundancy", "Redundancy", ["redundancy", "n+1"]),
    ],
}

# Which equipment classes a component can be part of (the PART_OF rule).
PART_OF: dict[str, set[str]] = {
    "compressor": {"chiller"}, "condenser": {"chiller"}, "evaporator": {"chiller"},
    "expansion_valve": {"chiller"}, "condenser_tubes": {"chiller"}, "evaporator_tubes": {"chiller"},
    "purge_unit": {"chiller"},
    "fan": {"cooling_tower", "crah", "ahu"}, "fill": {"cooling_tower"}, "drift_eliminator": {"cooling_tower"},
    "basin": {"cooling_tower"}, "spray_nozzle": {"cooling_tower"}, "gearbox": {"cooling_tower"},
    "impeller": {"cw_pump", "chw_pump"}, "mechanical_seal": {"cw_pump", "chw_pump"},
    "coupling": {"cw_pump", "chw_pump"},
    "bearing": {"cw_pump", "chw_pump", "cooling_tower", "chiller"},
    "motor": {"cw_pump", "chw_pump", "cooling_tower", "chiller"},
    "vfd": {"cw_pump", "chw_pump", "cooling_tower", "chiller"},
    "strainer": {"cw_pump", "chw_pump", "chiller"},
    "control_valve": {"chiller", "crah", "ahu", "heat_exchanger"},
    "isolation_valve": {"chiller", "cw_pump", "chw_pump", "cooling_tower"},
    "bypass_valve": {"chiller", "cooling_tower"},
    "temperature_sensor": {"chiller", "cooling_tower", "crah", "ahu", "heat_exchanger"},
    "flow_meter": {"chiller", "cw_pump", "chw_pump"},
}

# Site equipment instances: (pattern, instance-ID prefix, class key, display prefix).
INSTANCES = [
    (r"chillers?\s*(?:no\.?\s*)?#?(\d{1,2})", "chiller_plant_", "chiller", "Chiller"),
    (r"cooling[\s-]+towers?\s*(?:no\.?\s*)?#?(\d{1,2})", "cooling_towers_", "cooling_tower", "Cooling tower"),
    (r"(?:cw|condenser[\s-]+water|cooling[\s-]+water)\s+pumps?\s*(?:no\.?\s*)?#?(\d{1,2})", "cooling_water_pump_", "cw_pump", "CW pump"),
    (r"(?:chw|chilled[\s-]+water)\s+pumps?\s*(?:no\.?\s*)?#?(\d{1,2})", "chilled_water_pump_pri_", "chw_pump", "CHW pump"),
]

# A cited standard: an issuing body (upper case, as printed) and a designation.
STANDARD = re.compile(
    r"(?<![\w])(ASHRAE|AHRI|ISO/IEC|ISO|IEC|EN|NFPA|UL|CIBSE|BS|GB|CTI)\s+(?:Standard\s+)?(Guideline\s+)?([A-Z]{0,4}-?\d+(?:[./-]\d+)*)(?![\w])"
)

# Wording that justifies a relationship inside one sentence.
CONNECTION_CUE = re.compile(
    r"\b(connected to|connects to|feeds?|supplies|serves?|discharges? (?:in)?to|returns? to|piped to|flows? to|draws? from)\b", re.I
)
CAUSE_CUE = re.compile(
    r"\b(caus(?:e|es|ed|ing)|leads? to|leading to|results? in|resulting in|rais(?:e|es|ed|ing)|increas(?:e|es|ed|ing)"
    r"|reduc(?:e|es|ed|ing)|lower(?:s|ed|ing)?|indicat(?:e|es|ed|ing)|signs? of|symptoms? of|due to|because of"
    r"|associated with|points? to|suggests?|shows? (?:up )?as|appears? as|(?:is )?(?:heard|felt|seen) as)\b",
    re.I,
)
# A section whose heading names a procedure becomes a Procedure node; a heading that
# names a whole guide or manual ("Chiller maintenance guide") does not.
PROCEDURE_HEADING = re.compile(
    r"\b(procedures?|inspections?|maintenance|cleaning|start-?up|shut-?down|commissioning|checklists?"
    r"|troubleshooting|replacement|calibration|tests?|testing|steps)\b",
    re.I,
)
NOT_PROCEDURE_HEADING = re.compile(r"\b(guides?|manuals?|handbooks?|overview|introduction|contents|references?)\b", re.I)


def is_procedure_heading(heading: str) -> bool:
    return bool(PROCEDURE_HEADING.search(heading)) and not NOT_PROCEDURE_HEADING.search(heading)

ENTITY_TYPES = ("equipment", "component", "fault", "symptom", "procedure", "standard", "concept")


@dataclass(frozen=True)
class Mention:
    type: str
    key: str
    name: str
    start: int
    end: int
    surface: str
    equipment_class: str | None = None  # equipment only: the class of a class or instance

    @property
    def entity_id(self) -> str:
        return entity_id(self.type, self.key)


def entity_id(type_: str, key: str) -> str:
    return f"ent_{type_}_{key}"


def _alias(alias: str) -> str:
    return r"[\s-]+".join(re.escape(w) for w in re.split(r"[\s-]+", alias.strip()))


_TERM_INDEX: list[tuple[str, str, str, str | None]] = []  # group -> (type, key, name, class)
_alternatives: list[tuple[int, str]] = []
for _type, _terms in TERMS.items():
    for _key, _name, _aliases in _terms:
        for _a in _aliases:
            _alternatives.append((len(_a), _alias(_a)))
            _TERM_INDEX.append((_type, _key, _name, _key if _type == "equipment" else None))
# Longest alias first, so "condenser water pump" wins over "condenser" at the same place.
_order = sorted(range(len(_alternatives)), key=lambda i: -_alternatives[i][0])
_TERM_INDEX = [_TERM_INDEX[i] for i in _order]
TERM_PATTERN = re.compile(
    r"(?<!\w)(?:" + "|".join(f"({_alternatives[i][1]})" for i in _order) + r")(?:e?s)?(?!\w)", re.I
)
INSTANCE_PATTERNS = [
    # Not part of a longer number or a decimal, and not a quantity ("chiller 7 °C").
    (re.compile(r"(?<!\w)" + p + r"(?!\d)(?!\.\d)(?!\s*(?:°|%|kw\b|kpa\b|bar\b|m³|l/s))", re.I), prefix, cls, label)
    for p, prefix, cls, label in INSTANCES
]


def standard_key(body: str, guideline: str, number: str) -> tuple[str, str]:
    # "ASHRAE Standard 90.1" and "ASHRAE 90.1" are one standard; a Guideline is its own series.
    name = f"{body} {'Guideline ' if guideline else ''}{number}"
    return re.sub(r"[^a-z0-9]+", "_", name.lower()).strip("_"), name


def find_mentions(text: str) -> list[Mention]:
    """Every vocabulary term, site instance and cited standard in `text`, left to right.
    Overlaps resolve to the longest span, so "low chilled water delta-T" is one symptom
    and not also the concept "chilled water"."""
    found: list[Mention] = []
    for m in TERM_PATTERN.finditer(text):
        type_, key, name, cls = _TERM_INDEX[m.lastindex - 1]
        found.append(Mention(type_, key, name, m.start(), m.end(), m.group(0), cls))
    for pattern, prefix, cls, label in INSTANCE_PATTERNS:
        for m in pattern.finditer(text):
            n = int(m.group(1))
            found.append(Mention("equipment", f"{prefix}{n}", f"{label} {n}", m.start(), m.end(), m.group(0), cls))
    for m in STANDARD.finditer(text):
        key, name = standard_key(m.group(1), m.group(2) or "", m.group(3))
        found.append(Mention("standard", key, name, m.start(), m.end(), m.group(0)))
    found.sort(key=lambda x: (x.start, -(x.end - x.start)))
    kept: list[Mention] = []
    for m in found:
        if kept and m.start < kept[-1].end:
            if m.end - m.start > kept[-1].end - kept[-1].start:
                kept[-1] = m
            continue
        kept.append(m)
    return kept


def equipment_name(equipment_id: str) -> str:
    """Display name for a declared equipment ID (document metadata)."""
    for _p, prefix, _cls, label in INSTANCES:
        if equipment_id.startswith(prefix) and equipment_id[len(prefix):].isdigit():
            return f"{label} {int(equipment_id[len(prefix):])}"
    for key, name, _a in TERMS["equipment"]:
        if key == equipment_id:
            return name
    return equipment_id


def equipment_class(equipment_id: str) -> str | None:
    for _p, prefix, cls, _label in INSTANCES:
        if equipment_id.startswith(prefix):
            return cls
    return equipment_id if any(k == equipment_id for k, _n, _a in TERMS["equipment"]) else None
