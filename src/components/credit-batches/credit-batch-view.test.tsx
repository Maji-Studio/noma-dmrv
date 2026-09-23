import type { ReactNode } from "react";
import { act, create, type ReactTestInstance, type ReactTestRenderer } from "react-test-renderer";
import { FormDetailControl, FormDetailProvider } from "@/components/forms/form-detail-context";
import { EntitySideSheetSections } from "@/components/ui/entity-side-sheet";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import type {
  CreditBatchProductionRunOption,
  CreditBatchWithRelations,
} from "@/data-access/credit-batches";
import { creditBatchSheetSections } from "./credit-batch-view";

vi.mock("next/link", () => ({ default: ({ children, href, ...props }: { children: ReactNode; href: string }) => <a href={href} {...props}>{children}</a> }));
// The real InfoHint mounts a floating-ui tooltip, which reads `window` on
// mount. These suites run in the node environment, so the hint renders as
// plain text here and its behaviour is covered by the tooltip's own tests.
vi.mock("@/components/ui/tooltip", () => ({
  InfoHint: ({ children, label }: { children: ReactNode; label: string }) => <span aria-label={label}>{children}</span>,
  Tooltip: ({ children }: { children: ReactNode }) => <span>{children}</span>,
}));

function makeRun(
  status: CreditBatchProductionRunOption["status"],
  index: number,
): CreditBatchProductionRunOption {
  return {
    id: `run-${index}`,
    code: `PR-26-00${index}`,
    date: `2026-05-${12 + index}`,
    status,
    biocharStorageName: "Moshi Raw Biochar Curing Pad",
    biocharOutputKg: status === "complete" ? 950 : null,
    biocharDryMassKg: status === "complete" ? 900 : null,
    feedstockMassDryKg: null,
    dieselOperationLiters: null,
    dieselGensetLiters: null,
    preprocessingFuelLiters: null,
    electricityKwh: null,
    feedstockTypeIds: ["feedstock-type-1"],
    assignedCreditBatchId: status === "complete" ? "batch-1" : null,
    assignedCreditBatchCode: status === "complete" ? "CB-26-001" : null,
  };
}

function makeBatch(
  overrides: Partial<CreditBatchWithRelations> = {},
): CreditBatchWithRelations {
  return {
    id: "batch-1",
    code: "CB-26-001",
    facilityId: "facility-1",
    productionRunCount: 1,
    appliedWeightTons: 0,
    co2eStoredPreview: null,
    feedstockTypeName: "Wood chips",
    durabilityOption: "1000_year",
    startDate: "2026-05-01",
    endDate: "2026-05-31",
    siteManagementNotes: null,
    ...overrides,
  } as CreditBatchWithRelations;
}

function makePreview(
  co2eStoredTonnes: number | null,
  missingInputs: string[],
): NonNullable<CreditBatchWithRelations["co2eStoredPreview"]> {
  return {
    provider: null,
    co2eStoredTonnes,
    componentKey: null,
    moduleVersion: null,
    formulaVersion: null,
    applicationResults: [],
    missingInputs,
    warnings: [],
  };
}

function carbonEstimateMarkup(
  options: Parameters<typeof creditBatchSheetSections>[0],
): string {
  const content = creditBatchSheetSections(options).find(
    (section) => section.title === "Production runs",
  )?.content;
  return renderToStaticMarkup(<>{content}</>);
}

const baseOptions = {
  productionRuns: [],
  isLoadingRuns: false,
  runsError: null,
  isRetryingRuns: false,
  onRetryRuns: () => {},
  isHealthLoading: false,
};

