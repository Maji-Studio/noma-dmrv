/**
 * Fixture-driven registry boundary for the explicit 1000-year sequestration
 * bind. The real measurement-sample and GHG-entry wrappers run against the
 * in-memory registry; only the DB-backed create ledger choreography is replaced
 * with its successful create arm.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/isometric/client", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("@/lib/isometric/client")>();
  const { createFakeClientModule } = await import("./fixtures/fake-registry");
  return createFakeClientModule(actual);
});

vi.mock("@/data-access/certification", () => ({
  appendSubmissionJournal: vi.fn(),
}));

vi.mock("@/fn/certification/registry-create", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("@/fn/certification/registry-create")>();
  return {
    ...actual,
    performRegistryCreate: vi.fn(
      async (
        args: import("@/fn/certification/registry-create").PerformRegistryCreateArgs,
      ) => {
        if (args.resumed) {
          const lookup = await args.reconcile();
          if (lookup.found === "single") {
            return {
              externalId: lookup.externalId,
              source: "reconciliation" as const,
            };
          }
        }
        const externalId = await args.create();
        return { externalId, source: "create" as const };
      },
    ),
  };
});

import { submitDurabilityMeasurementSamples } from "@/fn/certification/durability-measurement-samples";
import { buildCreateGhgEntryRequest } from "@/lib/isometric/transformers/ghg-entry";
import { build1000YearSequestrationSample } from "@/lib/isometric/transformers/measurement-sample";
import {
  assertSequestrationTemplateBindings,
  bindSequestrationDatapointsToTemplate,
  buildDirectSequestrationDatapoints,
} from "@/lib/isometric/transformers/sequestration-binding";
import {
  createDatapoint,
  createGhgEntry,
  getIsometricClientForOrg,
  type IsometricGhgEntryTemplate,
} from "@/lib/isometric";
import type { Logger } from "@/lib/log";
import { makeTestOrgContext } from "./helpers/test-org";
import {
  installFakeRegistry,
  type FakeIsometricRegistry,
} from "./fixtures/fake-registry";

const TEMPLATE_ID = "rvt_boundary_1000";
const RTC_ID = "rtc_boundary_1000";
const PROJECT_ID = "prj_boundary_1000";
const SAMPLE_REF = "nm-mts-boundary-pb-batch-v1";
const SOURCE_BINDING_PLAN = [
  {
    documentId: "document-boundary-inventory",
    sourceId: "source-boundary-inventory",
    nomaRole: "inventory",
    lineage: {
      entityType: "application",
      entityId: "application-boundary",
      entityLabel: "Application APP-BOUNDARY",
    },
    intendedTarget: {
      kind: "sequestration",
      groupKey: "co2-stored",
      componentId: RTC_ID,
      componentBlueprintKey: "biochar_sequestration_1000_year",
      inputKey: "product_mass",
      creditBatchIds: ["batch-boundary"],
    },
    mappingRevision: "source-binding-boundary-revision",
  },
] as const;

const log = {
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
  debug: vi.fn(),
} as unknown as Logger;

function template(): IsometricGhgEntryTemplate {
  return {
    id: TEMPLATE_ID,
    credit_type: "REMOVAL",
    display_name: "1000-year boundary template",
    groups: [
      {
        id: "rtg_boundary",
        key: "co2-stored",
        display_name: "CO2 stored",
        components: [
          {
            id: RTC_ID,
            blueprint_key: "biochar_sequestration_1000_year",
            display_name: "Biochar sequestration, 1000 year durability",
            inputs: [
              {
                type: "monitored",
                input_key: "carbon_contents",
                quantity_kind: "mass_fraction_dry_basis",
                datapoint_id: null,
              },
              {
                type: "monitored",
                input_key: "product_mass",
                quantity_kind: "mass",
                datapoint_id: null,
              },
              {
                type: "monitored",
                input_key: "s_fraction",
                quantity_kind: "dimensionless",
                datapoint_id: null,
              },
            ],
          },
        ],
      },
    ],
  } as unknown as IsometricGhgEntryTemplate;
}

let registry: FakeIsometricRegistry;

beforeEach(() => {
  registry = installFakeRegistry();
  vi.clearAllMocks();
});

describe("1000-year sequestration registry boundary", () => {
  it("rejects missing, duplicated, or drifted live template bindings", () => {
    const valid = template();
    expect(() => assertSequestrationTemplateBindings(valid)).not.toThrow();

    const duplicate = structuredClone(valid);
    duplicate.groups[0].components.push(
      structuredClone(duplicate.groups[0].components[0]),
    );
    expect(() => assertSequestrationTemplateBindings(duplicate)).toThrow(
      /exactly one supported sequestration component; found 2/,
    );

    const emissionsOnly = structuredClone(valid);
    emissionsOnly.groups[0].components[0].blueprint_key =
      "pyrolyzer_direct";
    expect(() => assertSequestrationTemplateBindings(emissionsOnly)).toThrow(
      /exactly one supported sequestration component; found 0/,
    );

    const renamedInput = structuredClone(valid);
    renamedInput.groups[0].components[0].inputs[0].input_key =
      "renamed_carbon_contents";
    expect(() => assertSequestrationTemplateBindings(renamedInput)).toThrow(
      /has no explicit datapoint-source binding/,
    );

    const wrongQuantityKind = structuredClone(valid);
    wrongQuantityKind.groups[0].components[0].inputs[2].quantity_kind =
      "dimensionless_ratio";
    expect(() =>
      assertSequestrationTemplateBindings(wrongQuantityKind),
    ).toThrow(/requires quantity kind "dimensionless"/);
  });

  it("captures POSTed measurement value IDs and binds them into the GHG entry variants", async () => {
    const sampleBody = build1000YearSequestrationSample({
      projectId: PROJECT_ID,
      supplierRefId: SAMPLE_REF,
      measuredAt: "2026-07-24T00:00:00.000Z",
      productMassKg: 1_000,
      replicates: [
        { carbonContentFraction: 0.8, sFraction: 0.91 },
        { carbonContentFraction: 0.82, sFraction: 0.92 },
        { carbonContentFraction: 0.84, sFraction: 0.93 },
      ],
    });
    expect(sampleBody).not.toBeNull();
    if (!sampleBody) return;

    const client = await getIsometricClientForOrg(
      "org-boundary-sequestration",
    );
    const directDatapoints = buildDirectSequestrationDatapoints({
      template: template(),
      measurementSampleSubmissions: [
        {
          operationKey: "pb:batch-boundary",
          supplierRefId: SAMPLE_REF,
          body: sampleBody,
        },
      ],
      projectId: PROJECT_ID,
      removalId: "rem-boundary-sequestration",
      version: 1,
      sourceIds: [],
    });
    const directIds: string[] = [];
    for (const direct of directDatapoints) {
      const created = await createDatapoint(client, direct.body);
      directIds.push(created.id);
    }

    expect(registry.requestCount("POST", "/datapoints")).toBe(3);
    expect(
      registry.datapoints.map((datapoint) => datapoint.quantity),
    ).toEqual([
      { magnitude: 0.91, unit: "dimensionless" },
      { magnitude: 0.92, unit: "dimensionless" },
      { magnitude: 0.93, unit: "dimensionless" },
    ]);
    expect(
      registry.datapoints.map((datapoint) => datapoint.display_name),
    ).toEqual(["s_fraction", "s_fraction", "s_fraction"]);

    const submitted = await submitDurabilityMeasurementSamples({
      orgCtx: makeTestOrgContext("user-boundary-sequestration"),
      removalId: "rem-boundary-sequestration",
      submissionRow: {
        id: "sub-boundary-sequestration",
        payloadSnapshot: { journaled: {} },
      },
      resumed: false,
      submissions: [
        {
          operationKey: "pb:batch-boundary",
          supplierRefId: SAMPLE_REF,
          body: sampleBody,
          label: "production batch CB-BOUNDARY",
        },
      ],
      sourceBindingPlan: SOURCE_BINDING_PLAN as never,
      log,
    });

    expect(registry.requestCount("POST", "/measurement_samples")).toBe(1);
    expect(registry.measurementSamples).toHaveLength(1);
    expect(submitted.samples).toHaveLength(1);

    const resumed = await submitDurabilityMeasurementSamples({
      orgCtx: makeTestOrgContext("user-boundary-sequestration"),
      removalId: "rem-boundary-sequestration",
      submissionRow: {
        id: "sub-boundary-sequestration",
        payloadSnapshot: {
          journaled: {
            measurementSamples: [
              {
                supplierReferenceId: SAMPLE_REF,
                measurementSampleId:
                  submitted.samples[0].measurementSampleId,
              },
            ],
          },
        },
      },
      resumed: true,
      submissions: [
        {
          operationKey: "pb:batch-boundary",
          supplierRefId: SAMPLE_REF,
          body: sampleBody,
          label: "production batch CB-BOUNDARY",
        },
      ],
      sourceBindingPlan: SOURCE_BINDING_PLAN as never,
      log,
    });
    expect(registry.requestCount("POST", "/measurement_samples")).toBe(1);
    expect(
      registry.requestCount(
        "GET",
        `/measurement_samples/${submitted.samples[0].measurementSampleId}`,
      ),
    ).toBe(0);
    expect(registry.requestCount("GET", "/measurement_samples")).toBe(1);
    expect(resumed.samples).toHaveLength(1);
    expect(resumed.samples[0].measurementSampleId).toBe(
      submitted.samples[0].measurementSampleId,
    );
    expect(resumed.datapointIdsByMeasurementProperty).toEqual(
      submitted.datapointIdsByMeasurementProperty,
    );

    const responseValues = registry.measurementSamples[0].values as Array<{
      datapoint_id: string;
      measurement_property: { quantity_kind: string; qualifier: string | null };
    }>;
    const carbonIds = responseValues
      .filter(
        (value) =>
          value.measurement_property.quantity_kind ===
          "mass_fraction_dry_basis",
      )
      .map((value) => value.datapoint_id);
    const measurementSampleSFractionIds = responseValues
      .filter(
        (value) =>
          value.measurement_property.qualifier === "inertinite_fraction",
      )
      .map((value) => value.datapoint_id);
    const productMassId = responseValues.find(
      (value) => value.measurement_property.quantity_kind === "mass",
    )?.datapoint_id;
    expect(productMassId).toBeDefined();

    const datapointIdsByRtcInput = bindSequestrationDatapointsToTemplate({
      template: template(),
      datapointIdsByMeasurementProperty:
        submitted.datapointIdsByMeasurementProperty,
      datapointIdsByRtcInput: new Map([
        [`${RTC_ID}::s_fraction`, directIds],
      ]),
    });
    const body = buildCreateGhgEntryRequest({
      template: template(),
      blueprintsByKey: new Map(),
      datapointIdsByRtcInput,
      reportingWindow: {
        startedOn: new Date("2026-07-01T00:00:00.000Z"),
        completedOn: new Date("2026-07-24T00:00:00.000Z"),
      },
      projectId: PROJECT_ID,
      supplierRefId: "nm-rmv-boundary-v1",
    });

    await createGhgEntry(client, body);

    expect(registry.requestCount("POST", "/ghg_entries")).toBe(1);
    expect(registry.ghgEntries[0].ghg_entry_template_components).toEqual([
      {
        ghg_entry_template_component_id: RTC_ID,
        inputs: [
          {
            __typename: "CreateComponentListInput",
            datapoint_ids: carbonIds,
            input_key: "carbon_contents",
          },
          {
            __typename: "CreateComponentScalarInput",
            datapoint_id: productMassId,
            input_key: "product_mass",
          },
          {
            __typename: "CreateComponentListInput",
            datapoint_ids: directIds,
            input_key: "s_fraction",
          },
        ],
      },
    ]);
    expect(directIds).not.toEqual(measurementSampleSFractionIds);
  });
});
