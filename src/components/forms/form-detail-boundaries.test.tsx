import { act, create, type ReactTestRenderer, type ReactTestInstance } from "react-test-renderer";
import { beforeAll, describe, expect, it, vi } from "vitest";
import type { ReactNode } from "react";

// The real InfoHint mounts a floating-ui tooltip, which reads `window` on
// mount, and these suites run in the node environment. The hint's own
// behaviour is covered by the tooltip tests; here it is inert.
vi.mock("@/components/ui/tooltip", () => ({
  InfoHint: ({ label }: { children: ReactNode; label: string }) => <span aria-label={label} />,
  Tooltip: ({ children }: { children: ReactNode }) => <span>{children}</span>,
}));
vi.mock("next/link", () => ({ default: ({ children, href }: { children: ReactNode; href: string }) => <a href={href}>{children}</a> }));
vi.mock("@/hooks/use-facility-context", () => ({ useFacilityContext: () => ({ facilities: [{ id: "facility", timezone: "UTC" }] }) }));
vi.mock("@/hooks/use-entities", () => ({ useEntityOptions: () => ({ data: [] }) }));
vi.mock("@/components/storage-locations/output-stock-history", () => ({ OutputStockHistory: () => <button type="button">Stock history</button> }));
vi.mock("@/hooks/use-output-stock", () => ({
  useMatchingOutputBins: () => ({ data: [{ id: "bin", code: "PB-001", name: "Product bin", dryMassKg: 1500, recordedWetMassKg: null, estimatedWetMassKg: null }], isLoading: false, error: null }),
  useOutputStockPreview: () => ({ data: undefined, isLoading: false, error: null }),
  useOutputStockHistory: () => ({ data: [{ id: "entry", deliveryId: "delivery", kind: "delivery", physicalDate: "2026-09-22", recordedAt: "2026-09-22", actorName: null, reason: "Recorded", correctsMovementId: null, wetMassKg: 100, moisturePercent: 20, dryMassKg: 80, beforeDryKg: 200, afterDryKg: 120, allocations: [{ layerId: "batch", code: "B-001", wetMassKg: null, dryMassKg: 80, runs: [] }] }], isLoading: false, error: null }),
}));
// Only the blend block is under test on the formulation form; the material
// selector needs a query client this suite does not provide.
vi.mock("@/components/forms/entity-select", async (importOriginal) => ({
  ...await importOriginal<typeof import("@/components/forms/entity-select")>(),
  FormEntitySelect: () => <span>Blend material</span>,
}));
import { SpineSectionStatic } from "./form-spine";
import { FormDetailControl, FormDetailProvider } from "./form-detail-context";
import { OutputStockPreview } from "@/components/storage-locations/output-stock-preview";
import { MoistureSplit } from "@/components/ui/moisture-split";
import { ProductCompositionPreview } from "@/components/ui/product-composition-preview";
import { SampleEligibilityAdvisory } from "@/components/samples/sample-eligibility-advisory";
import { EntitySideSheetSections } from "@/components/ui/entity-side-sheet";
import { ProcessFlowPreview } from "@/components/production-runs/production-run-process-flow-preview";
import { ApplicationAllocationShares } from "@/components/applications/application-allocation-shares";
import { SampleDerivedRatios } from "@/components/samples/sample-derived-ratios";
import { creditBatchSheetSections } from "@/components/credit-batches/credit-batch-view";
import { FormulationForm } from "@/components/formulations/formulation-form";
import { MatchingOutputBins } from "@/components/orders/matching-output-bins";
import { DeliveryStockDetails } from "@/components/deliveries/delivery-stock-details";
import { StockRows } from "@/components/storage-locations/stock-figures";
import { DetailedOnly } from "./form-detail-context";
import type { CreditBatchWithRelations } from "@/data-access/credit-batches";
import type { FormulationWithIngredients } from "@/data-access/formulations";
import type { OutputStockPreview as Preview } from "@/types/output-stock";

function visibleText(node: ReactTestInstance | string): string {
  if (typeof node === "string") return node;
  if (node.props.hidden) return "";
  return node.children.map(visibleText).join(" ");
}

