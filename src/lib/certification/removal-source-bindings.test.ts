import { describe, expect, it } from "vitest";
import {
  buildRemovalSourceDescription,
  buildRemovalSourceBindingPlan,
  classifyRemovalSourceCandidate,
  sourceIdsForDatapointTarget,
  SOURCE_BINDING_MAPPING_REVISION,
} from "./removal-source-bindings";
import {
  APPLICATION_BOUNDARY_LOGBOOK_EVIDENCE_TYPES,
  APPLICATION_BOUNDARY_LOGBOOK_UNCONDITIONAL_DOCUMENT_TYPES,
} from "./application-evidence";

const application = {
  entityType: "application",
  entityId: "application-1",
  entityLabel: "Application APP-001",
} as const;

describe("classifyRemovalSourceCandidate", () => {
  it.each(APPLICATION_BOUNDARY_LOGBOOK_EVIDENCE_TYPES)(
    "maps an application %s logbook subtype to sequestration product_mass",
    (logbookEvidenceType) => {
      expect(
        classifyRemovalSourceCandidate({
          documentType: "pdf",
          metadata: { logbookEvidenceType },
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
        additionalIntendedTargets: [
          {
            kind: "ordinary",
            groupKey: "miscellaneous",
            componentBlueprintKey: "mass_based_ci_emissions",
            componentDisplayName: "Safety margin",
            inputKey: "mass",
            optionalInTemplate: true,
          },
        ],
        mappingRevision: SOURCE_BINDING_MAPPING_REVISION,
      });
    },
  );

  it.each(APPLICATION_BOUNDARY_LOGBOOK_UNCONDITIONAL_DOCUMENT_TYPES)(
    "maps an application %s document to sequestration product_mass",
    (documentType) => {
      expect(
        classifyRemovalSourceCandidate({
          documentType,
          metadata: {},
          lineage: application,
        }),
      ).toMatchObject({
        nomaRole: "inventory",
        intendedTarget: {
          kind: "sequestration",
          groupKey: "co2-stored",
          inputKey: "product_mass",
        },
      });
    },
  );

  it("does not map a generic application PDF without a logbook subtype", () => {
    expect(
      classifyRemovalSourceCandidate({
        documentType: "pdf",
        metadata: {},
        lineage: application,
      }),
    ).toBeNull();
  });

  it("keeps GIS boundary evidence separate from product-mass Sources", () => {
    expect(
      classifyRemovalSourceCandidate({
        documentType: "gis_boundary",
        metadata: { logbookEvidenceType: "inventory" },
        lineage: application,
      }),
    ).toBeNull();
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
  const applicationIdsByCreditBatchId = new Map([
    ["credit-batch-1", ["application-1"]],
  ]);

  it("persists source identity, Noma role, lineage, target, and revision", () => {
    const plan = buildRemovalSourceBindingPlan({
      candidates: classified,
      template: template as never,
      applicationIdsByCreditBatchId,
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
        creditBatchIds: ["credit-batch-1"],
      },
      mappingRevision: SOURCE_BINDING_MAPPING_REVISION,
    });
  });

  it("binds the Inventory Source to the optional Safety margin mass input", () => {
    const templateWithSafetyMargin = {
      ...template,
      groups: [
        ...template.groups,
        {
          key: "miscellaneous",
          components: [
            {
              id: "component-safety-margin",
              blueprint_key: "mass_based_ci_emissions",
              display_name: "  SAFETY Margin  ",
              inputs: [{ input_key: "mass" }],
            },
          ],
        },
      ],
    };
    const plan = buildRemovalSourceBindingPlan({
      candidates: [classified[0]],
      template: templateWithSafetyMargin as never,
      applicationIdsByCreditBatchId,
    });

    expect(plan).toContainEqual({
      documentId: "document-inventory",
      sourceId: "source-inventory",
      nomaRole: "inventory",
      lineage: application,
      intendedTarget: {
        kind: "ordinary",
        groupKey: "miscellaneous",
        componentId: "component-safety-margin",
        componentBlueprintKey: "mass_based_ci_emissions",
        inputKey: "mass",
        creditBatchIds: [],
      },
      mappingRevision: SOURCE_BINDING_MAPPING_REVISION,
    });
  });

  it("skips the optional Safety margin target when miscellaneous is empty", () => {
    const templateWithEmptyMiscellaneous = {
      ...template,
      groups: [
        ...template.groups,
        { key: "miscellaneous", components: [] },
      ],
    };

    expect(
      buildRemovalSourceBindingPlan({
        candidates: [classified[0]],
        template: templateWithEmptyMiscellaneous as never,
        applicationIdsByCreditBatchId,
      }),
    ).toHaveLength(1);
  });

  it("does not bind Inventory to a renamed singleton sandbox component", () => {
    const templateWithRenamedMargin = {
      ...template,
      groups: [
        ...template.groups,
        {
          key: "miscellaneous",
          components: [
            {
              id: "component-renamed-margin",
              blueprint_key: "mass_based_ci_emissions",
              display_name: "Renamed margin",
              inputs: [{ input_key: "mass" }],
            },
          ],
        },
      ],
    };

    const plan = buildRemovalSourceBindingPlan({
      candidates: [classified[0]],
      template: templateWithRenamedMargin as never,
      applicationIdsByCreditBatchId,
    });

    expect(plan).toHaveLength(1);
    expect(
      plan.some(
        (entry) =>
          entry.intendedTarget.componentId === "component-renamed-margin",
      ),
    ).toBe(false);
  });

  it("fails closed when more than one miscellaneous mass component matches", () => {
    const ambiguousTemplate = {
      ...template,
      groups: [
        ...template.groups,
        {
          key: "miscellaneous",
          components: [
            {
              id: "component-safety-margin-1",
              blueprint_key: "mass_based_ci_emissions",
              display_name: "Safety margin",
              inputs: [{ input_key: "mass" }],
            },
            {
              id: "component-safety-margin-2",
              blueprint_key: "mass_based_ci_emissions",
              display_name: " safety MARGIN ",
              inputs: [{ input_key: "mass" }],
            },
          ],
        },
      ],
    };

    expect(() =>
      buildRemovalSourceBindingPlan({
        candidates: [classified[0]],
        template: ambiguousTemplate as never,
        applicationIdsByCreditBatchId,
      }),
    ).toThrow(/expected exactly one/i);
  });

  it("gives ordinary datapoints only their targeted Source IDs", () => {
    const plan = buildRemovalSourceBindingPlan({
      candidates: classified,
      template: template as never,
      applicationIdsByCreditBatchId,
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

  it("fails closed when Inventory lineage does not resolve to a credit batch", () => {
    expect(() =>
      buildRemovalSourceBindingPlan({
        candidates: [classified[0]],
        template: template as never,
        applicationIdsByCreditBatchId: new Map([
          ["credit-batch-1", ["another-application"]],
        ]),
      }),
    ).toThrow(/does not resolve to a Removal credit batch/i);
  });

  it("binds one transport ledger Source to every matching transport Datapoint", () => {
    const binding = classifyRemovalSourceCandidate({
      documentType: "pdf",
      metadata: {
        kind: "transport_evidence_ledger",
        removalId: "removal-1",
      },
      lineage: {
        entityType: "credit_batch",
        entityId: "credit-batch-1",
        entityLabel: "Credit batch CB-001",
      },
      removalId: "removal-1",
    });

    const plan = buildRemovalSourceBindingPlan({
      candidates: [
        {
          documentId: "document-transport-ledger",
          sourceId: "source-transport-ledger",
          binding: binding!,
        },
      ],
      template: template as never,
      applicationIdsByCreditBatchId,
    });

    expect(
      plan.map((entry) => entry.intendedTarget.groupKey),
    ).toEqual([
      "biochar-transport",
      "biomass-feedstock-transport",
    ]);
    expect(
      sourceIdsForDatapointTarget(plan, {
        componentId: "component-unrelated",
        inputKey: "electricity_use",
      }),
    ).toEqual([]);
  });

  it("binds a 1000-year durability ledger to the member credit batch inputs", () => {
    const binding = classifyRemovalSourceCandidate({
      documentType: "pdf",
      metadata: {
        kind: "durability_evidence_ledger",
        removalId: "removal-1",
        durabilityOption: "1000_year",
      },
      lineage: {
        entityType: "credit_batch",
        entityId: "credit-batch-1",
        entityLabel: "Credit batch CB-001",
      },
      removalId: "removal-1",
    });
    const durabilityTemplate = {
      groups: [
        {
          key: "co2-stored",
          components: [
            {
              id: "component-sequestration",
              blueprint_key: "biochar_sequestration_1000_year_f_durable_max",
              inputs: [
                { input_key: "total_carbon_contents" },
                { input_key: "inorganic_carbon_contents" },
                { input_key: "product_mass" },
                { input_key: "s_fraction" },
              ],
            },
          ],
        },
      ],
    };

    const plan = buildRemovalSourceBindingPlan({
      candidates: [
        {
          documentId: "document-durability-ledger",
          sourceId: "source-durability-ledger",
          binding: binding!,
        },
      ],
      template: durabilityTemplate as never,
      applicationIdsByCreditBatchId,
    });

    expect(plan.map((entry) => entry.intendedTarget.inputKey)).toEqual([
      "inorganic_carbon_contents",
      "product_mass",
      "s_fraction",
      "total_carbon_contents",
    ]);
    expect(
      plan.every((entry) =>
        entry.intendedTarget.creditBatchIds.includes("credit-batch-1"),
      ),
    ).toBe(true);
  });
});