describe("credit batch CO₂e stored", () => {
  it("omits the field until a numeric preview is available", () => {
    expect(
      carbonEstimateMarkup({
        ...baseOptions,
        creditBatch: makeBatch(),
      }),
    ).not.toContain("t CO₂e");

    expect(
      carbonEstimateMarkup({
        ...baseOptions,
        creditBatch: makeBatch({
          co2eStoredPreview: makePreview(null, ["organicCarbonPercent"]),
        }),
      }),
    ).not.toContain("t CO₂e");
  });

  it("renders the figure once the preview resolves", () => {
    expect(
      carbonEstimateMarkup({
        ...baseOptions,
        creditBatch: makeBatch({
          co2eStoredPreview: makePreview(12.5, []),
        }),
      }),
    ).toContain("≈ 12.50 t CO₂e");
  });

  it("keeps loading production-run data distinct from missing inputs", () => {
    const html = carbonEstimateMarkup({
      ...baseOptions,
      creditBatch: makeBatch(),
      isLoadingRuns: true,
    });

    expect(html).toContain("Production inputs");
    expect(html).toContain("Loading…");
    expect(html).toContain('aria-busy="true"');
    expect(html).not.toContain("Feedstock dry mass");
  });

  it("explains when production-run data is unavailable", () => {
    const html = carbonEstimateMarkup({
      ...baseOptions,
      creditBatch: makeBatch(),
      runsError: new Error("request failed"),
    });

    expect(html).toContain("Not available");
    expect(html).toContain("Reload the production runs");
    expect(html).not.toContain("Feedstock dry mass");
  });

  it("discloses the raw and capped 1000-year durability calculation", () => {
    const preview = makePreview(12.5, []);
    preview.componentKey = "biochar_sequestration_1000_year_f_durable_max";
    preview.formulaVersion = "organic-carbon-cap-v1";
    preview.applicationResults = [{
      applicationId: "application-1",
      applicationCode: "APP-001",
      co2eStoredTonnes: 12.5,
      rawFDurable: 0.97,
      fDurable: 0.95,
      durabilityCapped: true,
      organicCarbonPercent: 79,
      effectiveSoilTemperatureC: null,
      missingInputs: [],
      warnings: [],
    }];
    const fields = creditBatchSheetSections({
      ...baseOptions,
      creditBatch: makeBatch({ co2eStoredPreview: preview }),
    }).find((section) => section.title === "Batch definition")?.fields;

    expect(fields).toEqual(expect.arrayContaining([
      expect.objectContaining({ label: "Raw durability estimate", value: "97.0%" }),
      expect.objectContaining({ label: "Capped durability estimate", value: "95.0%" }),
      expect.objectContaining({ label: "Durability cap applied", value: "Yes" }),
      expect.objectContaining({ label: "Preview formula", value: "organic-carbon-cap-v1" }),
    ]));
  });
});

describe("credit batch production-run preview", () => {
  it("labels draft and running previews without labeling completed members", () => {
    const creditBatch = {
      id: "batch-1",
      code: "CB-26-001",
      facilityId: "facility-1",
      productionRunCount: 1,
      appliedWeightTons: 0,
      co2eStoredPreview: null,
      feedstockTypeName: "Wood chips",
      durabilityOption: "1000_year",
      startDate: "2026-05-01",
      endDate: "2026-05-31",
      siteManagementNotes: null,
    } as CreditBatchWithRelations;
    const sections = creditBatchSheetSections({
      creditBatch,
      productionRuns: [
        makeRun("draft", 1),
        makeRun("running", 2),
        makeRun("complete", 3),
      ],
      isLoadingRuns: false,
      runsError: null,
      isRetryingRuns: false,
      onRetryRuns: vi.fn(),
      isHealthLoading: false,
    });
    const runsSection = sections.find(
      (section) => section.title === "Production runs",
    );
    const html = renderToStaticMarkup(<>{runsSection?.content}</>);

    expect(html).not.toContain("PR-26-001");
    expect(html).not.toContain("PR-26-002");
    expect(html).not.toContain("PR-26-003");
    expect(html).toContain("May 13, 2026");
    expect(html).toContain("Moshi Raw Biochar Curing Pad");
    expect(html).toContain("Draft");
    expect(html).toContain("Running");
    expect(html).not.toContain('data-status="complete"');
  });
});

