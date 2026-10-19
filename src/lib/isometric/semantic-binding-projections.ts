/**
 * Projections of the semantic binding catalog (semantic-binding-catalog.ts):
 * the tables the transformers, readiness, the certify field registry and the
 * Source binding plan resolve against. Edit the catalog, never a projection.
 */
import type { TransportCategory } from "@/lib/certification/readiness";
import type { components } from "./generated/certify";
import type { SourceTransform } from "./source-transforms";
import {
  isStorageBlueprintKey,
  STORAGE_BLUEPRINTS,
  type DurabilityTier,
} from "./storage-blueprints";
import {
  normalizeComponentDisplayName,
  ownValue,
  SEMANTIC_BINDING_CATALOG,
  TRANSPORT_CATEGORIES,
  TRANSPORT_SOURCE_FACTS,
  type AggregatedDatapointRole,
  type ComponentDisambiguationRule,
  type CreditBatchMassDirectDatapointFeed,
  type EvidenceTarget,
  type MeasurementPropertyFeed,
  type MeasurementSampleRole,
  type SemanticBindingCatalog,
  type SequestrationSourceContract,
  type SourceFactKey,
} from "./semantic-binding-catalog";
import type {
  AggregatedProductionData,
  EmissionInputBucket,
} from "./utils/aggregation";

type DatapointType = components["schemas"]["DatapointType"];
type QuantityKindType = components["schemas"]["QuantityKindType"];

function transportCategoryForSource(source: string): TransportCategory | undefined {
  return TRANSPORT_CATEGORIES.find(
    (category) => TRANSPORT_SOURCE_FACTS[category] === source,
  );
}

export interface InputMappingEntry {
  source: keyof AggregatedProductionData;
  unit: string;
  datapointType: DatapointType;
  expectedQuantityKind: QuantityKindType;
  bucket: EmissionInputBucket;
  transform?: (value: number) => number;
  transformRevision?: string;
  sourceByComponent?: Readonly<Record<string, keyof AggregatedProductionData>>;
}

// (group_key, blueprint_key, input_key) → entry. Group keys are stable
// kebab-case slugs from the template's RemovalTemplateComponentGroup.key.
export type InputMappingTable = Record<
  string,
  Record<string, Record<string, InputMappingEntry>>
>;

export type PeriodInputTupleTable = Record<
  string,
  Record<string, Record<string, { category: string }>>
>;

export type TransportCategoryTable = Record<
  string,
  Record<string, Record<string, TransportCategory>>
>;

/** One removal-template input, addressed by its stable keys. */
export interface BindingInputTuple {
  groupKey: string;
  blueprintKey: string;
  inputKey: string;
}

export type InputTuplesBySource = Partial<
  Record<SourceFactKey, readonly BindingInputTuple[]>
>;

/** Own-property lookup in a (group, blueprint, input) table. */
export function lookupBindingTriple<T>(
  table: Readonly<Record<string, Readonly<Record<string, Readonly<Record<string, T>>>>>>,
  groupKey: string,
  blueprintKey: string,
  inputKey: string,
): T | undefined {
  const blueprints = ownValue(table, groupKey);
  const inputs = blueprints ? ownValue(blueprints, blueprintKey) : undefined;
  return inputs ? ownValue(inputs, inputKey) : undefined;
}

function setTriple<T>(
  table: Record<string, Record<string, Record<string, T>>>,
  groupKey: string,
  blueprintKey: string,
  inputKey: string,
  value: T,
): void {
  const blueprints = (table[groupKey] ??= {});
  const inputs = (blueprints[blueprintKey] ??= {});
  inputs[inputKey] = value;
}

// Lookup keys are normalized display names; the error a lookup miss raises
// lists them, so they stay in this form.
function normalizedComponentSources(
  rule: ComponentDisambiguationRule,
): Readonly<Record<string, SourceFactKey>> {
  return Object.fromEntries(
    Object.entries(rule.sources).map(([name, source]) => [
      normalizeComponentDisplayName(name),
      source,
    ]),
  );
}

