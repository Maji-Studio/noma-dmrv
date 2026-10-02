/**
 * Parity for the exceptional removal-template bindings (#638): storage
 * components, measurement-sample inputs, component disambiguation and the
 * evidence targets of Isometric Sources. Moving them into the semantic binding
 * catalog must not change what they resolve to, and the Source binding
 * revision must not move (a moved revision supersedes every prior removal
 * version, like MAPPING_REVISION in semantic-binding-catalog.test.ts).
 *
 * The frozen values below are the pre-#638 outputs (staging @ 545228902).
 * Change them only together with an intentional binding change.
 */
import { describe, expect, it } from "vitest";
import {
  listOptionalRemovalEvidenceTargets,
  removalEvidenceRoleLabelsForTarget,
  SOURCE_BINDING_MAPPING_REVISION,
} from "@/lib/certification/removal-source-bindings";
import { readRemovalCandidateSources } from "@/fn/certification/removal-snapshot-readers";
import {
  classifySequestration1000YearComponent,
  expectedSequestrationBlueprintKeys,
  isSequestrationBlueprintFamily,
  isSequestrationBlueprintKey,
  selectSequestrationBlueprintKey,
} from "@/lib/isometric/storage-blueprints";
import {
  hasExplicitSequestrationBinding,
  SEQUESTRATION_COMPONENT_INPUT_BINDINGS,
  transformSequestrationSourceValue,
} from "@/lib/isometric/transformers/sequestration-binding";
import {
  lookupInputMapping,
  resolveDatapointSource,
} from "@/lib/isometric/transformers/datapoint";
import type { CertificationSubmissionRow } from "@/data-access/certification";
import {
  PYROLYSIS_DIESEL_SPLIT,
  SAFETY_MARGIN_CARVE_OUT,
  SEMANTIC_BINDING_CATALOG,
  type SemanticBindingCatalog,
} from "@/lib/isometric/semantic-binding-catalog";
import {
  projectEvidenceTargets,
  projectSequestrationInputBindings,
} from "@/lib/isometric/semantic-binding-projections";

const PRE_638_SOURCE_BINDING_MAPPING_REVISION =
  "61cf0d32ae78a9b1fe43165258a5ddbc819c0a3484f00fb99c043095450a4118";

const PRE_638_STORAGE_CLASSIFICATION = {
  "carbon_rich_substance_sequestration": {
    "recognised": false,
    "family": false,
    "classification1000": null,
    "explicitBinding": false,
    "expected200": false,
    "expected1000": false
  },
  "biochar_sequestration_200_year_c_org": {
    "recognised": true,
    "family": true,
    "classification1000": null,
    "explicitBinding": false,
    "expected200": true,
    "expected1000": false
  },
  "biochar_sequestration_200_year_unsampled": {
    "recognised": true,
    "family": true,
    "classification1000": null,
    "explicitBinding": false,
    "expected200": true,
    "expected1000": false
  },
  "biochar_sequestration_1000_year_f_durable_max": {
    "recognised": true,
    "family": true,
    "classification1000": "current",
    "explicitBinding": true,
    "expected200": false,
    "expected1000": true
  },
  "biochar_sequestration_1000_year": {
    "recognised": true,
    "family": true,
    "classification1000": "deprecated",
    "explicitBinding": false,
    "expected200": false,
    "expected1000": false
  },
  "biochar_sequestration_1000_year_unsampled": {
    "recognised": false,
    "family": true,
    "classification1000": "unsupported-unsampled",
    "explicitBinding": false,
    "expected200": false,
    "expected1000": false
  },
  "biochar_sequestration_future_variant": {
    "recognised": false,
    "family": true,
    "classification1000": null,
    "explicitBinding": false,
    "expected200": false,
    "expected1000": false
  }
};

const PRE_638_SELECTION = {
  "sampled": "biochar_sequestration_200_year_c_org",
  "unsampled": "biochar_sequestration_200_year_unsampled"
};

const PRE_638_DIESEL_ERROR =
  "The pyrolysis diesel component is not recognized. Rename it in Isometric to one of these names: \"generator diesel usage\", \"startup diesel usage\".";

