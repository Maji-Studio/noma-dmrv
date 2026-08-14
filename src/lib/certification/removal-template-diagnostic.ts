import type {
  IsometricComponentBlueprint,
  IsometricGhgEntryTemplate,
} from "@/lib/isometric";
import {
  listOptionalRemovalEvidenceTargets,
  removalEvidenceRoleLabelsForTarget,
} from "@/lib/certification/removal-source-bindings";
import {
  lookupInputMapping,
  lookupPeriodInputTuple,
  MAPPING_REVISION,
  resolveDatapointSource,
} from "@/lib/isometric/transformers/datapoint";
import {
  classifySequestration1000YearComponent,
  isSequestrationBlueprintFamily,
} from "@/lib/isometric/transformers/measurement-sample";
import {
  getSequestrationInputBinding,
  SEQUESTRATION_COMPONENT_INPUT_BINDINGS,
} from "@/lib/isometric/transformers/sequestration-binding";
import { encodeMeasurementProperty } from "@/lib/isometric/utils/measurement-property";
import {
  attachRemovalCompilationToDiagnostic,
  type RemovalTemplateDiagnosticCompilation,
} from "./removal-template-diagnostic-resolution";

export type { RemovalTemplateDiagnosticCompilation } from "./removal-template-diagnostic-resolution";

export type RemovalTemplateDiagnosticStatus =
  | "mapped"
  | "registry-owned-fixed"
  | "optional-not-present"
  | "missing-noma-mapping"
  | "unsupported-component"
  | "template-contract-drift"
  | "externally-unconfirmed-contract"
  | "deprecated-incompatible";

export type RemovalTemplateAggregateStatus = "mapped" | "drift" | "missing";

export interface RemovalTemplateResolvedValues {
  binding: "datapoint" | "fixed" | "measurement-sample";
  count: number;
  magnitudes: number[];
  unit: string | null;
}

export interface RemovalTemplateDiagnosticInput {
  label: string;
  inputKey: string;
  presentInTemplate: boolean;
  expected: {
    dataShape: string;
    quantityKind: string;
    unit: string;
  };
  nomaSource: string;
  transform: string;
  wirePath: string;
  evidenceRoles: string[];
  status: RemovalTemplateDiagnosticStatus;
  statusDetail: string;
  resolved: RemovalTemplateResolvedValues | null;
  resolutionContract:
    | { kind: "review-binding" }
    | { kind: "direct-datapoint" }
    | {
        kind: "measurement-property";
        property: { quantity_kind: string; qualifier: string | null };
      };
  raw: {
    templateId: string;
    groupId: string;
    groupKey: string;
    componentId: string;
    blueprintKey: string;
    fixedDatapointId: string | null;
  };
}

export interface RemovalTemplateDiagnosticComponent {
  label: string;
  blueprintKey: string;
  status: RemovalTemplateDiagnosticStatus;
  statusDetail: string;
  raw: { componentId: string; groupId: string };
  inputs: RemovalTemplateDiagnosticInput[];
}

export interface RemovalTemplateDiagnosticGroup {
  label: string;
  key: string;
  rawId: string;
  components: RemovalTemplateDiagnosticComponent[];
}

export interface OptionalRemovalTemplateTarget {
  label: string;
  groupKey: string;
  blueprintKey: string;
  inputKey: string;
  evidenceRole: string;
  status: "optional-not-present";
}

export interface RemovalTemplateDiagnosticModel {
  template: {
    id: string;
    displayName: string;
    creditType: string;
    mappingRevision: string;
  };
  aggregateStatus: RemovalTemplateAggregateStatus;
  templateIssues: string[];
  groups: RemovalTemplateDiagnosticGroup[];
  optionalNotPresent: OptionalRemovalTemplateTarget[];
  counts: Record<RemovalTemplateDiagnosticStatus, number>;
}

export interface BuildRemovalTemplateDiagnosticArgs {
  template: IsometricGhgEntryTemplate;
  blueprints?: readonly IsometricComponentBlueprint[];
  compilation?: RemovalTemplateDiagnosticCompilation | null;
}

