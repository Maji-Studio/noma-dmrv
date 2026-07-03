/**
 * Biochar carbon-removal calculations — CO₂e durably stored in soil.
 *
 * ─── PROTOTYPE / ORIENTATION ──────────────────────────────────────────────
 * This is the single in-app engine for the "CO₂e stored" figure. It is a LOCAL
 * PREVIEW: the authoritative number is produced by Isometric's verification.
 * The point of having one engine is drift control — the per-application figure,
 * the credit-batch total, and the value we submit to Certify must all flow
 * through these same pure functions. A protocol version bump happens HERE first.
 *
 * ─── AUTHORITATIVE SOURCE (pinned, see docs/isometric/versions.json) ──────────
 *   Module: "Biochar Storage in Soil Environments" v1.2 (CERTIFIED, tag 1.2.0)
 *   https://registry.isometric.com/module/biochar-storage-soil-environments/1.2?tag=1.2.0
 *
 *   Eq.1  §5.1.1.1   CO₂e_stored = C_biochar × m_biochar × F_durable × 44.01/12.01
 *   Eq.2  §5.1.1.2   C_biochar   = Total Carbon − Inorganic Carbon (organic, dry basis)
 *   Eq.3  §5.1.1.3.1 F_durable,200 = min(0.95, 1 − [c + (a + b·ln(T_soil))·H/C_org])
 *                    Table 4: a = −0.383, b = 0.350, c = −0.048
 *                    T_soil floored at 7 °C, rounded to 1 dp; F_durable capped at 0.95.
 *   Eq.6  §5.1.1.3.2 F_durable,1000 = min(0.95, max(0, (R̄₀ − s_R₀)(C̄_non-reactive − s_C_non-reactive)))
 *                    ⚠️ term semantics are ambiguous in the module — see the
 *                    normalization note on computeFDurable1000 below.
 *
 * All material properties are reported on a DRY BASIS (Module §3.3).
 *
 * NOTE: Any summary of the protocol is non-authoritative. Verify credit claims
 * against the authoritative URL above before relying on this output.
 */

// ── Pinned protocol constants ────────────────────────────────────────────────

/** Storage module patch version these constants are derived from. Bump here first. */
export const SOIL_STORAGE_MODULE_VERSION = "1.2.0";

/**
 * CO₂ ↔ elemental-carbon mass ratio (Eq.1). The protocol specifies the
 * isotope-weighted molar masses 44.01 / 12.01 = 3.66445…  — NOT the textbook
 * 44 / 12 = 3.66667. Using 44/12 over-credits by ~0.06%; small, but it is
 * exactly the kind of silent drift this module exists to prevent.
 */
export const CO2_C_MOLAR_RATIO = 44.01 / 12.01;

/** Fixed Woolf (2021) decay coefficients for the 200-year horizon (Eq.3, Table 4). */
export const F_DURABLE_200_COEFFICIENTS = { a: -0.383, b: 0.35, c: -0.048 } as const;

/** Conservative cap on the durable fraction (§5.1.1.3.1). */
export const F_DURABLE_MAX = 0.95;

/**
 * Cap on the 1000-year durable fraction (Eq.6, §5.1.1.3.2). The module applies
 * the SAME 0.95 ceiling to both durability options — alias it so a future
 * divergence is a deliberate one-line change here, not a silent drift.
 */
export const F_DURABLE_1000_CAP = F_DURABLE_MAX;

/**
 * Conservative minimum soil temperature (§5.1.1.3.1). Sites subject to periodic
 * freezing are floored to 7 °C before entering the durability equation.
 */
export const SOIL_TEMPERATURE_FLOOR_C = 7;

/**
 * Soil-temperature spread (°C) above which a project boundary must be
 * subdivided OR the most conservative (highest) value used (module §5). noma
 * takes the conservative-max path and raises a subdivide advisory past this.
 */
export const SOIL_TEMPERATURE_SUBDIVIDE_SPREAD_C = 1;

/**
 * Tolerance (in percentage points) when cross-checking a reported organic-carbon
 * value against (Total C − Inorganic C). A larger gap means the lab columns
 * disagree and the inputs should be reconciled before crediting.
 */
export const CARBON_RECONCILIATION_TOLERANCE_PCT = 0.1;

