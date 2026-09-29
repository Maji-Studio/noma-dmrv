/**
 * Level parity guard: Simple and Detailed show the same information and differ only in
 * explanation (docs/forms.md, "Simple and Detailed presentation").
 *
 * Two layers:
 *
 * 1. Source scan. A surface can only differ between the levels if it reads the
 *    level. Reading it is reserved for a short list of explanation primitives
 *    (`LEVEL_READERS`), and `DetailedOnly` for a short list of callers
 *    (`DETAILED_ONLY_CALLERS`), so every form and read view that does not read
 *    the level renders the same at both levels by construction. Adding a new
 *    reader or caller fails here until it is reviewed and listed. The read
 *    field and section types carry no level flag at all (`detailedOnly` is
 *    gone), and the scan also rejects the word coming back.
 *
 * 2. Render parity. Every surface built on a level reader (derived blocks,
 *    stock previews, bin pickers, the pre-input split) renders in a provider at
 *    Simple, then at Detailed. The field labels, section and block titles,
 *    inputs, actions and links must match, and so must the visible text once
 *    explanation blocks (marked with `DETAIL_EXPLANATION_ATTR`) are skipped.
 *    Read sheets are covered in `form-detail-parity-sheets.test.tsx` and sheet
 *    forms in `form-detail-parity-forms.test.tsx`.
 */
import { readdirSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";
import type { ReactElement, ReactNode } from "react";
import { useForm, type Control, type FieldValues } from "react-hook-form";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

vi.mock("@/components/ui/tooltip", () => ({
  InfoHint: ({ label }: { children: ReactNode; label: string }) => <span aria-label={label} />,
  Tooltip: ({ children }: { children: ReactNode }) => <span>{children}</span>,
}));
vi.mock("next/link", () => ({ default: ({ children, href }: { children: ReactNode; href: string }) => <a href={href}>{children}</a> }));
vi.mock("@/hooks/use-facility-context", () => ({ useFacilityContext: () => ({ facilities: [{ id: "facility", timezone: "UTC" }] }) }));
vi.mock("@/hooks/use-entities", () => ({
  useEntityOptions: () => ({ data: [], dataUpdatedAt: 0, isLoading: false, error: null }),
  useEntityById: () => ({
    data: { id: "bin", code: "BIN-01", name: "North product bin", remainingMass: { wetKg: 3000, dryKg: 2900 } },
    dataUpdatedAt: 1, isPending: false, isError: false, error: null,
  }),
}));
vi.mock("@/components/storage-locations/output-stock-history", () => ({ OutputStockHistory: ({ triggerLabel }: { triggerLabel?: string }) => <button type="button">{triggerLabel ?? "Stock history"}</button> }));
vi.mock("@/components/storage-locations/bin-movement-history-modal", () => ({ BinMovementHistoryModal: ({ triggerLabel }: { triggerLabel: string }) => <button type="button">{triggerLabel}</button> }));
// The bin picker's quick-add dialogs need a query client; none is under test.
vi.mock("./entity-select/driver-quick-add-dialog", () => ({ DriverQuickAddDialog: () => null }));
vi.mock("./entity-select/operator-quick-add-dialog", () => ({ OperatorQuickAddDialog: () => null }));
vi.mock("./entity-select/vehicle-quick-add-dialog", () => ({ VehicleQuickAddDialog: () => null }));
vi.mock("./entity-select/feedstock-type-quick-add-dialog", () => ({ FeedstockTypeQuickAddDialog: () => null }));
vi.mock("./entity-select/formulation-quick-add-dialog", () => ({ FormulationQuickAddDialog: () => null }));
vi.mock("@/hooks/use-output-stock", async (importOriginal) => ({
  ...await importOriginal<typeof import("@/hooks/use-output-stock")>(),
  useMatchingOutputBins: () => ({ data: [{ id: "bin", code: "PB-001", name: "Product bin", dryMassKg: 1500, estimatedWetMassKg: 1800 }], isLoading: false, error: null }),
  useOutputStockBalance: () => ({ data: undefined, isLoading: false, error: null }),
  useOutputStockHistory: () => ({ data: [{ id: "entry", deliveryId: "delivery", kind: "delivery", occurredAt: "2026-09-22T12:00:00.000Z", recordedAt: "2026-09-22", actorName: null, reason: "Recorded", correctsMovementId: null, wetMassKg: 100, moisturePercent: 20, dryMassKg: 80, beforeDryKg: 200, afterDryKg: 120, allocations: [{ layerId: "batch", code: "B-001", wetMassKg: null, dryMassKg: 80, runs: [{ productionRunId: "run", code: "PR-001", dryMassKg: 80 }] }] }], isLoading: false, error: null }),
}));
// The formulation form's material selector needs a query client; the blend
// block under it is what reads the level.
vi.mock("@/components/forms/entity-select", async (importOriginal) => ({
  ...await importOriginal<typeof import("@/components/forms/entity-select")>(),
  FormEntitySelect: () => <span>Blend material</span>,
}));

import { renderBothLevels } from "./form-detail-parity-harness";
import { MassMoistureFields } from "./mass-moisture-fields";
import { EntitySelect } from "./entity-select/entity-select";
import { EntitySideSheetSections } from "@/components/ui/entity-side-sheet";
import { MoistureSplit } from "@/components/ui/moisture-split";
import { ProductCompositionPreview } from "@/components/ui/product-composition-preview";
import { OutputStockAvailability, OutputStockPreview } from "@/components/storage-locations/output-stock-preview";
import { MixPileCard } from "@/components/storage-locations/mix-pile-card";
import { ProcessFlowPreview } from "@/components/production-runs/production-run-process-flow-preview";
import { ApplicationAllocationShares } from "@/components/applications/application-allocation-shares";
import { SampleDerivedRatios } from "@/components/samples/sample-derived-ratios";
import { FormulationForm } from "@/components/formulations/formulation-form";
import { MatchingOutputBins } from "@/components/orders/matching-output-bins";
import { DeliveryStockDetails } from "@/components/deliveries/delivery-stock-details";
import { ProductCompositionBlock } from "@/components/biochar-products/biochar-product-form";
import { formProductComposition } from "@/components/biochar-products/form-product-composition";
import { IngredientMassSplit } from "@/components/biochar-products/ingredient-mass-split";
import type { FormulationWithIngredients } from "@/data-access/formulations";
import type { OutputStockPreview as Preview } from "@/types/output-stock";

const SRC = join(__dirname, "..", "..");

/** Re-exports the context API without using it. */
const BARREL = "components/forms/index.ts";

/** Modules allowed to read the detail level. Each hides explanation only. */
const LEVEL_READERS = [
  "components/forms/form-detail-context.tsx",
  "components/forms/composition-card.tsx",
  "components/ui/moisture-split/moisture-split.tsx",
];

/** Modules allowed to render `DetailedOnly`, each for explanation only. */
const DETAILED_ONLY_CALLERS = [
  "components/forms/form-detail-context.tsx",
  // A section's `explanation` slot.
  "components/ui/detail-panel/index.tsx",
  // The unresolved split before any input: what will appear, not data.
  "components/forms/mass-moisture-fields.tsx",
  // The empty composition before any input or source bin, likewise.
  "components/biochar-products/biochar-product-form.tsx",
];

function sourceFiles(): { path: string; text: string }[] {
  return (readdirSync(SRC, { recursive: true }) as string[])
    .filter(file => /\.(ts|tsx)$/.test(file) && !/\.test\.tsx?$/.test(file))
    .map(file => ({ path: relative(SRC, join(SRC, file)), text: readFileSync(join(SRC, file), "utf8") }));
}

describe("detail level source scan", () => {
  const files = sourceFiles();

  it("reads the detail level only in the explanation primitives", () => {
    // Any mention counts, so an aliased import cannot slip past; the barrel only re-exports.
    const readers = files
      .filter(file => file.path !== BARREL && /\buseFormDetailLevel\b|\bFormDetailContext\b/.test(file.text))
      .map(file => file.path);
    expect(readers.sort()).toEqual([...LEVEL_READERS].sort());
  });

  it("renders DetailedOnly only where it wraps explanation", () => {
    const callers = files
      .filter(file => file.path !== BARREL && /\bDetailedOnly\b/.test(file.text))
      .map(file => file.path);
    expect(callers.sort()).toEqual([...DETAILED_ONLY_CALLERS].sort());
  });

  it("has no per-field or per-section level flag", () => {
    expect(files.filter(file => /\bdetailedOnly\b|SimplePresence/.test(file.text)).map(file => file.path)).toEqual([]);
  });
});

beforeAll(() => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  // The bin picker listens for outside clicks; this node suite has no DOM.
  vi.stubGlobal("document", { addEventListener: () => undefined, removeEventListener: () => undefined });
});