const UNKNOWN_VALUE = "Not available";
const GHG_ENTRY_INPUT_PATH =
  "/ghg-entries.ghg_entry_template_components[].inputs[]";

const SOURCE_LABELS: Partial<Record<string, string>> = {
  weightedOrganicCarbonPercent: "Sample organic carbon, applied-mass weighted",
  totalBiocharDryMassKg: "Attribution-scaled dry applied biochar mass",
  totalFeedstockDryMassKg: "Production-run dry feedstock mass",
  totalStartupDieselLitres: "Production-run startup diesel",
  totalGensetDieselLitres: "Production-run generator and preprocessing diesel",
  totalDieselLitres: "Production-run total diesel",
  totalElectricityKwh: "Production-run electricity",
  feedstockTransportMassDistanceTonneKm:
    "Feedstock transport mass-distance",
  biocharTransportMassDistanceTonneKm: "Biochar transport mass-distance",
  sampleTransportMassDistanceTonneKm: "Sample transport mass-distance",
};

const STATUS_PRIORITY: Record<RemovalTemplateDiagnosticStatus, number> = {
  mapped: 0,
  "registry-owned-fixed": 0,
  "optional-not-present": 0,
  "externally-unconfirmed-contract": 1,
  "template-contract-drift": 2,
  "deprecated-incompatible": 2,
  "missing-noma-mapping": 3,
  "unsupported-component": 3,
};

function readableKey(key: string): string {
  return key
    .replaceAll("_", " ")
    .replaceAll("-", " ")
    .replace(/^./, (first) => first.toUpperCase());
}

function sourceLabel(source: string): string {
  return SOURCE_LABELS[source] ?? readableKey(source);
}

export const IDENTITY_TRANSFORM_LABEL = "Unchanged";

function transformLabel(transformRevision: string | undefined): string {
  if (!transformRevision || transformRevision === "identity-v1") {
    return IDENTITY_TRANSFORM_LABEL;
  }
  if (transformRevision === "percent-to-fraction-v1") return "Divide by 100";
  return `Apply ${transformRevision}`;
}

function componentStatus(
  inputs: readonly RemovalTemplateDiagnosticInput[],
): RemovalTemplateDiagnosticStatus {
  return inputs.reduce<RemovalTemplateDiagnosticStatus>(
    (current, input) =>
      STATUS_PRIORITY[input.status] > STATUS_PRIORITY[current]
        ? input.status
        : current,
    "mapped",
  );
}

function aggregateStatus(
  statuses: readonly RemovalTemplateDiagnosticStatus[],
): RemovalTemplateAggregateStatus {
  if (
    statuses.some(
      (status) =>
        status === "missing-noma-mapping" ||
        status === "unsupported-component",
    )
  ) {
    return "missing";
  }
  if (
    statuses.some(
      (status) =>
        status === "template-contract-drift" ||
        status === "externally-unconfirmed-contract" ||
        status === "deprecated-incompatible",
    )
  ) {
    return "drift";
  }
  return "mapped";
}

function inputRaw(args: {
  templateId: string;
  groupId: string;
  groupKey: string;
  componentId: string;
  blueprintKey: string;
  fixedDatapointId?: string | null;
}): RemovalTemplateDiagnosticInput["raw"] {
  return {
    templateId: args.templateId,
    groupId: args.groupId,
    groupKey: args.groupKey,
    componentId: args.componentId,
    blueprintKey: args.blueprintKey,
    fixedDatapointId: args.fixedDatapointId ?? null,
  };
}

