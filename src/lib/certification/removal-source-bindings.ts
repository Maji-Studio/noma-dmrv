import { payloadHash } from "@/lib/isometric/utils/payload-hash";
import type { IsometricGhgEntryTemplate } from "@/lib/isometric";
import { SafeError } from "@/lib/errors";
import { isSequestrationBlueprintFamily } from "@/lib/isometric/transformers/measurement-sample";
import { normalizeComponentDisplayName } from "@/lib/isometric/transformers/datapoint";
import {
  APPLICATION_BOUNDARY_LOGBOOK_UNCONDITIONAL_DOCUMENT_TYPES,
  isApplicationBoundaryLogbookEvidenceType,
} from "@/lib/certification/application-evidence";
import { TRANSPORT_EVIDENCE_LEDGER_KIND } from "./evidence-ledger/types";
import { DURABILITY_EVIDENCE_LEDGER_KIND } from "./evidence-ledger/durability-types";

export type NomaEvidenceRole =
  | "inventory"
  | "feedstock_bill_of_lading"
  | "delivery_bill_of_lading"
  | "transport_evidence_ledger"
  | "durability_evidence_ledger"
  | "lab_report";

export interface RemovalSourceLineage {
  entityType: string;
  entityId: string;
  entityLabel: string;
}

export type RemovalSourceIntendedTarget =
  | {
      kind: "sequestration";
      groupKey: "co2-stored";
      inputKey:
        | "product_mass"
        | "carbon_contents"
        | "s_fraction"
        | "h_c_molar_ratios"
        | "total_carbon_contents"
        | "inorganic_carbon_contents";
      /** Generated ledgers can target template-dependent durability inputs. */
      optionalInTemplate?: boolean;
    }
  | {
      kind: "ordinary";
      groupKey:
        | "biomass-feedstock-transport"
        | "biochar-transport"
        | "sampling-required-for-mrv"
        | "miscellaneous";
      componentBlueprintKey:
        | "mass_distance_based_ci_emissions"
        | "mass_based_ci_emissions";
      /** Exact component name discriminator after trimming and lowercasing. */
      componentDisplayName?: string;
      inputKey: "mass_distance" | "mass";
      /** The facility template can omit a transport category with no component. */
      optionalInTemplate?: boolean;
    };

export interface ClassifiedRemovalSource {
  nomaRole: NomaEvidenceRole;
  nomaRoleLabel: string;
  lineage: RemovalSourceLineage;
  intendedTarget: RemovalSourceIntendedTarget;
  /** One generated PDF can evidence several exact registry inputs. */
  additionalIntendedTargets?: RemovalSourceIntendedTarget[];
  mappingRevision: string;
}

interface CandidateDocumentFacts {
  documentType: string;
  metadata: unknown;
  lineage: RemovalSourceLineage;
  removalId?: string;
}

interface SourceBindingRule {
  nomaRole: NomaEvidenceRole;
  nomaRoleLabel: string;
  intendedTarget: RemovalSourceIntendedTarget;
  additionalIntendedTargets?: RemovalSourceIntendedTarget[];
}

export interface RemovalEvidenceTargetLookup {
  groupKey: string;
  componentBlueprintKey: string;
  componentDisplayName?: string;
  inputKey: string;
}

export interface OptionalRemovalEvidenceTarget
  extends RemovalEvidenceTargetLookup {
  nomaRoleLabel: string;
}