const PERCENT_DENOMINATOR = 100;

// ── Helpers ──────────────────────────────────────────────────────────────────

function isUsableNumber(value: number | null | undefined): value is number {
  return value != null && Number.isFinite(value);
}

/** Round to one decimal place — the precision the protocol mandates for T_soil. */
export function roundSoilTemperatureC(value: number): number {
  return Math.round(value * 10) / 10;
}

// ── Eq.2 — organic carbon content, on a dry basis ────────────────────────────

export interface OrganicCarbonInput {
  /** Reported organic carbon (%, dry basis). Usually the sample's `organicCarbonPercent`. */
  organicCarbonPercent?: number | null;
  /** Total carbon (%, dry basis). Used to derive/reconcile via Eq.2. */
  totalCarbonPercent?: number | null;
  /** Inorganic carbon (%, dry basis). Used to derive/reconcile via Eq.2. */
  inorganicCarbonPercent?: number | null;
}

export interface OrganicCarbonResult {
  /** Organic carbon (%, dry basis), or null when it cannot be determined. */
  value: number | null;
  source: "reported" | "derived" | "missing";
  warnings: string[];
}

/**
 * Resolve C_biochar (organic carbon, %) per Eq.2. Prefers a directly reported
 * organic-carbon value; otherwise derives it from Total − Inorganic. When both
 * are present they are reconciled, and a disagreement beyond
 * CARBON_RECONCILIATION_TOLERANCE_PCT raises a warning (drift guard).
 */
export function resolveOrganicCarbonPercent(
  input: OrganicCarbonInput,
): OrganicCarbonResult {
  const warnings: string[] = [];
  const derived = isUsableNumber(input.totalCarbonPercent) && isUsableNumber(input.inorganicCarbonPercent)
    ? input.totalCarbonPercent - input.inorganicCarbonPercent
    : null;

  if (isUsableNumber(input.organicCarbonPercent)) {
    if (derived != null && Math.abs(derived - input.organicCarbonPercent) > CARBON_RECONCILIATION_TOLERANCE_PCT) {
      warnings.push(
        `Organic carbon mismatch: reported ${input.organicCarbonPercent}% vs Total−Inorganic ${derived.toFixed(2)}% (Eq.2). Reconcile lab inputs.`,
      );
    }
    return { value: input.organicCarbonPercent, source: "reported", warnings };
  }

  if (derived != null) {
    return { value: derived, source: "derived", warnings };
  }

  return { value: null, source: "missing", warnings };
}

// ── Eq.3 — 200-year durable fraction ─────────────────────────────────────────

export interface FDurable200Input {
  /** Average annual soil temperature at the storage site (°C). */
  soilTemperatureC: number;
  /** Molar hydrogen / organic-carbon ratio (dimensionless, dry basis). */
  hToCorgRatio: number;
}

export interface FDurable200Result {
  fDurable: number;
  /** T_soil actually used after applying the 7 °C floor + 1 dp rounding. */
  effectiveSoilTemperatureC: number;
  temperatureFloored: boolean;
  /** True when the raw fraction exceeded 0.95 and was capped. */
  durabilityCapped: boolean;
}

/**
 * Compute F_durable,200 (Eq.3). Applies the 7 °C floor and 1-decimal rounding to
 * T_soil, then the 0.95 cap. H/C_org below the model's 0.1 calibration floor is
 * not rejected — the 0.95 cap is the protocol's conservative handling for it.
 */
export function computeFDurable200(input: FDurable200Input): FDurable200Result {
  const { a, b, c } = F_DURABLE_200_COEFFICIENTS;

  const rounded = roundSoilTemperatureC(input.soilTemperatureC);
  const temperatureFloored = input.soilTemperatureC < SOIL_TEMPERATURE_FLOOR_C;
  const effectiveSoilTemperatureC = temperatureFloored ? SOIL_TEMPERATURE_FLOOR_C : rounded;

  const raw = 1 - (c + (a + b * Math.log(effectiveSoilTemperatureC)) * input.hToCorgRatio);
  const durabilityCapped = raw > F_DURABLE_MAX;
  const fDurable = Math.min(F_DURABLE_MAX, raw);

  return { fDurable, effectiveSoilTemperatureC, temperatureFloored, durabilityCapped };
}

