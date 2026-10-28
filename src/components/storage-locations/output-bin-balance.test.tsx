import { act, create, type ReactTestRenderer } from "react-test-renderer";
import type { ReactNode } from "react";
import { beforeAll, expect, it, vi } from "vitest";
import type { OutputSubBin } from "@/types/output-stock";

const state = vi.hoisted(() => ({ wetKg: 200 as number | null, subBins: [] as unknown[] }));
vi.mock("@/hooks/use-output-stock", () => ({
  useOutputStockBalance: () => ({ data: { binName: "BCF", beforeDryKg: 90, beforeEstimatedWetKg: state.wetKg, moistureEstimate: null }, isLoading: false }),
  useOutputSubBins: () => ({ data: { stockMode: "split", drawOrder: "oldest_first", subBins: state.subBins }, isLoading: false }),
  useOutputStockHistory: () => ({ data: [], isLoading: false }),
}));
vi.mock("@/hooks/use-facility-context", () => ({ useFacilityClock: () => ({ timeZone: "UTC" }) }));
vi.mock("@/components/ui/tooltip", () => ({ InfoHint: () => null }));
vi.mock("./output-stock-history", () => ({ OutputStockHistory: () => null }));
vi.mock("./sub-bin-card", async (importOriginal) => ({ ...(await importOriginal<typeof import("./sub-bin-card")>()),
  DetailsTooltip: ({ trigger }: { trigger: ReactNode }) => trigger, SubBinTooltip: ({ trigger }: { trigger: ReactNode }) => trigger }));

import { SecondaryFigure } from "@/components/ui/secondary-figure";
import { mixPileBands, OutputBinBalance, drawMoistureBasis } from "./output-bin-balance";

beforeAll(() => Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true }));

const subBin: OutputSubBin = { layerId: "layer", code: "BP-001", placedAt: "2026-10-01T12:00:00.000Z", dryMassKg: 90, solidsKg: 160, wetEstimateKg: 200,
  moisturePercent: 20, basis: null, recentMovements: [], ingredients: [{ name: "Compost", solidsKg: 70 }] };

async function render() {
  let renderer!: ReactTestRenderer;
  await act(async () => { renderer = create(<OutputBinBalance storageLocationId="bin" facilityId="facility" capacityKg={null} />); });
  return renderer;
}

it("reads dry biochar as the secondary figure under the wet estimate", async () => {
  state.wetKg = 200; state.subBins = [subBin];
  const renderer = await render();
  expect(JSON.stringify(renderer.toJSON())).toContain("200 kg wet mass");
  expect(renderer.root.findByType(SecondaryFigure).props).toMatchObject({ label: "Dry biochar", value: "90 kg" });
  await act(async () => renderer.unmount());
});

it("says which draw set the bin's moisture, and stays quiet for counts and intake", async () => {
  state.wetKg = 110;
  state.subBins = [{ ...subBin, basis: { source: "draw", at: "2026-10-20T12:00:00.000Z", kind: "loss" } }];
  let renderer = await render();
  expect(JSON.stringify(renderer.toJSON())).toContain("Moisture estimated from the lost mass of Oct 20");
  await act(async () => renderer.unmount());
  state.subBins = [{ ...subBin, basis: { source: "recorded", at: "2026-10-01T12:00:00.000Z" } }];
  renderer = await render();
  expect(JSON.stringify(renderer.toJSON())).not.toContain("Moisture estimated from");
  await act(async () => renderer.unmount());
});

it("names the newest draw among the bin and its sub-bins", () => {
  const old = { source: "draw", at: "2026-10-18T12:00:00.000Z", kind: "loss" } as const;
  const recent = { source: "draw", at: "2026-10-20T12:00:00.000Z", kind: "delivery" } as const;
  expect(drawMoistureBasis([old, null, recent, { source: "reading", at: "2026-10-21T12:00:00.000Z" }])).toBe(recent);
  expect(drawMoistureBasis([null, undefined])).toBeNull();
});