function buildOrdinaryInputs(args: {
  template: IsometricGhgEntryTemplate;
  group: IsometricGhgEntryTemplate["groups"][number];
  component: IsometricGhgEntryTemplate["groups"][number]["components"][number];
  blueprint: IsometricComponentBlueprint | undefined;
}): RemovalTemplateDiagnosticInput[] {
  const { template, group, component, blueprint } = args;
  return component.inputs.map((input) => {
    const blueprintInput = blueprint?.inputs.find(
      (candidate) => candidate.input_key === input.input_key,
    );
    const raw = inputRaw({
      templateId: template.id,
      groupId: group.id,
      groupKey: group.key,
      componentId: component.id,
      blueprintKey: component.blueprint_key,
      fixedDatapointId: input.datapoint_id,
    });
    const evidenceRoles = removalEvidenceRoleLabelsForTarget({
      groupKey: group.key,
      componentBlueprintKey: component.blueprint_key,
      componentDisplayName: component.display_name,
      inputKey: input.input_key,
    });
    const expected = {
      dataShape: blueprintInput?.data_shape ?? UNKNOWN_VALUE,
      quantityKind: blueprintInput?.quantity_kind ?? input.quantity_kind,
      unit: blueprintInput?.compatible_unit ?? UNKNOWN_VALUE,
    };

    if (!blueprint) {
      return {
        label: input.display_name || readableKey(input.input_key),
        inputKey: input.input_key,
        presentInTemplate: true,
        expected,
        nomaSource: "No local blueprint contract",
        transform: "Not available",
        wirePath: GHG_ENTRY_INPUT_PATH,
        evidenceRoles,
        status: "unsupported-component" as const,
        statusDetail:
          "The component blueprint is unavailable from the registry catalog.",
        resolved: null,
        resolutionContract: { kind: "review-binding" },
        raw,
      };
    }

    if (!blueprintInput) {
      return {
        label: input.display_name || readableKey(input.input_key),
        inputKey: input.input_key,
        presentInTemplate: true,
        expected,
        nomaSource: "No matching blueprint input",
        transform: "Not available",
        wirePath: GHG_ENTRY_INPUT_PATH,
        evidenceRoles,
        status: "template-contract-drift" as const,
        statusDetail:
          "The template input is not present in the current component blueprint.",
        resolved: null,
        resolutionContract: { kind: "review-binding" },
        raw,
      };
    }

    if (input.type === "fixed") {
      const bound =
        Boolean(input.datapoint_id) &&
        input.quantity_kind === blueprintInput.quantity_kind;
      return {
        label: input.display_name || readableKey(input.input_key),
        inputKey: input.input_key,
        presentInTemplate: true,
        expected,
        nomaSource: "Isometric template datapoint",
        transform: "Fixed in template",
        wirePath: `Template datapoint reference -> ${GHG_ENTRY_INPUT_PATH}`,
        evidenceRoles,
        status: bound
          ? ("registry-owned-fixed" as const)
          : ("template-contract-drift" as const),
        statusDetail: bound
          ? "Isometric owns this fixed template value. Noma references it without reading the value."
          : "The fixed template input has no datapoint reference or its type differs from the blueprint.",
        resolved: null,
        resolutionContract: { kind: "review-binding" },
        raw,
      };
    }

    const periodTuple = lookupPeriodInputTuple(
      group.key,
      component.blueprint_key,
      input.input_key,
      component.display_name,
    );
    if (periodTuple) {
      return {
        label: input.display_name || readableKey(input.input_key),
        inputKey: input.input_key,
        presentInTemplate: true,
        expected,
        nomaSource: `Isometric project component (${periodTuple.category})`,
        transform: "Not prepared at Removal scope",
        wirePath: "Project component, not a Removal input",
        evidenceRoles,
        status: "unsupported-component" as const,
        statusDetail:
          "The production pipeline requires this input at project scope and blocks it in a Removal template.",
        resolved: null,
        resolutionContract: { kind: "review-binding" },
        raw,
      };
    }

    const mapping = lookupInputMapping(
      group.key,
      component.blueprint_key,
      input.input_key,
    );
    if (!mapping) {
      return {
        label: input.display_name || readableKey(input.input_key),
        inputKey: input.input_key,
        presentInTemplate: true,
        expected,
        nomaSource: "No noma dMRV source",
        transform: "Not available",
        wirePath: "/datapoints -> " + GHG_ENTRY_INPUT_PATH,
        evidenceRoles,
        status: "missing-noma-mapping" as const,
        statusDetail:
          "No production mapping exists for this group, blueprint, and input key.",
        resolved: null,
        resolutionContract: { kind: "review-binding" },
        raw,
      };
    }

    let resolvedSource: string;
    try {
      resolvedSource = String(
        resolveDatapointSource(mapping, component.display_name),
      );
    } catch {
      return {
        label: input.display_name || readableKey(input.input_key),
        inputKey: input.input_key,
        presentInTemplate: true,
        expected,
        nomaSource: sourceLabel(String(mapping.source)),
        transform: transformLabel(mapping.transformRevision),
        wirePath: "/datapoints.quantity -> " + GHG_ENTRY_INPUT_PATH,
        evidenceRoles,
        status: "template-contract-drift" as const,
        statusDetail:
          "The component display name no longer resolves the production source override.",
        resolved: null,
        resolutionContract: { kind: "review-binding" },
        raw,
      };
    }

    const contractMatches =
      mapping.expectedQuantityKind === blueprintInput.quantity_kind &&
      mapping.expectedQuantityKind === input.quantity_kind &&
      mapping.unit.toLowerCase() === blueprintInput.compatible_unit.toLowerCase();
    return {
      label: input.display_name || readableKey(input.input_key),
      inputKey: input.input_key,
      presentInTemplate: true,
      expected,
      nomaSource: sourceLabel(resolvedSource),
      transform: transformLabel(mapping.transformRevision),
      wirePath: "/datapoints.quantity -> " + GHG_ENTRY_INPUT_PATH,
      evidenceRoles,
      status: contractMatches ? "mapped" : "template-contract-drift",
      statusDetail: contractMatches
        ? `Mapped through the ${mapping.bucket} attribution bucket.`
        : "The template type or unit differs from the production mapping contract.",
      resolved: null,
      resolutionContract: { kind: "review-binding" },
      raw,
    };
  });
}