const SOURCE_BINDING_RULES = {
  labReport: {
    nomaRole: "lab_report",
    nomaRoleLabel: "Sample lab report",
    intendedTarget: {
      kind: "sequestration",
      groupKey: "co2-stored",
      inputKey: "total_carbon_contents",
      optionalInTemplate: true,
    },
    additionalIntendedTargets: [
      {
        kind: "sequestration",
        groupKey: "co2-stored",
        inputKey: "inorganic_carbon_contents",
        optionalInTemplate: true,
      },
    ],
  },
  inventory: {
    nomaRole: "inventory",
    nomaRoleLabel: "Inventory",
    intendedTarget: {
      kind: "sequestration",
      groupKey: "co2-stored",
      inputKey: "product_mass",
    },
    additionalIntendedTargets: [
      {
        // The safety-margin deduction multiplies the SAME biochar mass the
        // sequestration claim uses, so the same mass evidence justifies it.
        // Optional: the two legacy templates declare an empty `miscellaneous`
        // group.
        kind: "ordinary",
        groupKey: "miscellaneous",
        componentBlueprintKey: "mass_based_ci_emissions",
        componentDisplayName: "Safety margin",
        inputKey: "mass",
        optionalInTemplate: true,
      },
    ],
  },
  feedstockBillOfLading: {
    nomaRole: "feedstock_bill_of_lading",
    nomaRoleLabel: "Feedstock bill of lading",
    intendedTarget: {
      kind: "ordinary",
      groupKey: "biomass-feedstock-transport",
      componentBlueprintKey: "mass_distance_based_ci_emissions",
      inputKey: "mass_distance",
    },
  },
  deliveryBillOfLading: {
    nomaRole: "delivery_bill_of_lading",
    nomaRoleLabel: "Delivery bill of lading",
    intendedTarget: {
      kind: "ordinary",
      groupKey: "biochar-transport",
      componentBlueprintKey: "mass_distance_based_ci_emissions",
      inputKey: "mass_distance",
    },
  },
  transportEvidenceLedger: {
    nomaRole: "transport_evidence_ledger",
    nomaRoleLabel: "Transport evidence ledger",
    intendedTarget: {
      kind: "ordinary",
      groupKey: "biomass-feedstock-transport",
      componentBlueprintKey: "mass_distance_based_ci_emissions",
      inputKey: "mass_distance",
      optionalInTemplate: true,
    },
    additionalIntendedTargets: [
      {
        kind: "ordinary",
        groupKey: "biochar-transport",
        componentBlueprintKey: "mass_distance_based_ci_emissions",
        inputKey: "mass_distance",
        optionalInTemplate: true,
      },
      {
        kind: "ordinary",
        groupKey: "sampling-required-for-mrv",
        componentBlueprintKey: "mass_distance_based_ci_emissions",
        inputKey: "mass_distance",
        optionalInTemplate: true,
      },
    ],
  },
} as const satisfies Record<string, SourceBindingRule>;

const DURABILITY_LEDGER_TARGETS = {
  "1000_year": [
    "total_carbon_contents",
    "inorganic_carbon_contents",
    "product_mass",
    "s_fraction",
    // Historical deprecated removals used this total-carbon input. It remains
    // optional so old remote records stay classifiable without making the
    // deprecated component eligible for a newly configured template.
    "carbon_contents",
  ],
  "200_year": [
    "h_c_molar_ratios",
    "total_carbon_contents",
    "inorganic_carbon_contents",
    "product_mass",
  ],
} as const;

// Bump whenever the immutable plan is materialized differently on registry
// Datapoints. This makes the semantic submission hash supersede an already
// submitted Removal whose target list is unchanged but whose wire attachment
// behavior was corrected.
const SOURCE_BINDING_MATERIALIZATION_REVISION = 5;

export const SOURCE_BINDING_MAPPING_REVISION = payloadHash({
  rules: SOURCE_BINDING_RULES,
  durabilityLedgerTargets: DURABILITY_LEDGER_TARGETS,
  materializationRevision: SOURCE_BINDING_MATERIALIZATION_REVISION,
});

function durabilityLedgerBinding(
  lineage: RemovalSourceLineage,
  durabilityOption: unknown,
): ClassifiedRemovalSource | null {
  if (durabilityOption !== "1000_year" && durabilityOption !== "200_year") {
    return null;
  }
  const targets = DURABILITY_LEDGER_TARGETS[durabilityOption].map(
    (inputKey): RemovalSourceIntendedTarget => ({
      kind: "sequestration",
      groupKey: "co2-stored",
      inputKey,
      optionalInTemplate: true,
    }),
  );
  const [intendedTarget, ...additionalIntendedTargets] = targets;
  if (!intendedTarget) return null;
  return {
    nomaRole: "durability_evidence_ledger",
    nomaRoleLabel: "Durability evidence ledger",
    lineage,
    intendedTarget,
    additionalIntendedTargets,
    mappingRevision: SOURCE_BINDING_MAPPING_REVISION,
  };
}