it("shows the known dry biochar, never a placeholder, if a wet figure is ever missing", async () => {
  state.wetKg = null; state.subBins = [{ ...subBin, wetEstimateKg: null, moisturePercent: null }];
  const renderer = await render();
  const headline = renderer.root.findAll((n) => n.type === "p" && n.props.className?.includes("body-large"))[0];
  expect(headline.children).toEqual(["90 kg dry biochar"]);
  expect(renderer.root.findAllByType(SecondaryFigure)).toHaveLength(0);
  await act(async () => renderer.unmount());
});

it("sums each ingredient's solids across a pile's batches, keeps the unnamed rest as one band, and adds up to the wet estimate", () => {
  const layer = (code: string, dryMassKg: number, solidsKg: number, ingredients: OutputSubBin["ingredients"]): OutputSubBin =>
    ({ ...subBin, layerId: code, code, dryMassKg, solidsKg, wetEstimateKg: null, moisturePercent: null, ingredients });
  const layers = [
    layer("B-001", 100, 160, [{ name: "Compost", solidsKg: 40 }, { name: "Clay", solidsKg: 20 }]),
    layer("B-002", 50, 80, [{ name: "Compost", solidsKg: 30 }]),
    // A product read without its lines: its 5 kg of ingredient solids stay one unnamed part.
    layer("B-003", 10, 15, []),
  ];
  const bands = mixPileBands(layers, 160, 400, 36.25, "UTC");
  expect(bands.map(({ label, kg, category }) => ({ label, kg, category }))).toEqual([
    { label: "B-001", kg: 100, category: undefined },
    { label: "B-002", kg: 50, category: undefined },
    { label: "B-003", kg: 10, category: undefined },
    { label: "Compost solids", kg: 70, category: "ingredient-solids" },
    { label: "Clay solids", kg: 20, category: "ingredient-solids" },
    { label: "Ingredient solids", kg: 5, category: "ingredient-solids" },
    { label: "Water, estimated", kg: 145, category: "existing-water" },
  ]);
  expect(bands.reduce((sum, band) => sum + band.kg, 0)).toBeCloseTo(400);
});

it("filters named ingredients by the drawing threshold before working out the rest", () => {
  const tiny: OutputSubBin = { ...subBin, dryMassKg: 100, solidsKg: 100.2, wetEstimateKg: null, ingredients: [{ name: "Compost", solidsKg: 0.17 }, { name: "Clay", solidsKg: 0.03 }] };
  const bands = mixPileBands([tiny], 100, 120, null, "UTC");
  expect(bands.filter((band) => band.category === "ingredient-solids").map(({ label, kg }) => ({ label, kg: Number(kg.toFixed(2)) })))
    .toEqual([{ label: "Compost solids", kg: 0.17 }]);
  // Clay's 0.03 kg is below the threshold, and so is the 0.03 kg rest it leaves: no Clay band and no rest band.
  expect(bands.some((band) => band.label === "Clay solids")).toBe(false);
});

it("pins a mix pile of 160 kg dry, 80 kg ingredient solids and 400 kg wet: 160 kg water, bands add up to the wet", () => {
  const layers: OutputSubBin[] = [
    { ...subBin, layerId: "A", code: "A-1", dryMassKg: 100, solidsKg: 150, wetEstimateKg: 250, moisturePercent: null, ingredients: [{ name: "Compost", solidsKg: 50 }] },
    { ...subBin, layerId: "B", code: "B-1", dryMassKg: 60, solidsKg: 90, wetEstimateKg: null, moisturePercent: null, ingredients: [{ name: "Compost", solidsKg: 30 }] },
  ];
  const bands = mixPileBands(layers, 160, 400, 40, "UTC");
  // A batch in a pile has no wet estimate of its own, even when its record holds one.
  expect(bands[0].details?.some((row) => row.label === "Water, estimated")).toBe(false);
  expect(bands.map(({ label, kg }) => ({ label, kg }))).toEqual([
    { label: "A-1", kg: 100 }, { label: "B-1", kg: 60 }, { label: "Compost solids", kg: 80 }, { label: "Water, estimated", kg: 160 },
  ]);
  expect(bands.reduce((sum, band) => sum + band.kg, 0)).toBe(400);
});