function visibleText(node: ReactTestInstance | string): string {
  return typeof node === "string" ? node : node.props.hidden ? "" : node.children.map(visibleText).join(" ");
}
it("keeps saved fields and the carbon estimate figure in Simple while calculation rows are Detailed only", async () => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  const preview = makePreview(12.5, []);
  preview.applicationResults = [{ applicationId: "app", applicationCode: "APP-001", co2eStoredTonnes: 12.5, rawFDurable: 0.97, fDurable: 0.95, durabilityCapped: true, organicCarbonPercent: 79, effectiveSoilTemperatureC: null, missingInputs: [], warnings: [] }];
  const sections = creditBatchSheetSections({ ...baseOptions, creditBatch: makeBatch({ co2eStoredPreview: preview, productionEmissionsClaimedByRemovalId: "removal-1" }) });
  let renderer!: ReactTestRenderer;
  await act(async () => { renderer = create(<FormDetailProvider scope="batch"><FormDetailControl /><EntitySideSheetSections sections={sections} /></FormDetailProvider>); });
  const simple = visibleText(renderer.root);
  for (const label of ["Carbon ledger", "Show calculation", "Feedstock dry mass", "Applied biochar", "Capped durability estimate", "Raw durability estimate", "Preview formula"]) expect(simple).not.toContain(label);
  // The estimate closes the Production runs section and Simple keeps its figure.
  expect(simple).toContain("Carbon estimate, before project emissions");
  expect(simple).toContain("≈ 12.50 t CO₂e");
  expect(simple.indexOf("Production runs")).toBeLessThan(simple.indexOf("≈ 12.50 t CO₂e"));
  expect(sections.map(section => section.title)).not.toContain("Carbon ledger");
  expect(simple).toContain("Wood chips");
  expect(simple).toContain("Production emissions included in Removal");
  await act(async () => renderer.root.findAllByType("input").find(node => node.props.value === "detailed")!.props.onChange());
  const detailed = visibleText(renderer.root);
  expect(detailed).toContain("12.50");
  // Detailed no longer hides recorded fields behind a disclosure; they are rows.
  expect(detailed).toContain("Capped durability estimate");
  expect(detailed).toContain("Applied biochar");
  expect(detailed).not.toContain("Preview authority");
  await act(async () => renderer.unmount());
});

it("leads the carbon estimate with the figure and keeps the input quantities behind the calculation", async () => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  const content = creditBatchSheetSections({
    ...baseOptions,
    creditBatch: makeBatch({ co2eStoredPreview: makePreview(12.5, []) }),
    productionRuns: [makeRun("complete", 1)],
  }).find((section) => section.title === "Production runs")?.content;
  let renderer!: ReactTestRenderer;
  await act(async () => { renderer = create(<>{content}</>); });
  const shown = visibleText(renderer.root);
  // The caption names the figure, and the one headline figure follows it.
  expect(shown).toContain("Carbon estimate, before project emissions");
  expect(shown).toContain("≈ 12.50 t CO₂e");
  expect(shown).toContain("The registry result is authoritative.");
  // The runs are listed right above, so the block repeats no source-run links.
  expect(shown).not.toContain("Source runs");
  // The per-input quantities are the arithmetic behind the figure, not a
  // second list competing with it.
  expect(shown).not.toContain("Feedstock dry mass");
  const disclosure = renderer.root.findAllByType("button").find(node => node.props["aria-controls"])!;
  await act(async () => disclosure.props.onClick());
  const disclosed = visibleText(renderer.root);
  expect(disclosed).toContain("Feedstock dry mass");
  expect(disclosed).toContain("Grid electricity");
  expect(disclosed).toContain("These inputs are not in the estimate.");
  await act(async () => renderer.unmount());
});

it.each([
  [["facilityCertifierProject"], "No certifier project is linked to this facility."],
  [["applicationIds", "thousandYearReplicates"], "No applications recorded for this batch yet."],
  [["organicCarbonPercent", "soilTemperatureC"], "Missing: Organic carbon content, Soil temperature."],
])("says why the carbon estimate is not available (%j)", (missingInputs, reason) => {
  const markup = carbonEstimateMarkup({
    ...baseOptions,
    creditBatch: makeBatch({ co2eStoredPreview: makePreview(null, missingInputs) }),
  });
  expect(markup).toContain(reason);
});