function metadataRecord(value: unknown): Record<string, unknown> {
  return value !== null && !Array.isArray(value) && typeof value === "object"
    ? (value as Record<string, unknown>)
    : {};
}

/**
 * Classifies the three operator evidence mappings plus noma's generated
 * transport and durability ledgers. The operational document type remains a
 * separate fact. Every application-boundary logbook evidence subtype maps to
 * the Inventory Noma role because that role identifies the registry
 * product-mass target, not the operator's evidence subtype.
 */
export function classifyRemovalSourceCandidate(
  facts: CandidateDocumentFacts,
): ClassifiedRemovalSource | null {
  const { lineage } = facts;
  // A GIS boundary supports the Application's storage-area evidence. The
  // Removal Datapoint bindings are separate from Biochar Application
  // `source_ids`, so classifying this file here would falsely attach it to
  // product mass. The application-source pipeline handles it instead.
  //
  // This is a FORWARD guard: it preserves today's behaviour rather than
  // changing it, because `src/schemas/documents.ts` currently refuses the
  // metadata that would let a `gis_boundary` reach the logbook branch below.
  // It exists so the exclusion survives if that schema later widens.
  if (
    lineage.entityType === "application" &&
    facts.documentType === "gis_boundary"
  ) {
    return null;
  }

  let rule: SourceBindingRule | null = null;
  const metadata = metadataRecord(facts.metadata);
  const logbookEvidenceType = metadata.logbookEvidenceType;
  const isCurrentRemovalLedger =
    lineage.entityType === "credit_batch" &&
    facts.documentType === "pdf" &&
    typeof facts.removalId === "string" &&
    metadata.removalId === facts.removalId;
  const isApplicationBoundaryLogbook =
    lineage.entityType === "application" &&
    (isApplicationBoundaryLogbookEvidenceType(logbookEvidenceType) ||
      APPLICATION_BOUNDARY_LOGBOOK_UNCONDITIONAL_DOCUMENT_TYPES.some(
        (documentType) => documentType === facts.documentType,
      ));

  if (isApplicationBoundaryLogbook) {
    rule = SOURCE_BINDING_RULES.inventory;
  } else if (
    lineage.entityType === "sample" &&
    facts.documentType === "lab_report"
  ) {
    rule = SOURCE_BINDING_RULES.labReport;
  } else if (
    lineage.entityType === "feedstock" &&
    facts.documentType === "bill_of_lading"
  ) {
    rule = SOURCE_BINDING_RULES.feedstockBillOfLading;
  } else if (
    lineage.entityType === "delivery" &&
    facts.documentType === "bill_of_lading"
  ) {
    rule = SOURCE_BINDING_RULES.deliveryBillOfLading;
  } else if (
    isCurrentRemovalLedger &&
    metadata.kind === TRANSPORT_EVIDENCE_LEDGER_KIND
  ) {
    rule = SOURCE_BINDING_RULES.transportEvidenceLedger;
  } else if (
    isCurrentRemovalLedger &&
    metadata.kind === DURABILITY_EVIDENCE_LEDGER_KIND
  ) {
    return durabilityLedgerBinding(lineage, metadata.durabilityOption);
  }

  return rule
    ? {
        ...rule,
        lineage,
        mappingRevision: SOURCE_BINDING_MAPPING_REVISION,
      }
    : null;
}

export function buildRemovalSourceDescription(
  binding: ClassifiedRemovalSource,
): string {
  return `Noma role: ${binding.nomaRoleLabel}. Lineage: ${binding.lineage.entityLabel}.`;
}

export interface SourceBindingCandidate {
  documentId: string;
  sourceId: string;
  binding: ClassifiedRemovalSource;
}

export interface RemovalSourceBindingPlanEntry {
  documentId: string;
  sourceId: string;
  nomaRole: NomaEvidenceRole;
  lineage: RemovalSourceLineage;
  intendedTarget: {
    kind: RemovalSourceIntendedTarget["kind"];
    groupKey: string;
    componentId: string;
    componentBlueprintKey: string;
    inputKey: string;
    /** Credit batches whose measurement-sample datapoints this Source targets. */
    creditBatchIds: string[];
  };
  mappingRevision: string;
}