beforeAll(() => Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true }));
const preview: Preview = {
  basisFingerprint: "basis", storageLocationId: "bin", binName: "Product bin", binCode: "PB-001", formulationName: "Mix", lane: "product",
  beforeDryKg: 1500, afterDryKg: 350, beforeSolidsKg: 1820, afterSolidsKg: 420,
  removedDryKg: 1150, removedWetKg: 2000, estimateMoisturePercent: 30,
  beforeEstimatedWetKg: 2600, afterEstimatedWetKg: 600, discrepancySolidsKg: 12, blockingMessage: "Correction blocked",
  blockers: [{ entity: "application", id: "app-id", code: "APP-001" }],
  allocations: [{ layerId: "a", code: "Batch A", wetMassKg: null, dryMassKg: 1150, runs: [{ productionRunId: "r1", code: "Run A", dryMassKg: 1150 }] }],
};

describe("optional detail boundaries", () => {
  it("keeps warnings and blockers but hides optional stock readouts in Simple", async () => {
    let renderer!: ReactTestRenderer;
    await act(async () => { renderer = create(<FormDetailProvider scope="stock"><FormDetailControl /><OutputStockPreview variant="movement" preview={preview} /></FormDetailProvider>); });
    const simple = visibleText(renderer.root);
    expect(simple).toContain("Correction blocked");
    expect(simple).toContain("Count exceeds tracked solids");
    expect(simple).not.toContain("Product bin");
    expect(simple).not.toContain("1,150 kg");
    expect(simple).not.toContain("Details");
    expect(simple).not.toContain("More info");
    expect(simple).not.toContain("Batch A");
    expect(renderer.root.findByType("a").props.href).toBe("/applications?ids=app-id");
    await act(async () => renderer.root.findAllByType("input")[1].props.onChange());
    expect(visibleText(renderer.root)).not.toContain("Batch A");
    const disclosure = renderer.root.findAllByType("button").find(node => node.props["aria-controls"])!;
    expect(disclosure.props["aria-expanded"]).toBe(false);
    await act(async () => disclosure.props.onClick());
    expect(visibleText(renderer.root)).toContain("Batch A");
    expect(visibleText(renderer.root)).toContain("1,150 kg");
    expect(JSON.stringify(renderer.toJSON())).toContain("Correction blocked");
    await act(async () => renderer.unmount());
  });

  it("keeps the moisture bar and key in Simple while hiding its calculation table", async () => {
    let renderer!: ReactTestRenderer;
    await act(async () => { renderer = create(<FormDetailProvider scope="read">
      <MoistureSplit wetMassKg={100} moisturePercent={20} />
      <MoistureSplit wetMassKg={100} moisturePercent={null} />
      <ProductCompositionPreview wetMassKg={100} dryBiocharKg={60} />
      <SampleEligibilityAdvisory hToCOrgRatio={0.8} oToCOrgRatio={0.3} />
      <EntitySideSheetSections sections={[{ title: "Definition", fields: [
        { label: "Preview formula", value: "formula-v1", detailedOnly: true },
        { label: "Durability", value: "1,000 years" },
        { label: "Sampling date", value: "2026-09-22" },
      ] }]} />
    </FormDetailProvider>); });
    const simple = visibleText(renderer.root);
    // The bar and its key are what the wet mass and moisture inputs mean, so
    // they stay in Simple. Only the calculation table below them is optional.
    expect(simple).toContain("Dry");
    expect(simple).toContain("80 kg");
    expect(simple).toContain("Water");
    expect(simple).toContain("20 kg");
    expect(simple).not.toContain("% of total");
    expect(simple).not.toContain("Dry = wet");
    // A missing moisture reading still names the field it is waiting on.
    expect(simple).toContain("not recorded.");
    // The product bar follows the same rule: its parts are what the mass and
    // ingredient fields mean, and only its ledger waits for Detailed.
    expect(simple).toContain("Product composition");
    expect(simple).toContain("Dry biochar");
    expect(simple).toContain("60 kg");
    expect(simple).not.toContain("Show calculation");
    // Other derived readouts stay hidden.
    expect(simple).toContain("exceeds the biochar eligibility ceiling");
    expect(simple).toContain("Durability");
    expect(simple).toContain("Sampling date");
    expect(simple).not.toContain("formula-v1");
    // The resolved moisture split and the product composition, one bar each.
    expect(renderer.root.findAllByProps({ role: "img" })).toHaveLength(2);
    await act(async () => renderer.unmount());
  });
});

