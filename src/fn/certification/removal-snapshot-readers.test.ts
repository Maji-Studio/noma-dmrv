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

  it("reads a delivery proof-of-delivery entry from a claimed snapshot", () => {
    const plan = [
      {
        documentId: "document-1",
        sourceId: "source-1",
        nomaRole: "proof_of_delivery",
        lineage: {
          entityType: "delivery",
          entityId: "delivery-1",
          entityLabel: "Delivery DEL-001",
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
    appliedTonnes: 12,
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

  it("round-trips a mass-gated intent", () => {
    const gated = {
      ...baseIntent,
      gateReason: "missing_truck_masses",
      truckMassOnArrivalKg: null,
      truckMassOnDepartureKg: null,
    };

    expect(read([gated])).toEqual([gated]);
  });

  it("round-trips a ready intent with its null gate reason", () => {
    const ready = {
      ...baseIntent,
      gateReason: null,
      truckMassOnArrivalKg: 15_000,
      truckMassOnDepartureKg: 3_000,
    };

    expect(read([ready])).toEqual([ready]);
  });

  it("keeps a pre-gating snapshot without a gateReason field resumable", () => {
    const legacy = {
      ...baseIntent,
      truckMassOnArrivalKg: 15_000,
      truckMassOnDepartureKg: 3_000,
    };

    expect(read([legacy])).toEqual([{ ...legacy, gateReason: null }]);
  });

  it("fails closed for a ready intent whose truck masses are missing", () => {
    expect(() =>
      read([
        {
          ...baseIntent,
          gateReason: null,
          truckMassOnArrivalKg: null,
          truckMassOnDepartureKg: null,
        },
      ]),
    ).toThrow(/older Biochar Application format/i);
  });
});
