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
import { OutputBinBalance } from "./output-bin-balance";

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
  expect(JSON.stringify(renderer.toJSON())).toContain("≈ 200 kg wet");
  expect(renderer.root.findByType(SecondaryFigure).props).toMatchObject({ label: "Dry biochar", value: "90 kg" });
  await act(async () => renderer.unmount());
});

it("drops the caption and leads with dry biochar when nothing dates a moisture", async () => {
  state.wetKg = null; state.subBins = [{ ...subBin, wetEstimateKg: null, moisturePercent: null }];
  const renderer = await render();
  expect(JSON.stringify(renderer.toJSON())).toContain("90 kg dry biochar");
  expect(JSON.stringify(renderer.toJSON())).not.toContain("kg wet");
  expect(renderer.root.findAllByType(SecondaryFigure)).toHaveLength(0);
  await act(async () => renderer.unmount());
});