it("omits optional read-section headings in Simple and numbers visible sections contiguously", async () => {
  let renderer!: ReactTestRenderer;
  await act(async () => { renderer = create(<FormDetailProvider scope="application"><FormDetailControl /><EntitySideSheetSections numbered sections={[
    { title: "Application", fields: [{ label: "Wet mass", value: "100 kg" }, { label: "Dry biochar applied (kg)", value: "80 kg", detailedOnly: true }] },
    { title: "Batch shares", detailedOnly: true, fields: [], content: <p>Saved source proportions</p> },
    { title: "Evidence", fields: [], content: <button type="button">Open evidence</button> },
  ]} /></FormDetailProvider>); });
  expect(visibleText(renderer.root)).not.toContain("Batch shares");
  expect(visibleText(renderer.root)).not.toContain("Dry biochar applied");
  expect(visibleText(renderer.root)).toContain("Open evidence");
  expect(renderer.root.findAllByType(SpineSectionStatic).map(node => node.props.meta)).toEqual([
    { index: 0, total: 2, first: true, last: false }, { index: 1, total: 2, first: false, last: true },
  ]);
  await act(async () => renderer.root.findAllByType("input").find(node => node.props.value === "detailed")!.props.onChange());
  expect(visibleText(renderer.root)).toContain("Batch shares");
  expect(renderer.root.findAllByType(SpineSectionStatic).map(node => node.props.meta.index)).toEqual([0, 1, 2]);
  // Detailed shows the optional rows in place. They are recorded fields, not a
  // calculation, so no disclosure stands between the operator and the number.
  expect(visibleText(renderer.root)).toContain("80 kg");
  expect(renderer.root.findAllByType("button").filter(node => node.props["aria-controls"])).toHaveLength(0);
  await act(async () => renderer.unmount());
});

const carbonEstimate = creditBatchSheetSections({
  creditBatch: { id: "batch", code: "CB-26-001", facilityId: "facility", co2eStoredPreview: { co2eStoredTonnes: 3.2, applicationResults: [], missingInputs: [], warnings: [] } } as unknown as CreditBatchWithRelations,
  productionRuns: [],
  isLoadingRuns: false,
  runsError: null,
  isRetryingRuns: false,
  onRetryRuns: () => undefined,
  isHealthLoading: false,
}).find(section => section.title === "Production runs")?.content;

const overAllocated = {
  id: "formulation", name: "Mix", description: null, biocharRatio: 0.8,
  ingredients: [{ feedstockTypeId: "manure", ratio: 0.4, feedstockType: { name: "Manure" } }],
} as unknown as FormulationWithIngredients;

/**
 * The Simple boundary of every derived block, one row each: what an operator
 * still sees in Simple and what waits for Detailed. `picture` keeps caption,
 * headline and picture; `headline` keeps caption and headline; `hidden` keeps
 * nothing unless the block has an error to show.
 */