// ── Eq.6 — 1000-year durable fraction ────────────────────────────────────────

export interface FDurable1000Input {
  /** Mean random reflectance R̄₀ (%, petrography) — `creditBatches.meanRandomReflectancePercent`. */
  meanRandomReflectancePercent: number;
  /** Sample std-dev of R₀ (percentage points, n−1) — `creditBatches.stdRandomReflectance`. */
  stdRandomReflectance: number;
  /** Mean non-reactive (residual) carbon C̄ (%, TGA) — `creditBatches.meanNonReactiveCarbonPercent`. */
  meanNonReactiveCarbonPercent: number;
  /** Sample std-dev of non-reactive carbon (percentage points, n−1) — `creditBatches.stdNonReactiveCarbonPercent`. */
  stdNonReactiveCarbonPercent: number;
}

export interface FDurable1000Result {
  fDurable: number;
  /** True when the raw Eq.6 product exceeded the 0.95 ceiling and was capped. */
  durabilityCapped: boolean;
}

/**
 * Compute F_durable,1000 (Eq.6, §5.1.1.3.2).
 *
 * ─── ⚠️ LOUD WARNING — Eq.6 NORMALIZATION IS A DOCUMENTED INTERPRETATION ─────
 * The certified module states Eq.6 verbatim as
 *
 *   F_durable,1000 = min(0.95, max(0, (R̄₀ − s_R₀)(C̄_non-reactive − s_C_non-reactive)))
 *
 * but Table 3 lists BOTH factors in percent, which makes the literal product
 * dimensionally incoherent with the 0.95 cap:
 *   - percent-as-number:  (2.8 − 0.3)(68 − 2)           = 165    → cap ALWAYS bites;
 *   - both as fractions:  (0.028 − 0.003)(0.68 − 0.02) ≈ 0.0165 → absurdly low.
 * The protocol NARRATIVE ("credited for the percentage of their biochar which
 * passes the 2% R₀ benchmark") instead implies the first multiplicand is the
 * histogram FRACTION of R₀ measurements ≥ 2% — contradicting the formal
 * glossary (R̄₀ = "mean of all R₀ measurements"). A genuine internal protocol
 * inconsistency; unresolved with Isometric as of 2026-07-03.
 *
 * CHOSEN INTERPRETATION (local preview only — the registry computes the
 * authoritative F_durable at submission):
 *   - R₀ term: Eq.6 applied literally to the stored columns — mean minus
 *     std-dev, both in percent, mirroring `meanRandomReflectancePercent`;
 *   - carbon term: normalized percent → fraction (÷ PERCENT_DENOMINATOR) so
 *     the 0.95 cap is meaningful rather than always saturated.
 * The mandatory min/max bounds guarantee output ∈ [0, 0.95] under ANY reading.
 * Do NOT drive a LIVE 1000-year submission off this preview before Isometric
 * confirms the R₀-term semantics — see docs/open-questions.md (2026-07-03).
 * Authoritative module:
 * https://registry.isometric.com/module/biochar-storage-soil-environments/1.2?tag=1.2.0
 * ──────────────────────────────────────────────────────────────────────────────
 */
export function computeFDurable1000(input: FDurable1000Input): FDurable1000Result {
  const reflectanceTerm =
    input.meanRandomReflectancePercent - input.stdRandomReflectance;
  const nonReactiveCarbonFraction =
    (input.meanNonReactiveCarbonPercent - input.stdNonReactiveCarbonPercent) /
    PERCENT_DENOMINATOR;

  const raw = reflectanceTerm * nonReactiveCarbonFraction;
  const floored = Math.max(0, raw);
  const durabilityCapped = floored > F_DURABLE_1000_CAP;
  const fDurable = Math.min(F_DURABLE_1000_CAP, floored);

  return { fDurable, durabilityCapped };
}

// ── Eq.1 — CO₂e stored ───────────────────────────────────────────────────────

export interface Co2eStoredInput {
  /** Organic carbon content C_biochar (%, dry basis). */
  organicCarbonPercent: number;
  /** Dry mass of biochar applied m_biochar (tonnes). */
  dryMassTonnes: number;
  /** Durable fraction F_durable (0–0.95). */
  fDurable: number;
}