afterAll(() => { vi.unstubAllGlobals(); });

const preview: Preview = {
  basisFingerprint: "basis", storageLocationId: "bin", binName: "Product bin", binCode: "PB-001", formulationName: "Mix", lane: "product",
  beforeDryKg: 1500, afterDryKg: 350, beforeSolidsKg: 1820, afterSolidsKg: 420,
  removedDryKg: 1150, removedWetKg: 2000, movementMoisturePercent: 30,
  beforeEstimatedWetKg: 2600, afterEstimatedWetKg: 600, discrepancySolidsKg: 12, blockingMessage: "Correction blocked",
  blockers: [{ entity: "application", id: "app-id", code: "APP-001" }],
  allocations: [{ layerId: "a", code: "Batch A", wetMassKg: null, dryMassKg: 1150, runs: [{ productionRunId: "r1", code: "Run A", dryMassKg: 1150 }] }],
};
const acceptedPreview: Preview = { ...preview, blockingMessage: null, blockers: [], discrepancySolidsKg: 0 };

const registration = { name: "field", onChange: async () => undefined, onBlur: async () => undefined, ref: () => undefined };
const massFields = (wetMassKg: unknown) => (
  <MassMoistureFields wet={{ id: "wet", registration }} moisture={{ id: "moisture", registration }} wetMassKg={wetMassKg} moisturePercent={null} />
);

const composition = formProductComposition({
  isEditMode: false, massKg: 100, moisturePercent: 10, waterAddedKg: 0,
  recordedSourceDryMassKg: null, ingredients: [], allocationFrozen: false,
});

function IngredientHarness() {
  const form = useForm({ defaultValues: { ingredientBins: [{ massKg: 240, moistureContentPercent: 20, storageLocationId: "bin-compost" }] } });
  return <IngredientMassSplit control={form.control as unknown as Control<FieldValues>} index={0} feedstockTypeName="Compost" frozen={false} />;
}

const balanced = {
  id: "formulation", name: "Mix", description: null, biocharRatio: 0.6,
  ingredients: [{ feedstockTypeId: "manure", ratio: 0.4, feedstockType: { name: "Manure" } }],
} as unknown as FormulationWithIngredients;