function buildSequestrationInputs(args: {
  template: IsometricGhgEntryTemplate;
  group: IsometricGhgEntryTemplate["groups"][number];
  component: IsometricGhgEntryTemplate["groups"][number]["components"][number];
  blueprint: IsometricComponentBlueprint | undefined;
}): RemovalTemplateDiagnosticInput[] {
  const { template, group, component, blueprint } = args;
  const classification = classifySequestration1000YearComponent(
    component.blueprint_key,
  );
  const explicitContract = (
    SEQUESTRATION_COMPONENT_INPUT_BINDINGS as Readonly<
      Record<string, { inputs: Readonly<Record<string, unknown>> }>
    >
  )[component.blueprint_key];
  const expectedKeys = explicitContract
    ? Object.keys(explicitContract.inputs)
    : component.inputs.map((input) => input.input_key);
  const inputKeys = Array.from(
    new Set([...component.inputs.map((input) => input.input_key), ...expectedKeys]),
  );

  return inputKeys.map((inputKey) => {
    const input = component.inputs.find(
      (candidate) => candidate.input_key === inputKey,
    );
    const binding = getSequestrationInputBinding(
      component.blueprint_key,
      inputKey,
    );
    const blueprintInput = blueprint?.inputs.find(
      (candidate) => candidate.input_key === inputKey,
    );
    const sourceContract = binding?.sourceContract;
    const expectedQuantityKind =
      binding?.source === "measurement-property"
        ? binding.measurementProperty.quantity_kind
        : binding?.quantityKind;
    const expected = {
      dataShape: binding?.dataShape ?? blueprintInput?.data_shape ?? UNKNOWN_VALUE,
      quantityKind:
        expectedQuantityKind ?? blueprintInput?.quantity_kind ?? input?.quantity_kind ?? UNKNOWN_VALUE,
      unit:
        sourceContract?.wireUnit ??
        blueprintInput?.compatible_unit ??
        UNKNOWN_VALUE,
    };
    const raw = inputRaw({
      templateId: template.id,
      groupId: group.id,
      groupKey: group.key,
      componentId: component.id,
      blueprintKey: component.blueprint_key,
      fixedDatapointId: input?.datapoint_id,
    });
    const evidenceRoles = removalEvidenceRoleLabelsForTarget({
      groupKey: group.key,
      componentBlueprintKey: component.blueprint_key,
      componentDisplayName: component.display_name,
      inputKey,
    });

    let status: RemovalTemplateDiagnosticStatus = "mapped";
    let statusDetail = "Mapped by the explicit durability binding.";
    if (classification === "deprecated") {
      status = "deprecated-incompatible";
      statusDetail =
        "This legacy 1,000-year component is deprecated and incompatible with the current four-input local contract.";
    } else if (classification === "current" && !binding) {
      status = "template-contract-drift";
      statusDetail =
        "The current durability component contains an input outside the explicit local contract.";
    } else if (classification === "unsupported-unsampled" || !binding) {
      status = "unsupported-component";
      statusDetail =
        "The production submission pipeline does not support this durability component or input.";
    } else if (!input) {
      status = "template-contract-drift";
      statusDetail = "The current local durability contract requires this input, but the template omits it.";
    } else if (
      input.type !== "monitored" ||
      input.quantity_kind !== expectedQuantityKind ||
      (blueprintInput &&
        (blueprintInput.quantity_kind !== expectedQuantityKind ||
          blueprintInput.data_shape !== binding.dataShape))
    ) {
      status = "template-contract-drift";
      statusDetail =
        "The live template shape or type differs from the explicit durability binding.";
    } else if (
      sourceContract?.confirmation === "externally-unconfirmed"
    ) {
      status = "externally-unconfirmed-contract";
      statusDetail =
        "Code implements the observed registry contract, but Isometric confirmation for the project is still pending.";
    }

    const measurementPath =
      binding?.source === "direct-datapoint"
        ? "/datapoints.quantity -> " + GHG_ENTRY_INPUT_PATH
        : "/measurement-samples.values[] -> " + GHG_ENTRY_INPUT_PATH;
    return {
      label: input?.display_name || readableKey(inputKey),
      inputKey,
      presentInTemplate: Boolean(input),
      expected,
      nomaSource:
        sourceContract?.nomaSource ??
        (binding?.source === "measurement-property"
          ? readableKey(encodeMeasurementProperty(binding.measurementProperty))
          : "No supported noma dMRV source"),
      transform: sourceContract
        ? transformLabel(sourceContract.transformRevision)
        : "Not available",
      wirePath: measurementPath,
      evidenceRoles,
      status,
      statusDetail,
      resolved: null,
      resolutionContract:
        binding?.source === "measurement-property"
          ? {
              kind: "measurement-property" as const,
              property: binding.measurementProperty,
            }
          : binding?.source === "direct-datapoint"
            ? { kind: "direct-datapoint" as const }
            : { kind: "review-binding" as const },
      raw,
    };
  });
}