const LEGACY_SEQUESTRATION_BLUEPRINT_KEY =
  "carbon_rich_substance_sequestration";

function matchesIntendedComponent(
  blueprintKey: string,
  componentDisplayName: string | undefined,
  target: RemovalSourceIntendedTarget,
): boolean {
  return target.kind === "sequestration"
    ? blueprintKey === LEGACY_SEQUESTRATION_BLUEPRINT_KEY ||
        isSequestrationBlueprintFamily(blueprintKey)
    : blueprintKey === target.componentBlueprintKey &&
        (target.componentDisplayName === undefined ||
          normalizeComponentDisplayName(componentDisplayName) ===
            normalizeComponentDisplayName(target.componentDisplayName));
}

/**
 * Read-only description of the evidence roles that can land on one template
 * input. The submission planner and the template diagnostic both walk the
 * same SOURCE_BINDING_RULES table through this function, so adding a new
 * evidence binding cannot leave the diagnostic with a second shadow map.
 */
export function removalEvidenceRoleLabelsForTarget(
  target: RemovalEvidenceTargetLookup,
): string[] {
  const labels = new Set<string>();
  const rules: readonly SourceBindingRule[] = Object.values(
    SOURCE_BINDING_RULES,
  );
  for (const rule of rules) {
    const intendedTargets = [
      rule.intendedTarget,
      ...(rule.additionalIntendedTargets ?? []),
    ];
    if (
      intendedTargets.some(
        (intendedTarget) =>
          intendedTarget.groupKey === target.groupKey &&
          intendedTarget.inputKey === target.inputKey &&
          matchesIntendedComponent(
            target.componentBlueprintKey,
            target.componentDisplayName,
            intendedTarget,
          ),
      )
    ) {
      labels.add(rule.nomaRoleLabel);
    }
  }

  if (
    target.groupKey === "co2-stored" &&
    isSequestrationBlueprintFamily(target.componentBlueprintKey) &&
    Object.values(DURABILITY_LEDGER_TARGETS).some((inputKeys) =>
      (inputKeys as readonly string[]).includes(target.inputKey),
    )
  ) {
    labels.add("Durability evidence ledger");
  }

  return [...labels].sort();
}

/** Optional evidence targets declared by the production binding plan. */
export function listOptionalRemovalEvidenceTargets(): OptionalRemovalEvidenceTarget[] {
  const targets = new Map<
    string,
    OptionalRemovalEvidenceTarget & { requiredElsewhere: boolean }
  >();
  const rules: readonly SourceBindingRule[] = Object.values(
    SOURCE_BINDING_RULES,
  );
  for (const rule of rules) {
    for (const target of [
      rule.intendedTarget,
      ...(rule.additionalIntendedTargets ?? []),
    ]) {
      if (target.kind !== "ordinary") continue;
      const key = [
        target.groupKey,
        target.componentBlueprintKey,
        normalizeComponentDisplayName(target.componentDisplayName),
        target.inputKey,
      ].join("::");
      const existing = targets.get(key);
      targets.set(key, {
        groupKey: target.groupKey,
        componentBlueprintKey: target.componentBlueprintKey,
        componentDisplayName: target.componentDisplayName,
        inputKey: target.inputKey,
        nomaRoleLabel: existing
          ? `${existing.nomaRoleLabel}, ${rule.nomaRoleLabel}`
          : rule.nomaRoleLabel,
        requiredElsewhere:
          existing?.requiredElsewhere === true || !target.optionalInTemplate,
      });
    }
  }
  return [...targets.values()]
    .filter((target) => !target.requiredElsewhere)
    .map((target) => ({
      groupKey: target.groupKey,
      componentBlueprintKey: target.componentBlueprintKey,
      componentDisplayName: target.componentDisplayName,
      inputKey: target.inputKey,
      nomaRoleLabel: target.nomaRoleLabel,
    }));
}