/** CO₂e durably stored in tonnes (Eq.1). Pure multiply — no clamping. */
export function computeCo2eStoredTonnes(input: Co2eStoredInput): number {
  const carbonFraction = input.organicCarbonPercent / PERCENT_DENOMINATOR;
  return carbonFraction * input.dryMassTonnes * input.fDurable * CO2_C_MOLAR_RATIO;
}

// ── Top-level: per-application CO₂e stored ───────────────────────────────────

export interface ApplicationCo2eStoredInput {
  /**
   * Durability crediting option (`creditBatches.durabilityOption`).
   * "1000_year" routes through Eq.6; anything else takes the 200-year path.
   */
  durabilityOption?: "200_year" | "1000_year" | null;
  /** Dry mass of biochar applied (tonnes) — e.g. `applications.biocharAppliedDryTons`. */
  dryMassTonnes?: number | null;
  /** Average annual soil temperature (°C) — `applications.soilTemperatureC`. 200-year only. */
  soilTemperatureC?: number | null;
  /** Molar H/C_org — the sample-weighted `weightedHToCorgRatio`. 200-year only. */
  hToCorgRatio?: number | null;
  /** Organic carbon (%) — the sample-weighted `weightedOrganicCarbonPercent`. */
  organicCarbonPercent?: number | null;
  /** Optional Total/Inorganic carbon (%) for Eq.2 derivation + drift reconciliation. */
  totalCarbonPercent?: number | null;
  inorganicCarbonPercent?: number | null;
  /** 1000-year (Eq.6) inputs — the credit batch's stored petrography/TGA columns. */
  meanRandomReflectancePercent?: number | null;
  stdRandomReflectance?: number | null;
  meanNonReactiveCarbonPercent?: number | null;
  stdNonReactiveCarbonPercent?: number | null;
}

export interface ApplicationCo2eStoredResult {
  /** CO₂e durably stored (tonnes), or null when a required input is missing. */
  co2eStoredTonnes: number | null;
  fDurable: number | null;
  organicCarbonPercent: number | null;
  effectiveSoilTemperatureC: number | null;
  temperatureFloored: boolean;
  durabilityCapped: boolean;
  /** Patch version of the storage module these numbers were computed against. */
  moduleVersion: string;
  /** Inputs that were missing/unusable, blocking a value. */
  missingInputs: string[];
  /** Non-blocking advisories (e.g. carbon reconciliation, temperature floor). */
  warnings: string[];
}

/**
 * Compose Eq.2 → durability (Eq.3 or Eq.6, per `durabilityOption`) → Eq.1 for a
 * single application. Returns a structured, auditable result. When any required
 * input is absent the value is null and the gap is reported in `missingInputs`
 * (mirrors `resolveDeliveryDryMass`). Feed `organicCarbonPercent` /
 * `hToCorgRatio` from the SAME sample-weighted aggregation used for Certify
 * submission so the preview can't drift from it.
 */
export function computeApplicationCo2eStored(
  input: ApplicationCo2eStoredInput,
): ApplicationCo2eStoredResult {
  if (input.durabilityOption === "1000_year") {
    return computeApplicationCo2eStored1000(input);
  }

  const missingInputs: string[] = [];
  const warnings: string[] = [];

  const carbon = resolveOrganicCarbonPercent(input);
  warnings.push(...carbon.warnings);
  if (carbon.value == null) missingInputs.push("organicCarbonPercent");

  if (!isUsableNumber(input.dryMassTonnes)) missingInputs.push("dryMassTonnes");
  if (!isUsableNumber(input.soilTemperatureC)) missingInputs.push("soilTemperatureC");
  if (!isUsableNumber(input.hToCorgRatio)) missingInputs.push("hToCorgRatio");

  if (missingInputs.length > 0 || carbon.value == null || !isUsableNumber(input.dryMassTonnes)
    || !isUsableNumber(input.soilTemperatureC) || !isUsableNumber(input.hToCorgRatio)) {
    return {
      co2eStoredTonnes: null,
      fDurable: null,
      organicCarbonPercent: carbon.value,
      effectiveSoilTemperatureC: null,
      temperatureFloored: false,
      durabilityCapped: false,
      moduleVersion: SOIL_STORAGE_MODULE_VERSION,
      missingInputs,
      warnings,
    };
  }

  const durability = computeFDurable200({
    soilTemperatureC: input.soilTemperatureC,
    hToCorgRatio: input.hToCorgRatio,
  });
  if (durability.temperatureFloored) {
    warnings.push(`Soil temperature floored to ${SOIL_TEMPERATURE_FLOOR_C} °C (§5.1.1.3.1).`);
  }

  const co2eStoredTonnes = computeCo2eStoredTonnes({
    organicCarbonPercent: carbon.value,
    dryMassTonnes: input.dryMassTonnes,
    fDurable: durability.fDurable,
  });

  return {
    co2eStoredTonnes,
    fDurable: durability.fDurable,
    organicCarbonPercent: carbon.value,
    effectiveSoilTemperatureC: durability.effectiveSoilTemperatureC,
    temperatureFloored: durability.temperatureFloored,
    durabilityCapped: durability.durabilityCapped,
    moduleVersion: SOIL_STORAGE_MODULE_VERSION,
    missingInputs,
    warnings,
  };
}

