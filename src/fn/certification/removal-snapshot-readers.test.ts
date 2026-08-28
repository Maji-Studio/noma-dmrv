import { describe, expect, it } from "vitest";
import {
  assertRemovalSnapshotConfigurationCurrent,
  readRemovalBiocharApplicationIntents,
  readRemovalSourceBindingPlan,
  readRemovalSupersedePreviousId,
} from "./removal-snapshot-readers";

describe("assertRemovalSnapshotConfigurationCurrent", () => {
  const row = {
    payloadSnapshot: {
      semantic: { externalProjectId: "project-1", templateId: "template-1" },
    },
  } as never;

  it("accepts the project and template frozen in the snapshot", () => {
    expect(() =>
      assertRemovalSnapshotConfigurationCurrent(row, {
        externalProjectId: "project-1",
        templateId: "template-1",
      }),
    ).not.toThrow();
  });

  it("fails closed after a project or template repoint", () => {
    expect(() =>
      assertRemovalSnapshotConfigurationCurrent(row, {
        externalProjectId: "project-2",
        templateId: "template-1",
      }),
    ).toThrow(/registry mapping changed/i);
  });
});

describe("readRemovalSupersedePreviousId", () => {
  it("keeps legacy snapshots resumable without a superseded version", () => {
    expect(
      readRemovalSupersedePreviousId({ metadata: {} } as never),
    ).toBeNull();
  });

  it("reads a valid superseded-version link", () => {
    expect(
      readRemovalSupersedePreviousId({
        metadata: { supersedePreviousId: "submission-v1" },
      } as never),
    ).toBe("submission-v1");
  });

  it("fails closed for a malformed superseded-version link", () => {
    expect(() =>
      readRemovalSupersedePreviousId({
        metadata: { supersedePreviousId: 42 },
      } as never),
    ).toThrow(/invalid superseded-version link/i);
  });
});

describe("readRemovalSourceBindingPlan", () => {
  it("reads the immutable Source binding plan from a claimed snapshot", () => {
    const plan = [
      {
        documentId: "document-1",
        sourceId: "source-1",
        nomaRole: "inventory",
        lineage: {
          entityType: "application",
          entityId: "application-1",
          entityLabel: "Application APP-001",
        },
        intendedTarget: {
          kind: "sequestration",
          groupKey: "co2-stored",
          componentId: "component-1",
          componentBlueprintKey: "biochar_sequestration_1000_year",
          inputKey: "product_mass",
          creditBatchIds: ["credit-batch-1"],
        },
        mappingRevision: "revision-1",
      },
    ];

    expect(
      readRemovalSourceBindingPlan({
        payloadSnapshot: { sourceBindingPlan: plan },
      } as never),
    ).toEqual(plan);
  });

  it("fails closed for a pre-plan stale draft", () => {
    expect(() =>
      readRemovalSourceBindingPlan({
        payloadSnapshot: {},
      } as never),
    ).toThrow(/saved submission uses an older supporting-file plan/i);
  });

  it("fails closed when a stored sequestration target has no credit-batch scope", () => {
    expect(() =>
      readRemovalSourceBindingPlan({
        payloadSnapshot: {
          sourceBindingPlan: [
            {
              documentId: "document-1",
              sourceId: "source-1",
              nomaRole: "inventory",
              lineage: {
                entityType: "application",
                entityId: "application-1",
                entityLabel: "Application APP-001",
              },
              intendedTarget: {
                kind: "sequestration",
                groupKey: "co2-stored",
                componentId: "component-1",
                componentBlueprintKey:
                  "biochar_sequestration_1000_year",
                inputKey: "product_mass",
              },
              mappingRevision: "revision-1",
            },
          ],
        },
      } as never),
    ).toThrow(/saved submission uses an older supporting-file plan/i);
  });
});

describe("readRemovalBiocharApplicationIntents", () => {
  const baseIntent = {
    applicationId: "application-1",
    applicationCode: "APP-001",
    creditBatchId: "credit-batch-1",
    deliveryId: "delivery-1",
    customerLocationId: "customer-location-1",
    certifierProjectId: "mapping-1",
    externalProjectId: "prj-test",
    applicationDate: "2026-04-05",
    allocatedWetMassKg: 12_000,
    fieldSizeHa: 4,
    supplierReference: "nm-isometric-sandbox-bca-app-batch-v1",
    storageLocationSupplierReference: "nm-slc-test",
    storageLocationPayload: {
      description: { __typename: "Undefined" },
      latitude: 46.948,
      longitude: 7.447,
      name: "North Field",
      project_id: "prj-test",
      storage_method: "biochar_field",
      supplier_reference_id: "nm-slc-test",
    },
    sourceIds: [],
  };

  function read(intents: unknown[]) {
    return readRemovalBiocharApplicationIntents({
      version: 1,
      payloadSnapshot: { semantic: { biocharApplicationIntents: intents } },
    } as never);
  }

  it("prefers claim-time versioned transport intents", () => {
    const versionedIntent = {
      ...baseIntent,
      supplierReference: "nm-isometric-sandbox-bca-app-batch-s2-v1",
    };
    expect(
      readRemovalBiocharApplicationIntents({
        payloadSnapshot: {
          semantic: { biocharApplicationIntents: [baseIntent] },
          transport: { biocharApplicationIntents: [versionedIntent] },
        },
      } as never),
    ).toEqual([versionedIntent]);
  });

  it("round-trips the ordinary immutable-slice intent", () => {
    expect(read([baseIntent])).toEqual([baseIntent]);
  });

  it("refuses an unversioned semantic fallback after the first submission", () => {
    expect(() =>
      readRemovalBiocharApplicationIntents({
        version: 2,
        payloadSnapshot: {
          semantic: { biocharApplicationIntents: [baseIntent] },
        },
      } as never),
    ).toThrow(/older Biochar Application format/i);
  });

  it("fails closed for an intent without its immutable slice mass", () => {
    expect(() =>
      read([{ ...baseIntent, allocatedWetMassKg: undefined }]),
    ).toThrow(/older Biochar Application format/i);
  });
});
