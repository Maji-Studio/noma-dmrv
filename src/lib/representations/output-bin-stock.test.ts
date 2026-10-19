import { bodyHashEtag } from "@/lib/api/etag";
import { OUTPUT_BIN_STOCK_REPRESENTATION_REVISION } from "@/config/api-rest";
import { expect, it } from "vitest";
import { decimal, rational } from "@/lib/output-stock/exact";
import { UNRESOLVED_STOCK_REASONS, UNRESOLVED_STOCK_SENTENCES } from "@/lib/output-stock/layer-projection";
import type { ResolvedOutputBinStock } from "@/lib/output-stock/bin-stock-projection";
import type { OutputDrawOrder } from "@/lib/output-stock/stock-mode";
import { outputBinStockRepresentationSchema, representOutputBinStock } from "./output-bin-stock";

const ID = "df2795a4-886b-4a89-bbdd-532c6b1b8e45";
const AT = "2026-10-06T12:00:00.000Z";
const figures = {
  dryBiocharKg: decimal("1.2345"), solidsKg: rational(BigInt(2469), BigInt(2000)),
  estimatedWetKg: decimal("2.3455"), estimatedMoisturePercent: decimal("47.345"),
  moistureBasis: { source: "recorded" as const, at: AT },
};
const stock: ResolvedOutputBinStock & { drawOrder: OutputDrawOrder | null } = {
  bin: { storageLocationId: ID, code: "OB-2", type: "biochar_bin", facilityId: ID, archivedAt: null, formulationId: null },
  drawOrder: "oldest_first", stockMode: "split", status: "resolved", unresolvedReason: null, totals: figures,
  subBins: [{ layerId: ID, layerKind: "production_run", code: "PR-12", placedAt: AT, ...figures }],
};

it("rounds every exact figure once with half ties away from zero and publishes only stock fields", () => {
  const data = representOutputBinStock(stock);
  const published = { dryBiocharKg: 1.235, solidsKg: 1.235, estimatedWetKg: 2.346, estimatedMoisturePercent: 47.35, moistureBasis: figures.moistureBasis };
  expect(data.totals).toEqual(published);
  expect(data.subBins[0]).toEqual({ layerId: ID, layerKind: "production_run", code: "PR-12", placedAt: AT, ...published });
  expect(Object.keys(data).sort()).toEqual(Object.keys(outputBinStockRepresentationSchema.shape).sort());
  for (const field of ["at", "evaluatedAt", "organizationId", "allLayersDryKg", "recentMovements", "postingSequence"]) expect(data).not.toHaveProperty(field);
  expect(representOutputBinStock({ ...stock, totals: { ...figures, dryBiocharKg: rational(BigInt(-12345), BigInt(10000)) } }).totals?.dryBiocharKg).toBe(-1.235);
});

it("normalizes negative zero and refuses figures too large for a finite JSON number", () => {
  const totals = representOutputBinStock({ ...stock, totals: { ...figures, dryBiocharKg: rational(BigInt(-1), BigInt(10000)), estimatedMoisturePercent: rational(BigInt(-1), BigInt(1000)) } }).totals!;
  expect(Object.is(totals.dryBiocharKg, 0)).toBe(true);
  expect(Object.is(totals.estimatedMoisturePercent, 0)).toBe(true);
  expect(() => representOutputBinStock({ ...stock, totals: { ...figures, solidsKg: rational(BigInt(10) ** BigInt(400)) } })).toThrow(RangeError);
  expect(outputBinStockRepresentationSchema.safeParse({ ...representOutputBinStock(stock), totals: { ...totals, dryBiocharKg: Infinity } }).success).toBe(false);
});

it("preserves mix layer nulls while publishing the pile figures and product formulation", () => {
  const data = representOutputBinStock({ ...stock, bin: { ...stock.bin, type: "product_bin", formulationId: ID, archivedAt: AT }, stockMode: "mix", drawOrder: null,
    subBins: [{ ...stock.subBins[0], layerKind: "biochar_product", estimatedWetKg: null, estimatedMoisturePercent: null, moistureBasis: null }] });
  expect(data).toMatchObject({ type: "product_bin", formulationId: ID, archivedAt: AT, stockMode: "mix" });
  expect(data.subBins[0]).toMatchObject({ dryBiocharKg: 1.235, solidsKg: 1.235, estimatedWetKg: null, estimatedMoisturePercent: null, moistureBasis: null });
  expect(data.totals?.estimatedWetKg).toBe(2.346);
});

it.each(UNRESOLVED_STOCK_REASONS)("publishes the fixed explanation for %s with no figures", (reason) => {
  const data = representOutputBinStock({ bin: stock.bin, drawOrder: "oldest_first", stockMode: "split", status: "unresolved", unresolvedReason: reason, totals: null, subBins: [] });
  expect(data).toMatchObject({ status: "unresolved", unresolvedReason: UNRESOLVED_STOCK_SENTENCES[reason], totals: null, subBins: [] });
  expect(data.unresolvedReason).not.toMatch(/[\u2013\u2014]/);
});

it("publishes a resolved empty bin with zero wet and dry totals and no moisture", () => {
  const zero = rational(BigInt(0));
  expect(representOutputBinStock({ ...stock, subBins: [], totals: {
    dryBiocharKg: zero, solidsKg: zero, estimatedWetKg: zero, estimatedMoisturePercent: null, moistureBasis: null,
  } })).toMatchObject({ status: "resolved", unresolvedReason: null, subBins: [], totals: {
    dryBiocharKg: 0, solidsKg: 0, estimatedWetKg: 0, estimatedMoisturePercent: null, moistureBasis: null,
  } });
});

it("publishes draw order without reordering sub-bins and includes it in the body hash", () => {
  const oldest = representOutputBinStock({ ...stock, drawOrder: "oldest_first" });
  const newest = representOutputBinStock({ ...stock, drawOrder: "newest_first" });
  expect(oldest.drawOrder).toBe("oldest_first");
  expect(newest.drawOrder).toBe("newest_first");
  expect(newest.subBins).toEqual(oldest.subBins);
  expect(OUTPUT_BIN_STOCK_REPRESENTATION_REVISION).toBe(2);
  expect(bodyHashEtag(OUTPUT_BIN_STOCK_REPRESENTATION_REVISION, newest)).not.toBe(bodyHashEtag(OUTPUT_BIN_STOCK_REPRESENTATION_REVISION, oldest));
  expect(representOutputBinStock({ ...stock, stockMode: "mix", drawOrder: null }).drawOrder).toBeNull();
});