const PRE_638_SEQUESTRATION_BINDINGS = {
  "biochar_sequestration_1000_year_f_durable_max": {
    "inputs": {
      "total_carbon_contents": {
        "dataShape": "LIST",
        "source": "measurement-property",
        "measurementProperty": {
          "quantity_kind": "mass_fraction_dry_basis",
          "qualifier": "total_carbon"
        },
        "sourceContract": {
          "nomaSource": "Sample totalCarbonPercent[]",
          "transformRevision": "percent-to-fraction-v1",
          "wireUnit": "dimensionless",
          "confirmation": "confirmed"
        }
      },
      "inorganic_carbon_contents": {
        "dataShape": "LIST",
        "source": "measurement-property",
        "measurementProperty": {
          "quantity_kind": "mass_fraction_dry_basis",
          "qualifier": "total_inorganic_carbon"
        },
        "sourceContract": {
          "nomaSource": "Sample inorganicCarbonPercent[]",
          "transformRevision": "percent-to-fraction-v1",
          "wireUnit": "dimensionless",
          "confirmation": "externally-unconfirmed"
        }
      },
      "product_mass": {
        "dataShape": "SCALAR",
        "source": "direct-datapoint",
        "valueSource": "credit-batch-product-mass",
        "quantityKind": "mass",
        "unit": "kg",
        "datapointType": "REPORTED",
        "sourceContract": {
          "nomaSource": "Attribution-scaled dry applied biochar mass",
          "transformRevision": "identity-v1",
          "wireUnit": "kg",
          "confirmation": "externally-unconfirmed"
        }
      },
      "s_fraction": {
        "dataShape": "LIST",
        "source": "measurement-property",
        "measurementProperty": {
          "quantity_kind": "dimensionless_ratio",
          "qualifier": "inertinite_fraction"
        },
        "sourceContract": {
          "nomaSource": "Sample sReflectanceFraction[]",
          "transformRevision": "identity-v1",
          "wireUnit": "dimensionless",
          "confirmation": "externally-unconfirmed"
        }
      }
    }
  }
};

const PRE_638_OPTIONAL_TARGETS = [
  {
    "groupKey": "miscellaneous",
    "componentBlueprintKey": "mass_based_ci_emissions",
    "componentDisplayName": "Safety margin",
    "inputKey": "mass",
    "nomaRoleLabel": "Inventory"
  },
  {
    "groupKey": "sampling-required-for-mrv",
    "componentBlueprintKey": "mass_distance_based_ci_emissions",
    "inputKey": "mass_distance",
    "nomaRoleLabel": "Transport evidence ledger"
  }
];

const PRE_638_ROLE_LABELS: Record<string, string[]> = {
  "co2-stored/carbon_rich_substance_sequestration//product_mass": [
    "Inventory"
  ],
  "co2-stored/carbon_rich_substance_sequestration//carbon_content": [],
  "co2-stored/biochar_sequestration_1000_year_f_durable_max//total_carbon_contents": [
    "Durability evidence ledger",
    "Sample lab report"
  ],
  "co2-stored/biochar_sequestration_200_year_c_org//total_carbon_contents": [
    "Durability evidence ledger",
    "Sample lab report"
  ],
  "co2-stored/biochar_sequestration_1000_year//total_carbon_contents": [
    "Durability evidence ledger",
    "Sample lab report"
  ],
  "co2-stored/biochar_sequestration_1000_year_f_durable_max//inorganic_carbon_contents": [
    "Durability evidence ledger",
    "Sample lab report"
  ],
  "co2-stored/biochar_sequestration_200_year_c_org//inorganic_carbon_contents": [
    "Durability evidence ledger",
    "Sample lab report"
  ],
  "co2-stored/biochar_sequestration_1000_year//inorganic_carbon_contents": [
    "Durability evidence ledger",
    "Sample lab report"
  ],
  "co2-stored/biochar_sequestration_1000_year_f_durable_max//product_mass": [
    "Durability evidence ledger",
    "Inventory"
  ],
  "co2-stored/biochar_sequestration_200_year_c_org//product_mass": [
    "Durability evidence ledger",
    "Inventory"
  ],
  "co2-stored/biochar_sequestration_1000_year//product_mass": [
    "Durability evidence ledger",
    "Inventory"
  ],
  "co2-stored/biochar_sequestration_1000_year_f_durable_max//s_fraction": [
    "Durability evidence ledger"
  ],
  "co2-stored/biochar_sequestration_200_year_c_org//s_fraction": [
    "Durability evidence ledger"
  ],
  "co2-stored/biochar_sequestration_1000_year//s_fraction": [
    "Durability evidence ledger"
  ],
  "co2-stored/biochar_sequestration_1000_year_f_durable_max//carbon_contents": [
    "Durability evidence ledger"
  ],
  "co2-stored/biochar_sequestration_200_year_c_org//carbon_contents": [
    "Durability evidence ledger"
  ],
  "co2-stored/biochar_sequestration_1000_year//carbon_contents": [
    "Durability evidence ledger"
  ],
  "co2-stored/biochar_sequestration_1000_year_f_durable_max//h_c_molar_ratios": [
    "Durability evidence ledger"
  ],
  "co2-stored/biochar_sequestration_200_year_c_org//h_c_molar_ratios": [
    "Durability evidence ledger"
  ],
  "co2-stored/biochar_sequestration_1000_year//h_c_molar_ratios": [
    "Durability evidence ledger"
  ],
  "biomass-feedstock-transport/mass_distance_based_ci_emissions//mass_distance": [
    "Feedstock bill of lading",
    "Transport evidence ledger"
  ],
  "biochar-transport/mass_distance_based_ci_emissions//mass_distance": [
    "Delivery bill of lading",
    "Transport evidence ledger"
  ],
  "sampling-required-for-mrv/mass_distance_based_ci_emissions//mass_distance": [
    "Transport evidence ledger"
  ],
  "miscellaneous/mass_based_ci_emissions/ SAFETY margin /mass": [
    "Inventory"
  ],
  "miscellaneous/mass_based_ci_emissions/Other/mass": [],
  "pyrolysis/fuel_usage_by_volume/Startup diesel usage/volume_of_fuel": []
};