/**
 * Resolves semantic targets onto the exact template component IDs that will
 * consume their Datapoints. Ambiguous or missing targets fail closed.
 */
export function buildRemovalSourceBindingPlan(args: {
  candidates: SourceBindingCandidate[];
  template: IsometricGhgEntryTemplate;
  applicationIdsByCreditBatchId: Map<string, string[]>;
  sampleIdsByCreditBatchId?: Map<string, string[]>;
  /** Delivery transport evidence uses this map to resolve its batch scope. */
  deliveryIdsByCreditBatchId?: Map<string, string[]>;
}): RemovalSourceBindingPlanEntry[] {
  return args.candidates
    .flatMap(({ documentId, sourceId, binding }) => {
      const targets = [
        binding.intendedTarget,
        ...(binding.additionalIntendedTargets ?? []),
      ];
      return targets.flatMap((target) => {
        const matchingComponents = args.template.groups
          .filter((group) => group.key === target.groupKey)
          .flatMap((group) => group.components)
          .filter(
            (component) =>
              matchesIntendedComponent(
                component.blueprint_key,
                component.display_name,
                target,
              ) &&
              component.inputs.some(
                (input) => input.input_key === target.inputKey,
              ),
          );
        if (matchingComponents.length === 0 && target.optionalInTemplate) {
          return [];
        }
        if (matchingComponents.length !== 1) {
          throw new SafeError(
            `Noma evidence role "${binding.nomaRole}" resolved ${matchingComponents.length} template targets for ` +
              `"${target.groupKey}/${target.inputKey}"; expected exactly one.`,
          );
        }
        const component = matchingComponents[0];
        const creditBatchIds =
          target.kind === "sequestration"
            ? binding.lineage.entityType === "credit_batch"
              ? [binding.lineage.entityId]
              : binding.lineage.entityType === "sample"
                ? Array.from(args.sampleIdsByCreditBatchId?.entries() ?? [])
                    .filter(([, sampleIds]) =>
                      sampleIds.includes(binding.lineage.entityId),
                    )
                    .map(([creditBatchId]) => creditBatchId)
                    .sort()
              : binding.lineage.entityType === "delivery"
                ? Array.from(args.deliveryIdsByCreditBatchId?.entries() ?? [])
                    .filter(([, deliveryIds]) =>
                      deliveryIds.includes(binding.lineage.entityId),
                    )
                    .map(([creditBatchId]) => creditBatchId)
                    .sort()
              : Array.from(args.applicationIdsByCreditBatchId.entries())
                  .filter(([, applicationIds]) =>
                    applicationIds.includes(binding.lineage.entityId),
                  )
                  .map(([creditBatchId]) => creditBatchId)
                  .sort()
            : [];
        if (target.kind === "sequestration" && creditBatchIds.length === 0) {
          throw new SafeError(
            `Source "${sourceId}" does not resolve to a Removal credit batch; its durability target is ambiguous.`,
          );
        }
        return [
          {
            documentId,
            sourceId,
            nomaRole: binding.nomaRole,
            lineage: binding.lineage,
            intendedTarget: {
              kind: target.kind,
              groupKey: target.groupKey,
              componentId: component.id,
              componentBlueprintKey: component.blueprint_key,
              inputKey: target.inputKey,
              creditBatchIds,
            },
            mappingRevision: binding.mappingRevision,
          },
        ];
      });
    })
    .sort((left, right) =>
      `${left.documentId}::${left.sourceId}::${left.intendedTarget.componentId}::${left.intendedTarget.inputKey}`.localeCompare(
        `${right.documentId}::${right.sourceId}::${right.intendedTarget.componentId}::${right.intendedTarget.inputKey}`,
      ),
    );
}

export function sourceIdsForDatapointTarget(
  plan: RemovalSourceBindingPlanEntry[],
  target: { componentId: string; inputKey: string },
): string[] {
  return Array.from(
    new Set(
      plan
        .filter(
          (entry) =>
            entry.intendedTarget.componentId === target.componentId &&
            entry.intendedTarget.inputKey === target.inputKey,
        )
        .map((entry) => entry.sourceId),
    ),
  ).sort();
}