/** Surfaces built on a level reader (forms, previews, derived blocks). */
const SURFACE_CASES: { name: string; element: ReactElement; blankInSimple?: boolean }[] = [
  { name: "moisture split", element: <MoistureSplit wetMassKg={100} moisturePercent={20} materialLabel="Feedstock" /> },
  { name: "wet mass and moisture, untouched", element: massFields(null) },
  { name: "wet mass and moisture, started", element: massFields(100) },
  { name: "product composition", element: <ProductCompositionPreview wetMassKg={100} dryBiocharKg={60} /> },
  { name: "product form composition, untouched", blankInSimple: true, element: <ProductCompositionBlock composition={composition} massKg={null} ingredientBins={[]} storageLocationId={null} facilityId="facility" /> },
  { name: "product form composition, source bin chosen", element: <ProductCompositionBlock composition={composition} massKg={null} ingredientBins={[]} storageLocationId="bin" facilityId="facility" /> },
  { name: "ingredient split", element: <IngredientHarness /> },
  { name: "bin picker remaining mass", element: <EntitySelect entityType="storageLocation" value="bin" onChange={() => undefined} /> },
  { name: "formulation form, balanced", element: <FormulationForm formulation={balanced} onSubmit={() => undefined} /> },
  { name: "process flow", element: <ProcessFlowPreview sourceBinName="Feedstock July" feedstockKg={100} feedstockMoisturePercent={10} feedstockDryKg={90} reactorName="Reactor 1" biocharKg={50} biocharMoisturePercent={10} biocharDryKg={45} destinationBinName="Biochar July" /> },
  { name: "applied batches", element: <ApplicationAllocationShares shares={[{ applicationId: "application", deliveryId: "delivery", biocharProductId: "product", productCode: "BP-26-001", productionRunId: "run", productionRunCode: "PR-26-001", dryMassKg: 600, wetMassKg: 1200 }]} /> },
  { name: "derived ratios", element: <SampleDerivedRatios hToCOrgRatio={0.42} oToCOrgRatio={0.15} hydrogenPercent={2.5} oxygenPercent={12} organicCarbonPercent={71.5} oToCFromLab={false} certifyRequired={() => false} certifyStatus={() => "neutral"} /> },
  { name: "stock movement preview", element: <OutputStockPreview variant="movement" preview={acceptedPreview} /> },
  { name: "stock movement preview, blocked", element: <OutputStockPreview variant="movement" preview={preview} /> },
  { name: "stock load preview", element: <OutputStockPreview variant="load" preview={acceptedPreview} /> },
  { name: "stock availability", element: <OutputStockAvailability binName="Product bin" dryKg={1500} wetEstimate={{ kg: 1800, basis: "At the latest moisture reading of each batch" }} allocations={[{ layerId: "a", code: "Batch A", wetMassKg: null, dryMassKg: 1500, runs: [] }] as never} /> },
  { name: "matching stock", element: <MatchingOutputBins facilityId="facility" formulationId="formulation" /> },
  { name: "delivery stock", element: <DeliveryStockDetails deliveryId="delivery" storageLocationId="bin" facilityId="facility" wetMassKg={100} dryMassKg={80} /> },
  { name: "mix pile", element: <MixPileCard binName="Product bin" wetKg={1800} moisturePercent={20} dryKg={1440} batches={[{ code: "B-001", dryMassKg: 800 }, { code: "B-002", dryMassKg: 640 }] as never} /> },
];

describe("detail level render parity", () => {
  it.each<{ name: string; element: ReactElement; blankInSimple?: boolean }>(SURFACE_CASES)("$name shows the same fields, sections and actions at both levels", async ({ element, blankInSimple }) => {
    const { simple, detailed } = await renderBothLevels(element);
    // A case that renders nothing would pass vacuously.
    expect(simple.text.length > 0).toBe(!blankInSimple);
    expect(detailed.items).toEqual(simple.items);
    expect(detailed.text).toEqual(simple.text);
  });

  it("lets Detailed add explanation, and only behind the explanation marker", async () => {
    const { simple, detailed, detailedJson } = await renderBothLevels(
      <EntitySideSheetSections sections={[{ title: "Definition", fields: [{ label: "Durability", value: "1,000 years" }], explanation: <p>Formula v1</p> }]} />,
    );
    expect(simple.text).not.toContain("Formula v1");
    expect(detailedJson).toContain("Formula v1");
    expect(detailed.text).toEqual(simple.text);
  });
});