describe("storage components", () => {
  it("classify every storage blueprint as before", () => {
    const classification = Object.fromEntries(
      Object.keys(PRE_638_STORAGE_CLASSIFICATION).map((key) => [
        key,
        {
          recognised: isSequestrationBlueprintKey(key),
          family: isSequestrationBlueprintFamily(key),
          classification1000: classifySequestration1000YearComponent(key),
          explicitBinding: hasExplicitSequestrationBinding(key),
          expected200: expectedSequestrationBlueprintKeys("200_year").has(key),
          expected1000: expectedSequestrationBlueprintKeys("1000_year").has(key),
        },
      ]),
    );
    expect(classification).toEqual(PRE_638_STORAGE_CLASSIFICATION);
  });

  it("select the 200-year blueprint by sampling as before", () => {
    expect({
      sampled: selectSequestrationBlueprintKey({ sampling: "sampled" }),
      unsampled: selectSequestrationBlueprintKey({ sampling: "unsampled" }),
    }).toEqual(PRE_638_SELECTION);
  });
});

describe("measurement-sample bindings", () => {
  it("project the pre-#638 sequestration input bindings", () => {
    expect(JSON.parse(JSON.stringify(SEQUESTRATION_COMPONENT_INPUT_BINDINGS))).toEqual(
      PRE_638_SEQUESTRATION_BINDINGS,
    );
  });

  it("live only in the storage group of a bound storage blueprint", () => {
    const totalCarbon =
      SEMANTIC_BINDING_CATALOG.biochar_sequestration_1000_year_f_durable_max.total_carbon_contents;
    const misplaced: SemanticBindingCatalog = {
      ...SEMANTIC_BINDING_CATALOG,
      biochar_sequestration_1000_year_f_durable_max: {
        total_carbon_contents: { roles: { pyrolysis: totalCarbon.roles["co2-stored"] } },
      },
    };
    expect(() => projectSequestrationInputBindings(misplaced)).toThrow(/bound storage blueprint/);
    const gated: SemanticBindingCatalog = {
      ...SEMANTIC_BINDING_CATALOG,
      biochar_sequestration_200_year_c_org: { total_carbon_contents: totalCarbon },
    };
    expect(() => projectSequestrationInputBindings(gated)).toThrow(/bound storage blueprint/);
  });

  it("apply the transform each binding declares", () => {
    const blueprint = "biochar_sequestration_1000_year_f_durable_max";
    expect(transformSequestrationSourceValue(blueprint, "total_carbon_contents", 62)).toBeCloseTo(0.62, 10);
    expect(transformSequestrationSourceValue(blueprint, "inorganic_carbon_contents", 3)).toBeCloseTo(0.03, 10);
    expect(transformSequestrationSourceValue(blueprint, "s_fraction", 0.4)).toBe(0.4);
    expect(transformSequestrationSourceValue(blueprint, "product_mass", 1200)).toBe(1200);
  });
});

describe("component disambiguation", () => {
  it("fails closed on an unrecognised pyrolysis diesel component with the same message", () => {
    const diesel = lookupInputMapping("pyrolysis", "fuel_usage_by_volume", "volume_of_fuel")!;
    expect(() => resolveDatapointSource(diesel, "Diesel")).toThrow(PRE_638_DIESEL_ERROR);
  });

  it("resolves the diesel split and the Safety margin through their named rules", () => {
    const diesel = lookupInputMapping("pyrolysis", "fuel_usage_by_volume", "volume_of_fuel")!;
    for (const [name, source] of Object.entries(PYROLYSIS_DIESEL_SPLIT.sources)) {
      expect(resolveDatapointSource(diesel, name)).toBe(source);
    }
    const margin = lookupInputMapping("miscellaneous", "mass_based_ci_emissions", "mass")!;
    for (const [name, source] of Object.entries(SAFETY_MARGIN_CARVE_OUT.sources)) {
      expect(resolveDatapointSource(margin, name)).toBe(source);
    }
  });

  it("rejects an evidence target on a component the role does not name", () => {
    const broken: SemanticBindingCatalog = {
      ...SEMANTIC_BINDING_CATALOG,
      mass_based_ci_emissions: {
        mass: {
          ...SEMANTIC_BINDING_CATALOG.mass_based_ci_emissions.mass,
          roles: {
            miscellaneous: {
              strategy: "aggregated-datapoint",
              source: "totalBiocharDryMassKg",
              bucket: "stored",
              disambiguation: SAFETY_MARGIN_CARVE_OUT,
              projectScopeCategory: "miscellaneous",
              evidence: [{ role: "inventory", component: "Overhead" }],
            },
          },
        },
      },
    };
    expect(() => projectEvidenceTargets(broken)).toThrow(/names component "Overhead"/);
  });
});

