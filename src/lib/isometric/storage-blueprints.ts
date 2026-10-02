/**
 * Storage components: the removal-template components that turn applied
 * biochar into stored CO2e (#638). Part of the semantic binding catalog
 * (semantic-binding-catalog.ts), which binds the inputs of every `bound`
 * blueprint below with strategy `measurement-sample`.
 *
 * ADR 0013: noma submits raw durability inputs; the registry computes the
 * durable fraction. ADR 0021: a facility declares one durability tier, and its
 * template must carry a storage component of that tier.
 */
import type { CreditBatchSampling } from "@/schemas/credit-batches";
import { IDENTITY, PERCENT_TO_FRACTION, RATIO_TO_PERCENT, type SourceTransform } from "./source-transforms";

export type DurabilityTier = "200_year" | "1000_year";

/**
 * How noma treats a storage component a template declares.
 *
 * - `bound`: the catalog binds its inputs; noma submits it.
 * - `gated`: recognised for its tier, but its inputs are not bound until the
 *   sandbox confirms their units, so submission fails closed.
 * - `deprecated`: readable on historical removals; new configuration and
 *   submission reject it.
 * - `unsupported`: noma never submits it.
 */
export type StorageComponentSupport = "bound" | "gated" | "deprecated" | "unsupported";

interface StorageBlueprintBase {
  tier: DurabilityTier;
  sampling: CreditBatchSampling;
}

/** Inputs come from the catalog's measurement-sample bindings. */
interface BoundStorageBlueprint extends StorageBlueprintBase {
  support: "bound";
}

interface UnboundStorageBlueprint extends StorageBlueprintBase {
  support: Exclude<StorageComponentSupport, "bound">;
  /**
   * The inputs the registry component declares, each with the transform its
   * noma source needs. Durability evidence ledgers target them.
   */
  inputs: Readonly<Record<string, SourceTransform | null>>;
}

export type StorageBlueprint = BoundStorageBlueprint | UnboundStorageBlueprint;

/** Sampled-batch sequestration blueprint (registry takes the mean of the list). */
export const SEQUESTRATION_BLUEPRINT_SAMPLED = "biochar_sequestration_200_year_c_org";

/** Unsampled-batch (Method B) blueprint (registry uses a Winsorized mean ± SE). */
export const SEQUESTRATION_BLUEPRINT_UNSAMPLED = "biochar_sequestration_200_year_unsampled";

/** Current sampled 1,000-year component with paired total/inorganic carbon lists. */
export const CURRENT_SEQUESTRATION_BLUEPRINT_1000_YEAR =
  "biochar_sequestration_1000_year_f_durable_max";

/** Historical three-input component. Read/reconciliation only; never select it for a new template. */
export const DEPRECATED_SEQUESTRATION_BLUEPRINT_1000_YEAR = "biochar_sequestration_1000_year";

/** Method-B 1,000-year component. Noma deliberately does not support this path. */
export const UNSAMPLED_SEQUESTRATION_BLUEPRINT_1000_YEAR =
  "biochar_sequestration_1000_year_unsampled";

/**
 * The pre-durability storage component (group `co2-stored`), fed by the
 * aggregation loop rather than measurement samples.
 */
export const LEGACY_SEQUESTRATION_BLUEPRINT_KEY = "carbon_rich_substance_sequestration";

// Order matters: durability evidence ledgers list a tier's inputs in this
// order, and the Source binding revision hashes that list.
export const STORAGE_BLUEPRINTS: Readonly<Record<string, StorageBlueprint>> = {
  [SEQUESTRATION_BLUEPRINT_SAMPLED]: {
    tier: "200_year",
    sampling: "sampled",
    support: "gated",
    inputs: {
      h_c_molar_ratios: RATIO_TO_PERCENT,
      total_carbon_contents: PERCENT_TO_FRACTION,
      inorganic_carbon_contents: PERCENT_TO_FRACTION,
      product_mass: IDENTITY,
    },
  },
  [SEQUESTRATION_BLUEPRINT_UNSAMPLED]: {
    tier: "200_year",
    sampling: "unsampled",
    support: "gated",
    // Mass-only body; the exact wire format is unconfirmed
    // (docs/open-questions-isometric.md).
    inputs: { product_mass: IDENTITY },
  },
  [CURRENT_SEQUESTRATION_BLUEPRINT_1000_YEAR]: {
    tier: "1000_year",
    sampling: "sampled",
    support: "bound",
  },
  [DEPRECATED_SEQUESTRATION_BLUEPRINT_1000_YEAR]: {
    tier: "1000_year",
    sampling: "sampled",
    support: "deprecated",
    inputs: { carbon_contents: null, product_mass: null, s_fraction: null },
  },
  [UNSAMPLED_SEQUESTRATION_BLUEPRINT_1000_YEAR]: {
    tier: "1000_year",
    sampling: "unsampled",
    support: "unsupported",
    inputs: {},
  },
};

