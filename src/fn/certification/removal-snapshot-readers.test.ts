import { describe, expect, it } from "vitest";
import {
  readRemovalBiocharApplicationIntents,
  readRemovalSourceBindingPlan,
} from "./removal-snapshot-readers";

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
      payloadSnapshot: { semantic: { biocharApplicationIntents: intents } },
    } as never);
  }

  it("round-trips the ordinary immutable-slice intent", () => {
    expect(read([baseIntent])).toEqual([baseIntent]);
  });

  it("fails closed for an intent without its immutable slice mass", () => {
    expect(() =>
      read([{ ...baseIntent, allocatedWetMassKg: undefined }]),
    ).toThrow(/older Biochar Application format/i);
  });
});
