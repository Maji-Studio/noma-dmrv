import { payloadHash } from "@/lib/isometric/utils/payload-hash";
import type { IsometricGhgEntryTemplate } from "@/lib/isometric";
import { SafeError } from "@/lib/errors";
import { isSequestrationBlueprintFamily } from "@/lib/isometric/transformers/measurement-sample";
import {
  APPLICATION_BOUNDARY_LOGBOOK_UNCONDITIONAL_DOCUMENT_TYPES,
  isApplicationBoundaryLogbookEvidenceType,
} from "@/lib/certification/application-evidence";

export type NomaEvidenceRole =
  | "inventory"
  | "feedstock_bill_of_lading"
  | "delivery_bill_of_lading";

export interface RemovalSourceLineage {
  entityType: string;
  entityId: string;
  entityLabel: string;
}

export type RemovalSourceIntendedTarget =
  | {
      kind: "sequestration";
      groupKey: "co2-stored";
      inputKey: "product_mass";
    }
  | {
      kind: "ordinary";
      groupKey:
        | "biomass-feedstock-transport"
        | "biochar-transport";
      componentBlueprintKey: "mass_distance_based_ci_emissions";
      inputKey: "mass_distance";
    };

export interface ClassifiedRemovalSource {
  nomaRole: NomaEvidenceRole;
  nomaRoleLabel: string;
  lineage: RemovalSourceLineage;
  intendedTarget: RemovalSourceIntendedTarget;
  mappingRevision: string;
}

interface CandidateDocumentFacts {
  documentType: string;
  metadata: unknown;
  lineage: RemovalSourceLineage;
}

interface SourceBindingRule {
  nomaRole: NomaEvidenceRole;
  nomaRoleLabel: string;
  intendedTarget: RemovalSourceIntendedTarget;
}

const SOURCE_BINDING_RULES = {
  inventory: {
    nomaRole: "inventory",
    nomaRoleLabel: "Inventory",
    intendedTarget: {
      kind: "sequestration",
      groupKey: "co2-stored",
      inputKey: "product_mass",
    },
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
} as const satisfies Record<string, SourceBindingRule>;

export const SOURCE_BINDING_MAPPING_REVISION = payloadHash(
  SOURCE_BINDING_RULES,
);

function metadataRecord(value: unknown): Record<string, unknown> {
  return value !== null && !Array.isArray(value) && typeof value === "object"
    ? (value as Record<string, unknown>)
    : {};
}

/**
 * Classifies only the three code-owned MVP evidence mappings. The operational
 * document type remains a separate fact. Every application-boundary logbook
 * evidence subtype maps to the Inventory Noma role because that role identifies
 * the registry product-mass target, not the operator's evidence subtype.
 */
export function classifyRemovalSourceCandidate(
  facts: CandidateDocumentFacts,
): ClassifiedRemovalSource | null {
  const { lineage } = facts;
  let rule: SourceBindingRule | null = null;
  const logbookEvidenceType = metadataRecord(facts.metadata).logbookEvidenceType;
  const isApplicationBoundaryLogbook =
    lineage.entityType === "application" &&
    (isApplicationBoundaryLogbookEvidenceType(logbookEvidenceType) ||
      APPLICATION_BOUNDARY_LOGBOOK_UNCONDITIONAL_DOCUMENT_TYPES.some(
        (documentType) => documentType === facts.documentType,
      ));

  if (isApplicationBoundaryLogbook) {
    rule = SOURCE_BINDING_RULES.inventory;
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
  target: RemovalSourceIntendedTarget,
): boolean {
  return target.kind === "sequestration"
    ? blueprintKey === LEGACY_SEQUESTRATION_BLUEPRINT_KEY ||
        isSequestrationBlueprintFamily(blueprintKey)
    : blueprintKey === target.componentBlueprintKey;
}

/**
 * Resolves semantic targets onto the exact template component IDs that will
 * consume their Datapoints. Ambiguous or missing targets fail closed.
 */
export function buildRemovalSourceBindingPlan(args: {
  candidates: SourceBindingCandidate[];
  template: IsometricGhgEntryTemplate;
  applicationIdsByCreditBatchId: Map<string, string[]>;
}): RemovalSourceBindingPlanEntry[] {
  return args.candidates
    .map(({ documentId, sourceId, binding }) => {
      const target = binding.intendedTarget;
      const matchingComponents = args.template.groups
        .filter((group) => group.key === target.groupKey)
        .flatMap((group) => group.components)
        .filter(
          (component) =>
            matchesIntendedComponent(component.blueprint_key, target) &&
            component.inputs.some(
              (input) => input.input_key === target.inputKey,
            ),
        );
      if (matchingComponents.length !== 1) {
        throw new SafeError(
          `Noma evidence role "${binding.nomaRole}" resolved ${matchingComponents.length} template targets for ` +
            `"${target.groupKey}/${target.inputKey}"; expected exactly one.`,
        );
      }
      const component = matchingComponents[0];
      const creditBatchIds =
        target.kind === "sequestration"
          ? Array.from(args.applicationIdsByCreditBatchId.entries())
              .filter(([, applicationIds]) =>
                applicationIds.includes(binding.lineage.entityId),
              )
              .map(([creditBatchId]) => creditBatchId)
              .sort()
          : [];
      if (target.kind === "sequestration" && creditBatchIds.length === 0) {
        throw new SafeError(
          `Inventory Source "${sourceId}" does not resolve to a Removal credit batch; its product-mass target is ambiguous.`,
        );
      }
      return {
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
      };
    })
    .sort((left, right) =>
      `${left.documentId}::${left.sourceId}`.localeCompare(
        `${right.documentId}::${right.sourceId}`,
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