function optionalNotPresent(
  template: IsometricGhgEntryTemplate,
): OptionalRemovalTemplateTarget[] {
  const present = new Set(
    template.groups.flatMap((group) =>
      group.components.flatMap((component) =>
        component.inputs.map(
          (input) =>
            `${group.key}::${component.blueprint_key}::${component.display_name.trim().toLowerCase()}::${input.input_key}`,
        ),
      ),
    ),
  );
  return listOptionalRemovalEvidenceTargets()
    .filter((target) => {
      const displayName = target.componentDisplayName?.trim().toLowerCase() ?? "";
      if (displayName) {
        return !present.has(
          `${target.groupKey}::${target.componentBlueprintKey}::${displayName}::${target.inputKey}`,
        );
      }
      return ![...present].some((key) =>
        key.startsWith(
          `${target.groupKey}::${target.componentBlueprintKey}::`,
        ) && key.endsWith(`::${target.inputKey}`),
      );
    })
    .map((target) => ({
      label: `${readableKey(target.groupKey)}: ${readableKey(target.inputKey)}`,
      groupKey: target.groupKey,
      blueprintKey: target.componentBlueprintKey,
      inputKey: target.inputKey,
      evidenceRole: target.nomaRoleLabel,
      status: "optional-not-present" as const,
    }));
}

