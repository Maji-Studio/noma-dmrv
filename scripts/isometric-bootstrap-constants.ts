/**
 * Curated DEFRA/IPCC defaults for the 13 unbound `type=fixed` inputs on
 * the sandbox `Dark Earth removal template` (rvt_1K9YK6YRQSBXFVZ0).
 *
 * Keyed by `${componentDisplayName}::${inputKey}` because the same input key
 * (e.g. `fuel_combustion_carbon_intensity`, `carbon_intensity`) appears on
 * multiple components and we need to disambiguate.
 *
 * IMPORTANT — overengineering guard:
 * These values are static reference data (DEFRA 2024, IPCC AR6). They are
 * NOT noma-specific policy. Do NOT migrate this map into a DB table or
 * admin UI. If a verifier requests project-specific factors, edit the
 * Datapoint magnitude in the Registry UI (the template binding survives)
 * or, if multiple projects need different values, lift the table into a
 * small JSON config keyed by project ID. See
 * `docs/isometric/changes.md` (2026-05-13 bootstrap-constants entry).
 */
export interface FixedConstantDefault {
  magnitude: number;
  // Hint for the operator only — the actual unit POSTed is read from the
  // live blueprint's `compatible_unit` to avoid string-drift ("L" vs "l").
  expectedUnitHint: string;
  description: string;
  citation: string;
}

export const FIXED_CONSTANT_DEFAULTS: Record<string, FixedConstantDefault> = {
  "Biomass processing fuel usage::fuel_combustion_carbon_intensity": {
    magnitude: 2.68,
    expectedUnitHint: "kgCO2e/L",
    description: "Diesel combustion CI for off-road biomass processing equipment",
    citation: "DEFRA 2024 conversion factors — diesel (average biofuel blend)",
  },
  "Pyrolyzer electricity usage::carbon_intensity": {
    magnitude: 0.21,
    expectedUnitHint: "kgCO2e/kWh",
    description: "Grid electricity carbon intensity for pyrolyzer electrical load",
    citation: "DEFRA 2024 conversion factors — UK grid average",
  },
  "Pyrolyzer CH₄ emissions::global_warming_potential": {
    magnitude: 27,
    expectedUnitHint: "dimensionless",
    description: "GWP of methane (CH4), 100-year horizon",
    citation: "IPCC AR6 (2021) GWP100 for CH4",
  },
  "Pyrolyzer CO emissions::global_warming_potential": {
    magnitude: 1.9,
    expectedUnitHint: "dimensionless",
    description: "Indirect GWP of carbon monoxide (CO) via atmospheric oxidation",
    citation: "IPCC AR4 indirect GWP100 for CO (no AR6 update)",
  },
  "Biochar processing electricity usage::grid_carbon_intensity": {
    magnitude: 0.21,
    expectedUnitHint: "kgCO2e/kWh",
    description: "Grid electricity carbon intensity for biochar post-processing",
    citation: "DEFRA 2024 conversion factors — UK grid average",
  },
  "Biochar transportation to storage site via truck::carbon_intensity": {
    // Live blueprint declares gCO2e/(tonne·km), NOT kg. DEFRA HGV ≈ 107 g/(t·km).
    magnitude: 107,
    expectedUnitHint: "gCO2e / (tonne * km)",
    description: "HGV freight carbon intensity per tonne-kilometre",
    citation: "DEFRA 2024 — articulated HGV (>33t, average laden)",
  },
  "Biochar transportation to tractor via loader::emissions_factor": {
    magnitude: 2.68,
    expectedUnitHint: "kgCO2e/L",
    description: "Diesel combustion factor for loader fuel consumption",
    citation: "DEFRA 2024 conversion factors — diesel",
  },
  "Biochar transportation to tractor via loader::volume_material_per_mass": {
    // Live blueprint declares m³/kg, NOT m³/tonne. Biochar bulk density
    // ≈400 kg/m³ → inverse = 1/400 = 0.0025 m³/kg.
    magnitude: 0.0025,
    expectedUnitHint: "m^3 / kg",
    description: "Inverse bulk density of biochar (≈400 kg/m³ → 0.0025 m³/kg)",
    citation: "IBI Biochar Standards v2.1 — typical bulk density range",
  },
  "Biochar application via tractor::fuel_combustion_carbon_intensity": {
    magnitude: 2.68,
    expectedUnitHint: "kgCO2e/L",
    description: "Diesel combustion factor for tractor field application",
    citation: "DEFRA 2024 conversion factors — diesel",
  },
  "Sampling consumables::carbon_intensity": {
    // PLACEHOLDER — replace before production submission. See
    // docs/isometric/next-steps.md.
    magnitude: 1.0,
    expectedUnitHint: "kgCO2e/unit",
    description: "Placeholder embodied emissions per sampling kit (NOT researched)",
    citation: "Placeholder — replace with vendor LCA before production",
  },
  "Sample transportation via car::carbon_intensity": {
    magnitude: 0.171,
    expectedUnitHint: "kgCO2e/km",
    description: "Average passenger car emissions factor per kilometre",
    citation: "DEFRA 2024 — average car (unknown size/fuel)",
  },
  "Laboratory analysis electricity use::grid_carbon_intensity": {
    magnitude: 0.21,
    expectedUnitHint: "kgCO2e/kWh",
    description: "Grid electricity carbon intensity for lab analysis equipment",
    citation: "DEFRA 2024 conversion factors — UK grid average",
  },
  "Staff travel::carbon_intensity": {
    magnitude: 0.171,
    expectedUnitHint: "kgCO2e/km",
    description: "Average passenger car emissions factor for staff site visits",
    citation: "DEFRA 2024 — average car",
  },
};

export function lookupFixedConstantDefault(
  componentDisplayName: string,
  inputKey: string,
): FixedConstantDefault | undefined {
  return FIXED_CONSTANT_DEFAULTS[`${componentDisplayName}::${inputKey}`];
}

export function buildBootstrapSupplierRef(args: {
  templateId: string;
  rtcId: string;
  inputKey: string;
}): string {
  // Stable across re-runs so we reconcile via findDatapointBySupplierRef
  // rather than POSTing duplicates. The template ID alone is too coarse
  // (multiple inputs per template); the rtcId disambiguates per component.
  return `nm-fc-${args.templateId}-${args.rtcId}-${args.inputKey}`.slice(0, 100);
}