/** Every aggregated-datapoint role as an INPUT_MAPPING entry. */
export function projectInputMapping(
  catalog: SemanticBindingCatalog = SEMANTIC_BINDING_CATALOG,
): InputMappingTable {
  const table: InputMappingTable = {};
  for (const [blueprintKey, inputs] of Object.entries(catalog)) {
    for (const [inputKey, binding] of Object.entries(inputs)) {
      for (const [groupKey, role] of Object.entries(binding.roles)) {
        if (role.strategy !== "aggregated-datapoint") continue;
        const { datapoint } = binding;
        if (!datapoint) {
          throw new Error(
            `Semantic binding ${blueprintKey}/${inputKey} has a datapoint role in "${groupKey}" without a datapoint contract`,
          );
        }
        const entry: InputMappingEntry = {
          source: role.source,
          unit: datapoint.unit,
          datapointType: datapoint.datapointType,
          expectedQuantityKind: datapoint.expectedQuantityKind,
          bucket: role.bucket,
        };
        if (datapoint.transform) {
          entry.transform = datapoint.transform.apply;
          entry.transformRevision = datapoint.transform.revision;
        }
        if (role.disambiguation) {
          entry.sourceByComponent = normalizedComponentSources(role.disambiguation);
        }
        setTriple(table, groupKey, blueprintKey, inputKey, entry);
      }
    }
  }
  return table;
}

/**
 * Every PROJECT-scope tuple: forbidden roles, plus aggregated roles whose
 * unnamed components stay PROJECT-scope.
 */
export function projectPeriodInputTuples(
  catalog: SemanticBindingCatalog = SEMANTIC_BINDING_CATALOG,
): PeriodInputTupleTable {
  const table: PeriodInputTupleTable = {};
  for (const [blueprintKey, inputs] of Object.entries(catalog)) {
    for (const [inputKey, binding] of Object.entries(inputs)) {
      for (const [groupKey, role] of Object.entries(binding.roles)) {
        if (
          role.strategy === "aggregated-datapoint" &&
          role.projectScopeCategory &&
          !role.disambiguation
        ) {
          throw new Error(
            `Semantic binding ${blueprintKey}/${inputKey} in "${groupKey}" is project-scope with no named component carve-out`,
          );
        }
        const category =
          role.strategy === "project-scope-forbidden"
            ? role.category
            : role.strategy === "aggregated-datapoint"
              ? role.projectScopeCategory
              : undefined;
        if (category) setTriple(table, groupKey, blueprintKey, inputKey, { category });
      }
    }
  }
  return table;
}

/**
 * Every transport-category tuple: the aggregated roles whose source is a
 * transport category's mass-distance fact.
 */
export function projectTransportCategories(
  catalog: SemanticBindingCatalog = SEMANTIC_BINDING_CATALOG,
): TransportCategoryTable {
  const table: TransportCategoryTable = {};
  for (const [blueprintKey, inputs] of Object.entries(catalog)) {
    for (const [inputKey, binding] of Object.entries(inputs)) {
      for (const [groupKey, role] of Object.entries(binding.roles)) {
        if (role.strategy !== "aggregated-datapoint") continue;
        const category = transportCategoryForSource(role.source);
        if (category) setTriple(table, groupKey, blueprintKey, inputKey, category);
      }
    }
  }
  return table;
}

/**
 * The removal-template inputs each source fact feeds, including the inputs
 * where it is a per-component source.
 */
