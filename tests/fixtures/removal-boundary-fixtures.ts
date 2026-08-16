import type {
  IsometricComponentBlueprint,
  IsometricGhgEntryTemplate,
} from "@/lib/isometric";

export const TEMPLATE_ID = "rvt_boundary_1";
export const RTC_ID = "rtc-seq";
export const APPLICATION_ID = "a0000000-0000-4000-8000-000000000001";

export function makeBoundarySourceDocument() {
  return {
    documentId: "doc-boundary-1",
    binding: {
      nomaRole: "inventory" as const,
      nomaRoleLabel: "Inventory",
      lineage: {
        entityType: "application",
        entityId: APPLICATION_ID,
        entityLabel: "Application APP-BD-001",
      },
      intendedTarget: {
        kind: "sequestration" as const,
        groupKey: "co2-stored" as const,
        inputKey: "product_mass" as const,
      },
      mappingRevision: "source-binding-boundary-revision",
    },
  };
}

export function makeTemplate(): IsometricGhgEntryTemplate {
  return {
    id: TEMPLATE_ID,
    name: "Boundary removal template",
    display_name: "Boundary removal template",
    credit_type: "REMOVAL",
    groups: [
      {
        id: "grp-1",
        key: "co2-stored",
        name: "CO2 stored",
        components: [
          {
            id: RTC_ID,
            blueprint_key: "carbon_rich_substance_sequestration",
            display_name: "Sequestered biochar",
            inputs: [
              {
                type: "monitored",
                input_key: "carbon_content",
                datapoint_id: null,
                display_name: "Carbon content",
                quantity_kind: "dimensionless",
              },
              {
                type: "monitored",
                input_key: "product_mass",
                datapoint_id: null,
                display_name: "Product mass",
                quantity_kind: "mass",
              },
            ],
          },
        ],
      },
    ],
  } as unknown as IsometricGhgEntryTemplate;
}

export function makeBlueprints(): IsometricComponentBlueprint[] {
  return [
    {
      key: "carbon_rich_substance_sequestration",
      display_name: "Carbon-rich substance sequestration",
      description: "",
      inputs: [
        {
          input_key: "carbon_content",
          quantity_kind: "dimensionless",
          compatible_unit: "dimensionless",
          data_shape: "SCALAR",
          description: "",
        },
        {
          input_key: "product_mass",
          quantity_kind: "mass",
          compatible_unit: "kg",
          data_shape: "SCALAR",
          description: "",
        },
      ],
    } as unknown as IsometricComponentBlueprint,
  ];
}