/**
 * 1000-year variant: Eq.2 → Eq.6 → Eq.1. Requires the four petrography/TGA
 * batch inputs instead of soil temperature + H/C_org; the temperature-related
 * result fields are inert (`null` / `false`) since Eq.6 has no T_soil term.
 * See the ⚠️ normalization warning on `computeFDurable1000`.
 */
function computeApplicationCo2eStored1000(
  input: ApplicationCo2eStoredInput,
): ApplicationCo2eStoredResult {
  const missingInputs: string[] = [];
  const warnings: string[] = [];

  const carbon = resolveOrganicCarbonPercent(input);
  warnings.push(...carbon.warnings);
  if (carbon.value == null) missingInputs.push("organicCarbonPercent");

  if (!isUsableNumber(input.dryMassTonnes)) missingInputs.push("dryMassTonnes");
  if (!isUsableNumber(input.meanRandomReflectancePercent)) {
    missingInputs.push("meanRandomReflectancePercent");
  }
  if (!isUsableNumber(input.stdRandomReflectance)) {
    missingInputs.push("stdRandomReflectance");
  }
  if (!isUsableNumber(input.meanNonReactiveCarbonPercent)) {
    missingInputs.push("meanNonReactiveCarbonPercent");
  }
  if (!isUsableNumber(input.stdNonReactiveCarbonPercent)) {
    missingInputs.push("stdNonReactiveCarbonPercent");
  }

  if (
    carbon.value == null ||
    !isUsableNumber(input.dryMassTonnes) ||
    !isUsableNumber(input.meanRandomReflectancePercent) ||
    !isUsableNumber(input.stdRandomReflectance) ||
    !isUsableNumber(input.meanNonReactiveCarbonPercent) ||
    !isUsableNumber(input.stdNonReactiveCarbonPercent)
  ) {
    return {
      co2eStoredTonnes: null,
      fDurable: null,
      organicCarbonPercent: carbon.value,
      effectiveSoilTemperatureC: null,
      temperatureFloored: false,
      durabilityCapped: false,
      moduleVersion: SOIL_STORAGE_MODULE_VERSION,
      missingInputs,
      warnings,
    };
  }

  const durability = computeFDurable1000({
    meanRandomReflectancePercent: input.meanRandomReflectancePercent,
    stdRandomReflectance: input.stdRandomReflectance,
    meanNonReactiveCarbonPercent: input.meanNonReactiveCarbonPercent,
    stdNonReactiveCarbonPercent: input.stdNonReactiveCarbonPercent,
  });

  const co2eStoredTonnes = computeCo2eStoredTonnes({
    organicCarbonPercent: carbon.value,
    dryMassTonnes: input.dryMassTonnes,
    fDurable: durability.fDurable,
  });

  return {
    co2eStoredTonnes,
    fDurable: durability.fDurable,
    organicCarbonPercent: carbon.value,
    effectiveSoilTemperatureC: null,
    temperatureFloored: false,
    durabilityCapped: durability.durabilityCapped,
    moduleVersion: SOIL_STORAGE_MODULE_VERSION,
    missingInputs,
    warnings,
  };
}
