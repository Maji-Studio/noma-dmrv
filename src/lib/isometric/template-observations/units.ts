import { SEMANTIC_BINDING_CATALOG } from "../semantic-binding-catalog";
import { ISOMETRIC_KILOGRAM_UNIT, kilogramUnitsMatch } from "../quantity-units";
import type { QuantityKind } from "./types";

// Same wire units and quantity-kind boundaries as buildCreateDatapointRequest.
// Aliases only normalize spellings. Different scales remain different units in
// the fingerprint, but can be recognized as convertible when reviewing entries.
const UNIT_ALIASES: Partial<Record<QuantityKind, Readonly<Record<string, readonly string[]>>>> = {
  mass: { kg: ["kilogram"], g: ["gram"], tonne: ["metric_ton", "t"] },
  energy: { kWh: ["kilowatt_hour"], Wh: ["watt_hour"], MWh: ["megawatt_hour"], MJ: ["megajoule"], J: ["joule"] },
  volume: { l: ["L", "litre", "liter"], ml: ["millilitre", "milliliter"], "m^3": ["m3", "cubic_meter"] },
  distance: { km: ["kilometer", "kilometre"], m: ["meter", "metre"], mi: ["mile"] },
  mass_distance: { "tonne * km": ["metric_ton * kilometer", "t * km"], "kg * km": ["kilogram * kilometer"], "kg * m": [] },
  dimensionless: { dimensionless: ["1"] },
  dimensionless_ratio: { dimensionless: ["1"], percent: ["%"] },
  mass_fraction: { dimensionless: ["1", "kg / kg"], percent: ["%"], "g / kg": [], ppm: [] },
  mass_fraction_dry_basis: { dimensionless: ["1", "kg / kg"], percent: ["%"] },
  mass_concentration: { "kg / m^3": ["kg / m3"], "g / m^3": ["g / m3"], "mg / m^3": ["mg / m3"] },
  mass_flow_rate: { "kg / s": [], "kg / h": [], "g / s": [] },
  mass_carbon: { kgCO2e: ["kg_co2e"], tCO2e: ["tonne_co2e"] },
  energy_carbon_emission_factor: { "kgCO2e / kWh": ["kg_co2e / kilowatt_hour"], "kgCO2e / MJ": [] },
  volume_carbon_emission_factor: { "kgCO2e / l": ["kg_co2e / liter"], "kgCO2e / m^3": [] },
  mass_carbon_emission_factor: { "kgCO2e / tonne": ["kgCO2e / metric_ton"], "kgCO2e / kg": [] },
  distance_carbon_emission_factor: { "kgCO2e / km": ["kg_co2e / kilometer"], "kgCO2e / m": [] },
  mass_distance_carbon_emission_factor: {
    "kgCO2e / (tonne * km)": ["kgCO2e / (metric_ton * kilometer)", "kgCO2e / tonne / km"],
    "kgCO2e / (kg * km)": [],
  },
};

function unitKey(unit: string): string {
  return unit.trim().toLowerCase().replace(/\s+/g, "");
}

/** Undefined means the input blocks; callers never guess a unit. */
export function canonicalUnit(quantityKind: QuantityKind, unit: string): string | undefined {
  if (quantityKind === "mass" && kilogramUnitsMatch(unit.toLowerCase(), ISOMETRIC_KILOGRAM_UNIT)) return ISOMETRIC_KILOGRAM_UNIT;
  const key = unitKey(unit);
  for (const [canonical, aliases] of Object.entries(UNIT_ALIASES[quantityKind] ?? {})) {
    if ([canonical, ...aliases].some((alias) => unitKey(alias) === key)) return canonical;
  }
  for (const inputs of Object.values(SEMANTIC_BINDING_CATALOG)) {
    for (const binding of Object.values(inputs)) {
      if (binding.datapoint?.expectedQuantityKind === quantityKind && unitKey(binding.datapoint.unit) === key) {
        return binding.datapoint.unit;
      }
    }
  }
  return undefined;
}

// Bound expansion of exponent notation without rounding decimal strings through
// Number. This limit also prevents malformed enrichment allocating huge strings.
const MAX_DECIMAL_EXPONENT = 1000;
export function canonicalDecimal(value: string | number): string | undefined {
  if (typeof value === "number" && !Number.isFinite(value)) return undefined;
  const decimal = String(value).trim().replace(/^([+-]?)\./, (_, sign: string) => `${sign}0.`);
  const match = /^([+-]?)(\d+)(?:\.(\d*))?(?:e([+-]?\d+))?$/i.exec(decimal);
  if (!match) return undefined;
  const [, sign, whole, fraction = "", exponent = "0"] = match;
  const shift = Number(exponent);
  if (!Number.isSafeInteger(shift) || Math.abs(shift) > MAX_DECIMAL_EXPONENT) return undefined;
  const digits = whole + fraction;
  const point = whole.length + shift;
  const expanded = point <= 0 ? `0.${"0".repeat(-point)}${digits}`
    : point >= digits.length ? digits + "0".repeat(point - digits.length)
      : `${digits.slice(0, point)}.${digits.slice(point)}`;
  const [integer, decimalPart = ""] = expanded.split(".");
  const trimmedFraction = decimalPart.replace(/0+$/, "");
  const normalized = (integer.replace(/^0+(?=\d)/, "") || "0") + (trimmedFraction ? `.${trimmedFraction}` : "");
  return sign === "-" && normalized !== "0" ? `-${normalized}` : normalized;
}