describe("Source evidence targets", () => {
  it("keep the Source binding revision", () => {
    expect(SOURCE_BINDING_MAPPING_REVISION).toBe(PRE_638_SOURCE_BINDING_MAPPING_REVISION);
  });

  it("keep the optional evidence targets", () => {
    expect(listOptionalRemovalEvidenceTargets()).toEqual(PRE_638_OPTIONAL_TARGETS);
  });

  it("label every template input with the same evidence roles", () => {
    const labels = Object.fromEntries(
      Object.keys(PRE_638_ROLE_LABELS).map((key) => {
        const [groupKey, componentBlueprintKey, componentDisplayName, inputKey] = key.split("/");
        return [
          key,
          removalEvidenceRoleLabelsForTarget({
            groupKey,
            componentBlueprintKey,
            componentDisplayName: componentDisplayName || undefined,
            inputKey,
          }),
        ];
      }),
    );
    expect(labels).toEqual(PRE_638_ROLE_LABELS);
  });
});

describe("persisted Source candidates", () => {
  const row = (target: Record<string, unknown>) =>
    ({
      payloadSnapshot: {
        semantic: {
          candidateSources: [
            {
              documentId: "doc_1",
              binding: {
                nomaRole: "inventory",
                nomaRoleLabel: "Inventory",
                lineage: { entityType: "application", entityId: "app_1", entityLabel: "APP-1" },
                intendedTarget: target,
                mappingRevision: "rev",
              },
            },
          ],
        },
      },
    }) as unknown as CertificationSubmissionRow;

  const PRE_638_SEQUESTRATION_INPUT_KEYS = [
    "product_mass",
    "carbon_contents",
    "s_fraction",
    "h_c_molar_ratios",
    "total_carbon_contents",
    "inorganic_carbon_contents",
  ];
  const PRE_638_ORDINARY_GROUP_KEYS = [
    "biomass-feedstock-transport",
    "biochar-transport",
    "sampling-required-for-mrv",
    "miscellaneous",
  ];
  const PRE_638_ORDINARY_BLUEPRINT_KEYS = ["mass_distance_based_ci_emissions", "mass_based_ci_emissions"];
  const PRE_638_ORDINARY_INPUT_KEYS = ["mass_distance", "mass"];

  it("accept the same sequestration input keys", () => {
    for (const inputKey of PRE_638_SEQUESTRATION_INPUT_KEYS) {
      expect(() =>
        readRemovalCandidateSources(row({ kind: "sequestration", groupKey: "co2-stored", inputKey })),
      ).not.toThrow();
    }
    expect(() =>
      readRemovalCandidateSources(row({ kind: "sequestration", groupKey: "co2-stored", inputKey: "carbon_content" })),
    ).toThrow();
    expect(() =>
      readRemovalCandidateSources(row({ kind: "sequestration", groupKey: "pyrolysis", inputKey: "product_mass" })),
    ).toThrow();
  });

  it("accept the same ordinary target keys", () => {
    for (const groupKey of PRE_638_ORDINARY_GROUP_KEYS) {
      for (const componentBlueprintKey of PRE_638_ORDINARY_BLUEPRINT_KEYS) {
        for (const inputKey of PRE_638_ORDINARY_INPUT_KEYS) {
          expect(() =>
            readRemovalCandidateSources(
              row({ kind: "ordinary", groupKey, componentBlueprintKey, inputKey }),
            ),
          ).not.toThrow();
        }
      }
    }
    for (const target of [
      { groupKey: "pyrolysis", componentBlueprintKey: "mass_based_ci_emissions", inputKey: "mass" },
      { groupKey: "miscellaneous", componentBlueprintKey: "fuel_usage_by_volume", inputKey: "mass" },
      { groupKey: "miscellaneous", componentBlueprintKey: "mass_based_ci_emissions", inputKey: "volume_of_fuel" },
    ]) {
      expect(() => readRemovalCandidateSources(row({ kind: "ordinary", ...target }))).toThrow();
    }
  });
});
