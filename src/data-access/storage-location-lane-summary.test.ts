import { beforeEach, describe, expect, it, vi } from "vitest";
import type { OrgContext } from "@/lib/auth/server";

const rows = vi.hoisted(() => ({ bins: [] as { id: string; type: string }[] }));
vi.mock("@/db", () => ({ db: { select: () => ({ from: () => ({ where: async () => rows.bins }) }) } }));
const lane = vi.hoisted(() => vi.fn());
vi.mock("./lane-stock-derivation", () => ({ deriveLaneStock: lane }));
const outputs = vi.hoisted(() => vi.fn());
vi.mock("./output-stock", () => ({ getOutputBinStocks: outputs }));
vi.mock("./utils", () => ({ requireOrgScope: () => undefined }));

import { getStorageLocationLaneSummary } from "./storage-location-lane-summary";

const ctx = { organizationId: "org", userId: "user", orgRole: "admin", isPlatformAdmin: false } as OrgContext;
const output = (dry: number | null, wet: number | null, allLayers: number | null = dry) => ({ allLayersDryKg: allLayers, availableDryKg: dry, estimatedWetMassKg: wet, estimatedMoisturePercent: null });

function stage(bins: { id: string; type: string }[], feedstockWet: Record<string, number>, stocks: Record<string, ReturnType<typeof output>>) {
  rows.bins = bins;
  lane.mockResolvedValue(bins.filter(bin => bin.type === "feedstock_bin").map(bin => ({ storageLocationId: bin.id, feedstockStockWetKg: feedstockWet[bin.id] ?? 0 })));
  outputs.mockResolvedValue(new Map(Object.entries(stocks)));
}

describe("lane summary basis and residues", () => {
  beforeEach(() => vi.clearAllMocks());

  it("totals every lane in wet mass, like the bin cards", async () => {
    stage(
      [{ id: "f1", type: "feedstock_bin" }, { id: "p1", type: "product_bin" }, { id: "b1", type: "biochar_bin" }],
      { f1: 458_400 },
      { p1: output(200, 250), b1: output(900, 1000) },
    );
    const summary = await getStorageLocationLaneSummary(ctx, { archived: false });
    expect(summary.feedstock_bin).toEqual({ binCount: 1, onHandKg: 458_400, basis: "wet" });
    expect(summary.product_bin).toEqual({ binCount: 1, onHandKg: 250, basis: "wet" });
    expect(summary.biochar_bin).toEqual({ binCount: 1, onHandKg: 1000, basis: "wet" });
  });

  it("leaves residues below the display minimum out of the total, while still counting the bin", async () => {
    stage(
      [{ id: "p1", type: "product_bin" }, { id: "p2", type: "product_bin" }, { id: "f1", type: "feedstock_bin" }, { id: "f2", type: "feedstock_bin" }],
      { f1: 0.04, f2: 12 },
      { p1: output(0.2, 0.2), p2: output(250, 250) },
    );
    const summary = await getStorageLocationLaneSummary(ctx, { archived: false });
    expect(summary.product_bin).toEqual({ binCount: 2, onHandKg: 250, basis: "wet" });
    expect(summary.feedstock_bin).toEqual({ binCount: 2, onHandKg: 12, basis: "wet" });
  });

  it("reads a lane of residues as an empty total", async () => {
    stage([{ id: "p1", type: "product_bin" }], {}, { p1: output(0.2, 0.2) });
    const summary = await getStorageLocationLaneSummary(ctx, { archived: false });
    expect(summary.product_bin).toEqual({ binCount: 1, onHandKg: 0, basis: "wet" });
  });

  it("falls back to dry biochar for a lane where a bin has no wet estimate", async () => {
    stage([{ id: "p1", type: "product_bin" }, { id: "p2", type: "product_bin" }], {}, { p1: output(100, 120), p2: output(80, null) });
    const summary = await getStorageLocationLaneSummary(ctx, { archived: false });
    expect(summary.product_bin).toEqual({ binCount: 2, onHandKg: 180, basis: "dry" });
  });

  it("keeps a lane total unknown while one bin's stock is unresolved", async () => {
    stage([{ id: "p1", type: "product_bin" }, { id: "p2", type: "product_bin" }], {}, { p1: output(100, 120), p2: output(null, null) });
    const summary = await getStorageLocationLaneSummary(ctx, { archived: false });
    expect(summary.product_bin.onHandKg).toBeNull();
  });

  it("sums the layers placed by now, the figures the cards lead with, not the all-layers balance", async () => {
    stage([{ id: "p1", type: "product_bin" }, { id: "p2", type: "product_bin" }], {}, { p1: output(100, null, 160), p2: output(0.2, 0.2, 40) });
    const summary = await getStorageLocationLaneSummary(ctx, { archived: false });
    expect(summary.product_bin).toEqual({ binCount: 2, onHandKg: 100, basis: "dry" });
  });

  it("gives an archived output lane no total, since archived bins have no stock read", async () => {
    stage([{ id: "f1", type: "feedstock_bin" }, { id: "p1", type: "product_bin" }, { id: "b1", type: "biochar_bin" }], { f1: 40 }, {});
    const summary = await getStorageLocationLaneSummary(ctx, { archived: true });
    expect(summary.feedstock_bin).toEqual({ binCount: 1, onHandKg: 40, basis: "wet" });
    expect(summary.product_bin.onHandKg).toBeNull();
    expect(summary.biochar_bin.onHandKg).toBeNull();
  });
});
