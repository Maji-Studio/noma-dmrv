import type { QuantityKind } from "./types";

type Dimensions = Record<string, number>;
interface Atom { canonical: string; dimension: string }
const ATOMS: Record<string, Atom> = {};
function atoms(dimension: string, spellings: Record<string, string[]>) {
  for (const [canonical, aliases] of Object.entries(spellings)) {
    for (const spelling of [canonical, ...aliases]) ATOMS[spelling] = { canonical, dimension };
  }
}
atoms("mass", { mg: ["milligram"], g: ["gram"], kg: ["kilogram"], tonne: ["metric_ton", "t"] });
atoms("carbon", { gCO2e: ["g_co2e"], kgCO2e: ["kg_co2e"], tCO2e: ["tonne_co2e"] });
atoms("distance", { m: ["meter", "metre"], km: ["kilometer", "kilometre"], mi: ["mile"] });
atoms("volume", { L: ["liter", "litre", "l"], mL: ["ml", "milliliter", "millilitre"], "m^3": ["m3", "cubic_meter"] });
atoms("energy", { kWh: ["kilowatt_hour"], Wh: ["watt_hour"], MWh: ["megawatt_hour"], MJ: ["megajoule"], J: ["joule"] });
atoms("time", { s: ["second"], h: ["hour"], day: [] });
atoms("", { "%": ["percent"], dimensionless: ["1"], ppm: [] });

const KIND_DIMENSIONS: Partial<Record<QuantityKind, Dimensions>> = {
  mass: { mass: 1 }, distance: { distance: 1 }, energy: { energy: 1 }, volume: { volume: 1 },
  mass_distance: { mass: 1, distance: 1 }, mass_carbon: { carbon: 1 },
  dimensionless: {}, dimensionless_ratio: {}, mass_fraction: {}, mass_fraction_dry_basis: {},
  mass_fraction_wet_basis: {}, mass_ratio: {}, volume_fraction: {},
  mass_concentration: { mass: 1, volume: -1 }, mass_density: { mass: 1, volume: -1 },
  bulk_density: { mass: 1, volume: -1 }, mass_flow_rate: { mass: 1, time: -1 },
  energy_carbon_emission_factor: { carbon: 1, energy: -1 },
  volume_carbon_emission_factor: { carbon: 1, volume: -1 },
  mass_carbon_emission_factor: { carbon: 1, mass: -1 },
  distance_carbon_emission_factor: { carbon: 1, distance: -1 },
  mass_distance_carbon_emission_factor: { carbon: 1, mass: -1, distance: -1 },
};

/** Recursive descent for products and left-associative divisions. No unit guessing. */
function parseUnit(unit: string): { numerator: string[]; denominator: string[]; dimensions: Dimensions } | undefined {
  const tokens = unit.trim().match(/[^\s*()/]+|[()*\/]/g) ?? [];
  let position = 0;
  function factor(): Array<[Atom, number]> {
    const token = tokens[position++];
    if (token === "(") {
      const result = expression();
      if (tokens[position++] !== ")") throw new Error("Unclosed unit expression");
      return result;
    }
    const atom = Object.hasOwn(ATOMS, token) ? ATOMS[token] : undefined;
    if (!atom) throw new Error("Unknown unit atom");
    return [[atom, 1]];
  }
  function expression(): Array<[Atom, number]> {
    const result = factor();
    while (tokens[position] === "*" || tokens[position] === "/") {
      const sign = tokens[position++] === "/" ? -1 : 1;
      result.push(...factor().map(([atom, power]): [Atom, number] => [atom, sign * power]));
    }
    return result;
  }
  try {
    const parsed = expression();
    if (position !== tokens.length) return undefined;
    const dimensions: Dimensions = {};
    const numerator: string[] = [];
    const denominator: string[] = [];
    for (const [atom, power] of parsed) {
      (power > 0 ? numerator : denominator).push(atom.canonical);
      if (atom.dimension) dimensions[atom.dimension] = (dimensions[atom.dimension] ?? 0) + power;
    }
    for (const key of Object.keys(dimensions)) if (dimensions[key] === 0) delete dimensions[key];
    return { numerator: numerator.sort(), denominator: denominator.sort(), dimensions };
  } catch { return undefined; }
}

function sameDimension(a: Dimensions, b: Dimensions): boolean {
  return Object.keys(a).length === Object.keys(b).length && Object.entries(a).every(([key, value]) => b[key] === value);
}

/** Scales remain distinct; equivalent expressions share an ordered spelling. */
export function canonicalUnit(kind: QuantityKind, unit: string): string | undefined {
  const parsed = parseUnit(unit);
  const expected = KIND_DIMENSIONS[kind];
  if (!parsed || !expected || !sameDimension(parsed.dimensions, expected)) return undefined;
  const numerator = parsed.numerator.join(" * ") || "dimensionless";
  return parsed.denominator.length === 0 ? numerator
    : `${numerator} / ${parsed.denominator.length === 1 ? parsed.denominator[0] : `(${parsed.denominator.join(" * ")})`}`;
}

export function unitsConvertible(kind: QuantityKind, a: string, b: string): boolean {
  return canonicalUnit(kind, a) !== undefined && canonicalUnit(kind, b) !== undefined;
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