/**
 * Normalizes the active Removal template against the exact production mapping
 * seams. Mapping and Removal trace views consume this one model.
 */
export function buildRemovalTemplateDiagnostic(
  args: BuildRemovalTemplateDiagnosticArgs,
): RemovalTemplateDiagnosticModel {
  const blueprintByKey = new Map(
    (args.blueprints ?? []).map((blueprint) => [blueprint.key, blueprint]),
  );
  const groups = args.template.groups.map((group) => ({
    label: group.display_name || readableKey(group.key),
    key: group.key,
    rawId: group.id,
    components: group.components.map((component) => {
      const blueprint = blueprintByKey.get(component.blueprint_key);
      const inputs = isSequestrationBlueprintFamily(component.blueprint_key)
        ? buildSequestrationInputs({
            template: args.template,
            group,
            component,
            blueprint,
          })
        : buildOrdinaryInputs({
            template: args.template,
            group,
            component,
            blueprint,
          });
      const status = componentStatus(inputs);
      return {
        label: component.display_name || readableKey(component.blueprint_key),
        blueprintKey: component.blueprint_key,
        status,
        statusDetail:
          inputs.find((input) => input.status === status)?.statusDetail ??
          "All inputs use the production mapping contract.",
        raw: { componentId: component.id, groupId: group.id },
        inputs,
      };
    }),
  }));
  const optionalTargets = optionalNotPresent(args.template);
  const storageComponentCount = args.template.groups
    .flatMap((group) => group.components)
    .filter(
      (component) =>
        component.blueprint_key === "carbon_rich_substance_sequestration" ||
        isSequestrationBlueprintFamily(component.blueprint_key),
    ).length;
  const templateIssues: string[] = [];
  if (args.template.credit_type !== "REMOVAL") {
    templateIssues.push(
      `The active template credit type is ${args.template.credit_type}, not REMOVAL.`,
    );
  }
  if (storageComponentCount === 0) {
    templateIssues.push(
      "The active template has no supported biochar sequestration component.",
    );
  } else if (storageComponentCount > 1) {
    templateIssues.push(
      `The active template has ${storageComponentCount} biochar sequestration components; the production contract requires exactly one.`,
    );
  }
  const statuses = [
    ...groups.flatMap((group) =>
      group.components.flatMap((component) =>
        component.inputs.map((input) => input.status),
      ),
    ),
    ...optionalTargets.map((target) => target.status),
  ];
  const counts = Object.fromEntries(
    (
      [
        "mapped",
        "registry-owned-fixed",
        "optional-not-present",
        "missing-noma-mapping",
        "unsupported-component",
        "template-contract-drift",
        "externally-unconfirmed-contract",
        "deprecated-incompatible",
      ] as const
    ).map((status) => [
      status,
      statuses.filter((candidate) => candidate === status).length,
    ]),
  ) as Record<RemovalTemplateDiagnosticStatus, number>;

  const model: RemovalTemplateDiagnosticModel = {
    template: {
      id: args.template.id,
      displayName: args.template.display_name,
      creditType: args.template.credit_type,
      mappingRevision: MAPPING_REVISION,
    },
    aggregateStatus:
      storageComponentCount === 0
        ? "missing"
        : templateIssues.length > 0
          ? "drift"
          : aggregateStatus(statuses),
    templateIssues,
    groups,
    optionalNotPresent: optionalTargets,
    counts,
  };
  return args.compilation
    ? attachRemovalCompilationToDiagnostic(model, args.compilation)
    : model;
}
