import type { IsometricGhgEntryTemplate } from "@/lib/isometric";
import { CURRENT_SEQUESTRATION_BLUEPRINT_1000_YEAR } from "@/lib/isometric/storage-blueprints";

// Removal templates for the submit-removal orchestrator fixture. Split out of
// submit-removal-orchestrator.ts (which re-exports them) to keep that file
// under the repository's 1000-line cap.

export const TEMPLATE_ID = "rvt_test_1";
export const RTC_PRODUCT_MASS_ID = "rtc-product-mass";

// ---------------------------------------------------------------------------
// Domain fixtures — a one-component template and a single production run.
// Choosing `product_mass` keeps the test independent of transport legs and
// the per-stage energy split (which need their own fixtures).
// ---------------------------------------------------------------------------

export function makeTemplate(): IsometricGhgEntryTemplate {
  return {
    id: TEMPLATE_ID,
    name: "Test removal template",
    display_name: "Test removal template",
    // submitRemoval refuses non-REMOVAL templates (credit_type guard).
    credit_type: "REMOVAL",
    groups: [
      {
        id: "grp-1",
        key: "co2-stored",
        name: "CO2 stored",
        components: [
          {
            id: RTC_PRODUCT_MASS_ID,
            blueprint_key: "carbon_rich_substance_sequestration",
            display_name: "Sequestered biochar",
            inputs: [
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

// A template that routes durability through the unverified 200-year
// measurement-samples path. submitRemoval keeps it fail-closed until the
// remaining H/C unit and binding contract is confirmed.
export function makeSequestrationTemplate(): IsometricGhgEntryTemplate {
  return {
    id: TEMPLATE_ID,
    name: "Durability template",
    display_name: "Durability template",
    credit_type: "REMOVAL",
    groups: [
      {
        id: "grp-seq",
        key: "co2-stored",
        name: "Durable storage",
        components: [
          {
            id: "rtc-seq",
            blueprint_key: "biochar_sequestration_200_year_c_org",
            display_name: "200-year sequestration",
            inputs: [
              {
                type: "monitored",
                input_key: "h_c_molar_ratios",
                datapoint_id: null,
                display_name: "H/C molar ratios",
                quantity_kind: "dimensionless_ratio",
              },
            ],
          },
        ],
      },
    ],
  } as unknown as IsometricGhgEntryTemplate;
}

export function make1000YearSequestrationTemplate(): IsometricGhgEntryTemplate {
  const base = makeSequestrationTemplate();
  return {
    ...base,
    name: "1000-year durability template",
    display_name: "1000-year durability template",
    groups: base.groups.map((group) => ({
      ...group,
      components: group.components.map((component) => ({
        ...component,
        blueprint_key: CURRENT_SEQUESTRATION_BLUEPRINT_1000_YEAR,
        display_name: "1000-year sequestration",
        inputs: [
          {
            type: "monitored",
            input_key: "total_carbon_contents",
            quantity_kind: "mass_fraction_dry_basis",
            datapoint_id: null,
          },
          {
            type: "monitored",
            input_key: "inorganic_carbon_contents",
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
            quantity_kind: "dimensionless_ratio",
            datapoint_id: null,
          },
        ],
      })),
    })),
  } as unknown as IsometricGhgEntryTemplate;
}