function storageBlueprint(blueprintKey: string): StorageBlueprint | undefined {
  return Object.prototype.hasOwnProperty.call(STORAGE_BLUEPRINTS, blueprintKey)
    ? STORAGE_BLUEPRINTS[blueprintKey]
    : undefined;
}

function storageBlueprintKeys(
  predicate: (blueprint: StorageBlueprint) => boolean,
): string[] {
  return Object.entries(STORAGE_BLUEPRINTS)
    .filter(([, blueprint]) => predicate(blueprint))
    .map(([key]) => key);
}

/**
 * The transform a gated or deprecated blueprint's input needs. Bound
 * blueprints carry theirs on the catalog binding.
 */
export function unboundStorageInputTransform(
  blueprintKey: string,
  inputKey: string,
): SourceTransform {
  const blueprint = storageBlueprint(blueprintKey);
  const transform =
    blueprint && blueprint.support !== "bound" && Object.hasOwn(blueprint.inputs, inputKey)
      ? blueprint.inputs[inputKey]
      : null;
  if (!transform) {
    throw new Error(`Storage input ${blueprintKey}/${inputKey} declares no transform`);
  }
  return transform;
}

export type Sequestration1000YearComponentClassification =
  | "current"
  | "deprecated"
  | "unsupported-unsampled"
  | null;

const CLASSIFICATION_1000_YEAR = {
  bound: "current",
  gated: null,
  deprecated: "deprecated",
  unsupported: "unsupported-unsampled",
} as const satisfies Record<StorageComponentSupport, Sequestration1000YearComponentClassification>;

export function classifySequestration1000YearComponent(
  blueprintKey: string,
): Sequestration1000YearComponentClassification {
  const blueprint = storageBlueprint(blueprintKey);
  return blueprint?.tier === "1000_year" ? CLASSIFICATION_1000_YEAR[blueprint.support] : null;
}

/**
 * Every sequestration blueprint key we recognise (200-year sampled + Method-B
 * unsampled, and 1000-year). These components are NOT fed by the legacy
 * aggregation→datapoint loop — `resolveTemplateInputs` and
 * `buildCreateGhgEntryRequest` skip them (see `isSequestrationBlueprintFamily`),
 * and the measurement-samples step carries their inputs instead. `submitRemoval`
 * uses this set to detect a durability template and apply the environment/path
 * availability gate.
 */
export const SEQUESTRATION_BLUEPRINT_KEYS: ReadonlySet<string> = new Set(
  storageBlueprintKeys((blueprint) => blueprint.support !== "unsupported"),
);

export function isSequestrationBlueprintKey(blueprintKey: string): boolean {
  return SEQUESTRATION_BLUEPRINT_KEYS.has(blueprintKey);
}

/**
 * Prefix predicate recognising ANY biochar sequestration blueprint — including a
 * future/unknown variant we don't yet carry inputs for. `resolveTemplateInputs`
 * skips every sequestration component with this (not the datapoint loop, which
 * would throw a misleading missing-INPUT_MAPPING error); the submit-time
 * template↔tier guard then fails closed on any component NOT in the facility
 * tier's expected set (`expectedSequestrationBlueprintKeys`).
 */
export function isSequestrationBlueprintFamily(blueprintKey: string): boolean {
  return blueprintKey.startsWith("biochar_sequestration_");
}

/** Any storage component: the legacy one or a sequestration blueprint. */
export function isStorageBlueprintKey(blueprintKey: string): boolean {
  return (
    blueprintKey === LEGACY_SEQUESTRATION_BLUEPRINT_KEY ||
    isSequestrationBlueprintFamily(blueprintKey)
  );
}

/**
 * A facility's durability tier → the sequestration blueprint key(s) its Isometric
 * removal template must carry (ADR 0021). 200-year has two (lab-sampled +
 * Method-B unsampled); 1000-year has one. The submit-time guard rejects a
 * template whose sequestration component is outside this set for the facility
 * tier, with an actionable "re-author the template / change the tier" message.
 */
export function expectedSequestrationBlueprintKeys(tier: DurabilityTier): ReadonlySet<string> {
  return new Set(
    storageBlueprintKeys(
      (blueprint) =>
        blueprint.tier === tier &&
        (blueprint.support === "bound" || blueprint.support === "gated"),
    ),
  );
}

/**
 * Select the sequestration blueprint for a batch: a lab-sampled batch submits to
 * the `_c_org` blueprint; an unsampled batch (only valid under Method B, where
 * the registry derives its carbon + durable fraction from historically sampled
 * batches) submits to `_unsampled` (D6).
 */
export function selectSequestrationBlueprintKey(args: {
  sampling: CreditBatchSampling;
}): string {
  const [key] = storageBlueprintKeys(
    (blueprint) =>
      blueprint.tier === "200_year" &&
      blueprint.sampling === args.sampling &&
      blueprint.support === "gated",
  );
  if (!key) throw new Error(`No 200-year storage blueprint for ${args.sampling} batches`);
  return key;
}
