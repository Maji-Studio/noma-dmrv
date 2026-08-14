import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import type { RemovalTemplateDiagnosticModel } from "@/lib/certification/removal-template-diagnostic";
import { RemovalTemplateLineageView } from "./removal-template-lineage-view";
import { RemovalTemplateMappingView } from "./removal-template-mapping-view";

const model: RemovalTemplateDiagnosticModel = {
  template: {
    id: "rvt-1",
    displayName: "Current Removal template",
    creditType: "REMOVAL",
    mappingRevision: "mapping-revision",
  },
  aggregateStatus: "drift",
  templateIssues: [],
  counts: {
    mapped: 0,
    "registry-owned-fixed": 0,
    "optional-not-present": 0,
    "missing-noma-mapping": 0,
    "unsupported-component": 0,
    "template-contract-drift": 0,
    "externally-unconfirmed-contract": 1,
    "deprecated-incompatible": 0,
  },
  optionalNotPresent: [],
  groups: [
    {
      label: "CO2 stored",
      key: "co2-stored",
      rawId: "rtg-1",
      components: [
        {
          label: "Biochar sequestration, 1000 year durability",
          blueprintKey: "biochar_sequestration_1000_year_f_durable_max",
          status: "externally-unconfirmed-contract",
          statusDetail: "Isometric confirmation is pending.",
          raw: { componentId: "rtc-1", groupId: "rtg-1" },
          inputs: [
            {
              label: "Inorganic carbon contents",
              inputKey: "inorganic_carbon_contents",
              presentInTemplate: true,
              expected: {
                dataShape: "LIST",
                quantityKind: "mass_fraction_dry_basis",
                unit: "dimensionless",
              },
              nomaSource: "Sample inorganicCarbonPercent[]",
              transform: "Divide by 100",
              wirePath:
                "/measurement-samples.values[] -> /ghg-entries.ghg_entry_template_components[].inputs[]",
              evidenceRoles: ["Durability evidence ledger"],
              status: "externally-unconfirmed-contract",
              statusDetail: "Isometric confirmation is pending.",
              resolved: null,
              resolutionContract: {
                kind: "measurement-property",
                property: {
                  quantity_kind: "mass_fraction_dry_basis",
                  qualifier: "total_inorganic_carbon",
                },
              },
              raw: {
                templateId: "rvt-1",
                groupId: "rtg-1",
                groupKey: "co2-stored",
                componentId: "rtc-1",
                blueprintKey:
                  "biochar_sequestration_1000_year_f_durable_max",
                fixedDatapointId: null,
              },
            },
          ],
        },
      ],
    },
  ],
};

describe("Removal template diagnostic views", () => {
  it("renders the matrix fields and keeps raw identifiers in disclosures", () => {
    const html = renderToStaticMarkup(
      <RemovalTemplateMappingView model={model} />,
    );

    for (const expected of [
      "Template input",
      "Expected",
      "noma dMRV source",
      "Submission wire path",
      "Evidence role",
      "Inorganic carbon contents",
      "inorganic_carbon_contents",
      "Sample inorganicCarbonPercent[]",
      "Divide by 100",
      "Externally unconfirmed",
      "Raw group identifiers",
      "Raw component identifiers",
    ]) {
      expect(html).toContain(expected);
    }
    expect(html.indexOf("Raw group identifiers")).toBeLessThan(
      html.indexOf("rtg-1"),
    );
  });

  it("renders the same row as a three-stage lineage", () => {
    const html = renderToStaticMarkup(
      <RemovalTemplateLineageView model={model} />,
    );

    expect(html).toContain("noma dMRV source");
    expect(html).toContain("Transform and wire preparation");
    expect(html).toContain("Isometric destination");
    expect(html).toContain("Sample inorganicCarbonPercent[]");
    expect(html).toContain("inorganic_carbon_contents");
  });
});
