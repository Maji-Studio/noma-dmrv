import { describe, expect, it } from "vitest";
import {
  buildRemovalSourceDescription,
  buildRemovalSourceBindingPlan,
  classifyRemovalSourceCandidate,
  sourceIdsForDatapointTarget,
  SOURCE_BINDING_MAPPING_REVISION,
} from "./removal-source-bindings";

const application = {
  entityType: "application",
  entityId: "application-1",
  entityLabel: "Application APP-001",
} as const;

describe("classifyRemovalSourceCandidate", () => {
  it("maps an application Inventory role to sequestration product_mass", () => {
    expect(
      classifyRemovalSourceCandidate({
        documentType: "pdf",
        metadata: { logbookEvidenceType: "inventory" },
        lineage: application,
      }),
    ).toEqual({
      nomaRole: "inventory",
      nomaRoleLabel: "Inventory",
      lineage: application,
      intendedTarget: {
        kind: "sequestration",
        groupKey: "co2-stored",
        inputKey: "product_mass",
      },
      mappingRevision: SOURCE_BINDING_MAPPING_REVISION,
    });
  });

  it.each([
    {
      lineage: {
        entityType: "feedstock",
        entityId: "feedstock-1",
        entityLabel: "Feedstock FS-001",
      },
      expectedRole: "feedstock_bill_of_lading",
      expectedGroup: "biomass-feedstock-transport",
    },
    {
      lineage: {
        entityType: "delivery",
        entityId: "delivery-1",
        entityLabel: "Delivery DEL-001",
      },
      expectedRole: "delivery_bill_of_lading",
      expectedGroup: "biochar-transport",
    },
  ] as const)(
    "maps $expectedRole to its mass_distance target",
    ({ lineage, expectedRole, expectedGroup }) => {
      const binding = classifyRemovalSourceCandidate({
        documentType: "bill_of_lading",
        metadata: {},
        lineage,
      });

      expect(binding).toMatchObject({
        nomaRole: expectedRole,
        intendedTarget: {
          kind: "ordinary",
          groupKey: expectedGroup,
          componentBlueprintKey: "mass_distance_based_ci_emissions",
          inputKey: "mass_distance",
        },
      });
    },
  );

  it("does not reinterpret a provider file type as the Inventory Noma role", () => {
    expect(
      classifyRemovalSourceCandidate({
        documentType: "bill_of_lading",
        metadata: {},
        lineage: application,
      }),
    ).toBeNull();
  });

  it("excludes production-run readings telemetry from Removal evidence", () => {
    expect(
      classifyRemovalSourceCandidate({
        documentType: "sensor_data",
        metadata: {},
        lineage: {
          entityType: "production_run",
          entityId: "run-1",
          entityLabel: "Production run PR-001",
        },
      }),
    ).toBeNull();
  });
});

describe("buildRemovalSourceDescription", () => {
  it("includes the canonical Noma role and lineage", () => {
    const binding = classifyRemovalSourceCandidate({
      documentType: "pdf",
      metadata: { logbookEvidenceType: "inventory" },
      lineage: application,
    });

    expect(binding).not.toBeNull();
    expect(buildRemovalSourceDescription(binding!)).toBe(
      "Noma role: Inventory. Lineage: Application APP-001.",
    );
  });
});

describe("buildRemovalSourceBindingPlan", () => {
  const template = {
    groups: [
      {
        key: "co2-stored",
        components: [
          {
            id: "component-sequestration",
            blueprint_key: "carbon_rich_substance_sequestration",
            inputs: [{ input_key: "product_mass" }],
          },
        ],
      },
      {
        key: "biomass-feedstock-transport",
        components: [
          {
            id: "component-feedstock-transport",
            blueprint_key: "mass_distance_based_ci_emissions",
            inputs: [{ input_key: "mass_distance" }],
          },
        ],
      },
      {
        key: "biochar-transport",
        components: [
          {
            id: "component-biochar-transport",
            blueprint_key: "mass_distance_based_ci_emissions",
            inputs: [{ input_key: "mass_distance" }],
          },
        ],
      },
      {
        key: "pyrolysis",
        components: [
          {
            id: "component-unrelated",
            blueprint_key: "grid_electricity_use",
            inputs: [{ input_key: "electricity_use" }],
          },
        ],
      },
    ],
  };

  const classified = [
    {
      documentId: "document-inventory",
      sourceId: "source-inventory",
      binding: classifyRemovalSourceCandidate({
        documentType: "pdf",
        metadata: { logbookEvidenceType: "inventory" },
        lineage: application,
      })!,
    },
    {
      documentId: "document-feedstock",
      sourceId: "source-feedstock",
      binding: classifyRemovalSourceCandidate({
        documentType: "bill_of_lading",
        metadata: {},
        lineage: {
          entityType: "feedstock",
          entityId: "feedstock-1",
          entityLabel: "Feedstock FS-001",
        },
      })!,
    },
    {
      documentId: "document-delivery",
      sourceId: "source-delivery",
      binding: classifyRemovalSourceCandidate({
        documentType: "bill_of_lading",
        metadata: {},
        lineage: {
          entityType: "delivery",
          entityId: "delivery-1",
          entityLabel: "Delivery DEL-001",
        },
      })!,
    },
  ];

  it("persists source identity, Noma role, lineage, target, and revision", () => {
    const plan = buildRemovalSourceBindingPlan({
      candidates: classified,
      template: template as never,
    });

    expect(plan).toContainEqual({
      documentId: "document-inventory",
      sourceId: "source-inventory",
      nomaRole: "inventory",
      lineage: application,
      intendedTarget: {
        kind: "sequestration",
        groupKey: "co2-stored",
        componentId: "component-sequestration",
        componentBlueprintKey: "carbon_rich_substance_sequestration",
        inputKey: "product_mass",
      },
      mappingRevision: SOURCE_BINDING_MAPPING_REVISION,
    });
  });

  it("gives ordinary datapoints only their targeted Source IDs", () => {
    const plan = buildRemovalSourceBindingPlan({
      candidates: classified,
      template: template as never,
    });

    expect(
      sourceIdsForDatapointTarget(plan, {
        componentId: "component-feedstock-transport",
        inputKey: "mass_distance",
      }),
    ).toEqual(["source-feedstock"]);
    expect(
      sourceIdsForDatapointTarget(plan, {
        componentId: "component-biochar-transport",
        inputKey: "mass_distance",
      }),
    ).toEqual(["source-delivery"]);
    expect(
      sourceIdsForDatapointTarget(plan, {
        componentId: "component-unrelated",
        inputKey: "electricity_use",
      }),
    ).toEqual([]);
  });
});