export function projectInputTuplesBySource(
  catalog: SemanticBindingCatalog = SEMANTIC_BINDING_CATALOG,
): InputTuplesBySource {
  const table: Partial<Record<SourceFactKey, BindingInputTuple[]>> = {};
  for (const [blueprintKey, inputs] of Object.entries(catalog)) {
    for (const [inputKey, binding] of Object.entries(inputs)) {
      for (const [groupKey, role] of Object.entries(binding.roles)) {
        if (role.strategy !== "aggregated-datapoint") continue;
        const sources = new Set<SourceFactKey>([
          role.source,
          ...Object.values(role.disambiguation?.sources ?? {}),
        ]);
        for (const source of sources) {
          (table[source] ??= []).push({ groupKey, blueprintKey, inputKey });
        }
      }
    }
  }
  return table;
}

/** A storage input's measurement-sample binding, as submission resolves it. */
export type SequestrationInputBinding = (
  | MeasurementPropertyFeed
  | CreditBatchMassDirectDatapointFeed
) & {
  sourceContract: Omit<SequestrationSourceContract, "transform"> & {
    transformRevision: string;
  };
};

export type SequestrationBindingTable = Readonly<
  Record<string, { readonly inputs: Readonly<Record<string, SequestrationInputBinding>> }>
>;

const STORAGE_GROUP_KEY = "co2-stored";

function sequestrationInputBinding(role: MeasurementSampleRole): SequestrationInputBinding {
  const { nomaSource, transform, wireUnit, confirmation } = role.sourceContract;
  const sourceContract = { nomaSource, transformRevision: transform.revision, wireUnit, confirmation };
  return role.source === "measurement-property"
    ? {
        dataShape: role.dataShape,
        source: role.source,
        measurementProperty: role.measurementProperty,
        sourceContract,
      }
    : {
        dataShape: role.dataShape,
        source: role.source,
        valueSource: role.valueSource,
        quantityKind: role.quantityKind,
        unit: role.unit,
        datapointType: role.datapointType,
        sourceContract,
      };
}

/** The transform a measurement-sample binding applies to its noma value. */
export function lookupMeasurementSampleTransform(
  blueprintKey: string,
  inputKey: string,
  catalog: SemanticBindingCatalog = SEMANTIC_BINDING_CATALOG,
): SourceTransform | undefined {
  const inputs = ownValue(catalog, blueprintKey);
  const binding = inputs ? ownValue(inputs, inputKey) : undefined;
  const role = binding ? ownValue(binding.roles, STORAGE_GROUP_KEY) : undefined;
  return role?.strategy === "measurement-sample" ? role.sourceContract.transform : undefined;
}

/**
 * Every measurement-sample role, by storage blueprint. Submission resolves a
 * storage input by `(blueprint_key, input_key)` alone, so each binding has
 * exactly one role, in the storage group, on a `bound` storage blueprint.
 */
export function projectSequestrationInputBindings(
  catalog: SemanticBindingCatalog = SEMANTIC_BINDING_CATALOG,
): SequestrationBindingTable {
  const table: Record<string, { inputs: Record<string, SequestrationInputBinding> }> = {};
  for (const [blueprintKey, inputs] of Object.entries(catalog)) {
    for (const [inputKey, binding] of Object.entries(inputs)) {
      const roles = Object.entries(binding.roles);
      const sampled = roles.filter(([, role]) => role.strategy === "measurement-sample");
      if (sampled.length === 0) continue;
      const [[groupKey, role]] = sampled;
      if (
        roles.length !== 1 ||
        groupKey !== STORAGE_GROUP_KEY ||
        ownValue(STORAGE_BLUEPRINTS, blueprintKey)?.support !== "bound"
      ) {
        throw new Error(
          `Measurement-sample binding ${blueprintKey}/${inputKey} must be the only role, in "${STORAGE_GROUP_KEY}", on a bound storage blueprint`,
        );
      }
      if (role.strategy !== "measurement-sample") continue;
      (table[blueprintKey] ??= { inputs: {} }).inputs[inputKey] = sequestrationInputBinding(role);
    }
  }
  return table;
}