const SIMPLE_BOUNDARIES: { block: string; presence: string; element: ReactNode; present: string[]; absent: string[] }[] = [
  { block: "Moisture split", presence: "picture",
    element: <MoistureSplit wetMassKg={100} moisturePercent={20} materialLabel="Feedstock" />,
    present: ["Dry feedstock 80 kg", "Water 20 kg"], absent: ["% of total", "Dry = wet"] },
  { block: "Product composition", presence: "picture",
    element: <ProductCompositionPreview wetMassKg={100} dryBiocharKg={60} />,
    present: ["Product composition", "Dry biochar", "60 kg"], absent: ["Show calculation", "sum of its parts"] },
  { block: "Blend by volume", presence: "hidden",
    element: <FormulationForm onSubmit={() => undefined} />,
    present: ["Biochar"], absent: ["Blend by volume", "Total 100%"] },
  { block: "Blend by volume, over 100%", presence: "picture while the total is an error",
    element: <FormulationForm formulation={overAllocated} onSubmit={() => undefined} />,
    present: ["Blend by volume", "Total 120%. Reduce a share to reach 100%."], absent: ["Show calculation"] },
  { block: "Process flow", presence: "headline",
    element: <ProcessFlowPreview sourceBinName="Feedstock July" feedstockKg={100} feedstockMoisturePercent={10} feedstockDryKg={90} reactorName="Reactor 1" biocharKg={50} biocharMoisturePercent={10} biocharDryKg={45} destinationBinName="Biochar July" />,
    present: ["Process flow", "Dry yield", "50%"], absent: ["Feedstock July", "Feedstock in", "Show calculation"] },
  { block: "Applied batches", presence: "picture",
    element: <ApplicationAllocationShares shares={[{ applicationId: "application", deliveryId: "delivery", biocharProductId: "product", productCode: "BP-26-001", productionRunId: "run", productionRunCode: "PR-26-001", dryMassKg: 600, wetMassKg: 1200 }]} />,
    present: ["Applied batches", "BP-26-001", "600 kg"], absent: ["% of total", "Show calculation", "PR-26-001"] },
  { block: "Derived ratios", presence: "headline",
    element: <SampleDerivedRatios hToCOrgRatio={0.42} oToCOrgRatio={0.15} hydrogenPercent={2.5} oxygenPercent={12} organicCarbonPercent={71.5} oToCFromLab={false} certifyRequired={() => false} certifyStatus={() => "neutral"} />,
    present: ["H:C org", "0.4200", "O:C org", "0.1500"], absent: ["atomic ratio", "Show calculation"] },
  { block: "Carbon estimate", presence: "headline",
    element: carbonEstimate,
    present: ["Carbon estimate, before project emissions", "≈ 3.20 t CO₂e"], absent: ["Show calculation", "Feedstock dry mass", "Isometric applies"] },
  { block: "Original entry figures", presence: "hidden",
    element: <DetailedOnly><StockRows label="Original entry figures" rows={[{ label: "Wet mass", value: "100 kg" }]} /></DetailedOnly>,
    present: [], absent: ["Wet mass", "100 kg"] },
  { block: "Matching stock", presence: "hidden",
    element: <MatchingOutputBins facilityId="facility" formulationId="mix" />,
    present: [], absent: ["Product bin", "1,500 kg", "Orders do not reserve stock"] },
  { block: "Stock movement preview", presence: "hidden",
    element: <OutputStockPreview variant="movement" preview={{ ...preview, blockingMessage: null, blockers: [], discrepancySolidsKg: 0 }} />,
    present: [], absent: ["Product bin", "1,150 kg", "Show calculation"] },
  { block: "Stock movement preview, blocked", presence: "notices only",
    element: <OutputStockPreview variant="movement" preview={preview} />,
    present: ["Correction blocked", "Count exceeds tracked solids"], absent: ["Product bin", "Batch A", "Show calculation"] },
  { block: "Delivery stock", presence: "picture and its history action",
    element: <DeliveryStockDetails deliveryId="delivery" storageLocationId="bin" facilityId="facility" wetMassKg={100} dryMassKg={80} />,
    present: ["Delivery stock", "B-001", "80 kg", "Stock history"], absent: ["Wet mass", "Show calculation"] },
];

describe("Simple boundary table", () => {
  it.each(SIMPLE_BOUNDARIES)("$block: $presence", async ({ element, present, absent }) => {
    let renderer!: ReactTestRenderer;
    await act(async () => { renderer = create(<FormDetailProvider scope="boundary">{element}</FormDetailProvider>); });
    const simple = visibleText(renderer.root).replace(/\s+/g, " ");
    for (const text of present) expect(simple).toContain(text);
    for (const text of absent) expect(simple).not.toContain(text);
    await act(async () => renderer.unmount());
  });
});