/** Where a Source attaches: any storage component, or one exact component. */
export type EvidenceIntendedTarget =
  | {
      kind: "sequestration";
      groupKey: string;
      inputKey: string;
      /** Generated ledgers can target template-dependent durability inputs. */
      optionalInTemplate?: boolean;
    }
  | {
      kind: "ordinary";
      groupKey: string;
      componentBlueprintKey: string;
      /** Exact component name discriminator after trimming and lowercasing. */
      componentDisplayName?: string;
      inputKey: string;
      /** The facility template can omit a transport category with no component. */
      optionalInTemplate?: boolean;
    };

export type EvidenceTargetTable = Partial<
  Record<EvidenceTarget["role"], readonly EvidenceIntendedTarget[]>
>;

function evidenceIntendedTarget(
  blueprintKey: string,
  inputKey: string,
  groupKey: string,
  role: AggregatedDatapointRole | MeasurementSampleRole,
  target: EvidenceTarget,
): EvidenceIntendedTarget {
  const optional = target.optional ? { optionalInTemplate: true } : {};
  if (target.component !== undefined) {
    const named =
      role.strategy === "aggregated-datapoint" &&
      role.disambiguation !== undefined &&
      ownValue(role.disambiguation.sources, target.component) !== undefined;
    if (!named) {
      throw new Error(
        `Evidence target ${blueprintKey}/${inputKey} in "${groupKey}" names component "${target.component}" its role does not disambiguate`,
      );
    }
  }
  // A storage input is one per template whichever storage blueprint serves
  // it, so its Sources target the input on any storage component.
  if (isStorageBlueprintKey(blueprintKey)) {
    return { kind: "sequestration", groupKey, inputKey, ...optional };
  }
  return {
    kind: "ordinary",
    groupKey,
    componentBlueprintKey: blueprintKey,
    ...(target.component !== undefined ? { componentDisplayName: target.component } : {}),
    inputKey,
    ...optional,
  };
}

/**
 * The inputs each noma evidence role's Sources support, in catalog order.
 * Storage targets repeat across storage blueprints and collapse to one.
 */
export function projectEvidenceTargets(
  catalog: SemanticBindingCatalog = SEMANTIC_BINDING_CATALOG,
): EvidenceTargetTable {
  const table: Partial<Record<EvidenceTarget["role"], EvidenceIntendedTarget[]>> = {};
  const seen = new Set<string>();
  for (const [blueprintKey, inputs] of Object.entries(catalog)) {
    for (const [inputKey, binding] of Object.entries(inputs)) {
      for (const [groupKey, role] of Object.entries(binding.roles)) {
        if (role.strategy === "project-scope-forbidden") continue;
        for (const target of role.evidence ?? []) {
          const intended = evidenceIntendedTarget(blueprintKey, inputKey, groupKey, role, target);
          const key = JSON.stringify([target.role, intended]);
          if (seen.has(key)) continue;
          seen.add(key);
          (table[target.role] ??= []).push(intended);
        }
      }
    }
  }
  return table;
}

/**
 * The inputs a tier's durability evidence ledger supports: every input of the
 * tier's storage components that noma recognises, in storage-blueprint order.
 */
export function projectDurabilityLedgerInputKeys(
  catalog: SemanticBindingCatalog = SEMANTIC_BINDING_CATALOG,
): Readonly<Record<DurabilityTier, readonly string[]>> {
  const table: Record<DurabilityTier, string[]> = { "1000_year": [], "200_year": [] };
  for (const [blueprintKey, blueprint] of Object.entries(STORAGE_BLUEPRINTS)) {
    if (blueprint.support === "unsupported") continue;
    const inputKeys =
      blueprint.support === "bound"
        ? Object.keys(ownValue(catalog, blueprintKey) ?? {})
        : Object.keys(blueprint.inputs);
    const keys = table[blueprint.tier];
    for (const inputKey of inputKeys) {
      if (!keys.includes(inputKey)) keys.push(inputKey);
    }
  }
  return table;
}
