/**
 * The stock read of one output bin against PostgreSQL: one snapshot from the
 * bin lookup on, an evaluation instant taken after it, tenancy, archived and
 * feedstock bins, and unresolved stock. The read runs on a dedicated
 * connection whose statements a test can pause or reorder, while writes go
 * through the app pool as a concurrent operator would.
 */
import type { Pool, PoolClient } from "pg";
import { and, eq } from "drizzle-orm";
import { afterEach, describe, expect, it } from "vitest";
import { db } from "@/db";
import { biocharProducts, productionRuns, reactors, storageLocations } from "@/db/schema";
import { findApiOutputBinStock } from "@/data-access/api-output-bin-stock";
import { requireApiOutputBin } from "@/data-access/api-output-stock-movements";
import { getOutputSubBins } from "@/data-access/output-sub-bins";
import { decimal, rational } from "@/lib/output-stock";
import { cleanupPostedStock, postedStockFixture, postMeasurement, postProduct } from "./helpers/posted-output-stock-fixture";

const TIMEOUT_MS = 30_000;
/** Long enough that an instant taken before a placement is strictly earlier than it. */
const CLOCK_STEP_MS = 5;

type Fixture = Awaited<ReturnType<typeof postedStockFixture>>;
const fixtures: Fixture[] = [];
afterEach(async () => { for (const f of fixtures.splice(0)) await cleanupPostedStock(f); });

async function fixture(options: Parameters<typeof postedStockFixture>[0] = { stockKg: 0 }) {
  const f = await postedStockFixture(options);
  fixtures.push(f);
  return f;
}

type Send = (...args: unknown[]) => Promise<{ rows?: Record<string, unknown>[] }>;
interface Statement { index: number; text: string }
interface ConnectionHooks {
  /** Runs before a statement is sent. */
  before?: (statement: Statement) => Promise<void>;
  /** Runs once a statement has answered, before the read sees the answer or sends anything else. `send` queries the same connection. */
  after?: (statement: Statement, send: Send) => Promise<void>;
  /** Reverses the rows of every result, as PostgreSQL may return unordered rows in any order. */
  reverseRows?: boolean;
}

const statementText = (query: unknown) => typeof query === "string" ? query : String((query as { text?: unknown }).text ?? "");
/** A storage-location select: the bin lookup each read starts with. */
const isBinLookup = (text: string | undefined) => /from "storage_locations"/.test(text ?? "");
const pause = () => new Promise(resolve => setTimeout(resolve, CLOCK_STEP_MS));

/**
 * Runs `read` with `hooks` on the next connection the app pool hands out: the
 * one the read's own snapshot transaction (`withStockSnapshot`) takes, so the
 * production transaction settings are under test. Writes in hooks take other
 * pooled connections, as a concurrent operator's would.
 */
async function onReadConnection<T>(hooks: ConnectionHooks, read: () => Promise<T>): Promise<{ result: T; statements: string[] }> {
  const pool = db.$client as Pool;
  const statements: string[] = [];
  let restore = () => {};
  const instrument = (client: PoolClient) => {
    const original = client.query;
    const send = original.bind(client) as Send;
    (client as unknown as { query: unknown }).query = async (...args: unknown[]) => {
      const statement = { index: statements.length + 1, text: statementText(args[0]) };
      statements.push(statement.text);
      await hooks.before?.(statement);
      const result = await send(...args);
      await hooks.after?.(statement, send);
      if (hooks.reverseRows && Array.isArray(result?.rows)) result.rows.reverse();
      return result;
    };
    restore = () => { client.query = original; };
  };
  pool.once("acquire", instrument);
  try {
    return { result: await read(), statements };
  } finally {
    pool.off("acquire", instrument);
    restore();
  }
}

/** Places a product while the read waits before its bin lookup, once. */
function placeBeforeLookup(f: Fixture) {
  const placed = { id: "" };
  const before = async (statement: Statement) => {
    if (placed.id || !isBinLookup(statement.text)) return;
    // An instant taken before this point is now strictly earlier than the placement.
    await pause();
    placed.id = (await postProduct(f, { massKg: 50, placedAt: new Date().toISOString() })).id;
  };
  return { placed, before };
}

describe("output bin stock read in PostgreSQL", { timeout: TIMEOUT_MS }, () => {
  it("runs in a read-only repeatable-read snapshot and answers a loss posted right after its lookup with the stock before it", async () => {
    const f = await fixture();
    await postProduct(f, { massKg: 400 });
    const input = { identifier: { id: f.bin.id } };
    const before = await findApiOutputBinStock(f.ctx, input);
    const settings: Record<string, unknown> = {};
    // Every later query would see the loss outside the snapshot.
    const { result: during, statements } = await onReadConnection({ after: async (statement, send) => {
      if (!isBinLookup(statement.text) || "isolation" in settings) return;
      settings.isolation = (await send("show transaction_isolation")).rows?.[0]?.transaction_isolation;
      settings.readOnly = (await send("show transaction_read_only")).rows?.[0]?.transaction_read_only;
      await postMeasurement(f, { kind: "loss", wetMassKg: 10, moisturePercent: 0 });
    } }, () => findApiOutputBinStock(f.ctx, input));
    expect(statements[0]).toMatch(/^begin/i);
    expect(isBinLookup(statements[1])).toBe(true);
    expect(settings).toEqual({ isolation: "repeatable read", readOnly: "on" });
    expect(during).toEqual(before);
    const after = await findApiOutputBinStock(f.ctx, input);
    expect(after.totals?.dryBiocharKg).toEqual(decimal("390"));
  });

  it.each([["without", false], ["with", true]] as const)("counts a placement committed just before the lookup, %s a facility filter", async (_label, withFacility) => {
    const f = await fixture();
    await postProduct(f, { massKg: 400 });
    const race = placeBeforeLookup(f);
    const input = { identifier: { id: f.bin.id }, ...(withFacility ? { facilityId: f.facility.id } : {}) };
    const { result: stock, statements } = await onReadConnection({ before: race.before }, () => findApiOutputBinStock(f.ctx, input));
    // The bin lookup fixes the snapshot; an instant taken before it, or a facility check run first, would leave the new product out.
    expect(isBinLookup(statements[1])).toBe(true);
    expect(stock.subBins.map(subBin => subBin.layerId)).toContain(race.placed.id);
    expect(stock.totals?.dryBiocharKg).toEqual(decimal("450"));
  });

  it("counts a placement committed just before the picker's lookup when it reads now", async () => {
    const f = await fixture();
    await postProduct(f, { massKg: 400 });
    const race = placeBeforeLookup(f);
    const { result: picker } = await onReadConnection({ before: race.before },
      () => getOutputSubBins(f.ctx, { facilityId: f.facility.id, storageLocationId: f.bin.id }));
    expect(picker.subBins.map(subBin => subBin.layerId)).toContain(race.placed.id);
  });

  it("gives the same answer whatever order rows arrive in, and on every read", async () => {
    const f = await fixture();
    await postProduct(f, { massKg: 400, placedAt: "2026-09-12T12:00:00.000Z" });
    await postProduct(f, { massKg: 300, placedAt: "2026-09-13T12:00:00.000Z" });
    await postProduct(f, { massKg: 200, placedAt: "2026-09-13T12:00:00.000Z" });
    await postMeasurement(f, { kind: "count", wetMassKg: 1000, moisturePercent: 10 });
    const input = { identifier: { code: f.bin.code } };
    const ordered = await findApiOutputBinStock(f.ctx, input);
    expect(ordered.subBins).toHaveLength(3);
    expect((await onReadConnection({ reverseRows: true }, () => findApiOutputBinStock(f.ctx, input))).result).toEqual(ordered);
    expect(await findApiOutputBinStock(f.ctx, input)).toEqual(ordered);
  });

  it("agrees with the sub-bin picker", async () => {
    const f = await fixture();
    await postProduct(f, { massKg: 400, placedAt: "2026-09-12T12:00:00.000Z" });
    await postProduct(f, { massKg: 300, placedAt: "2026-09-13T12:00:00.000Z" });
    const stock = await findApiOutputBinStock(f.ctx, { identifier: { id: f.bin.id } });
    const picker = await getOutputSubBins(f.ctx, { facilityId: f.facility.id, storageLocationId: f.bin.id });
    expect(picker.subBins.map(subBin => [subBin.layerId, subBin.code, subBin.dryMassKg])).toEqual(stock.subBins.map(subBin => [subBin.layerId, subBin.code, Number(subBin.dryBiocharKg.numerator) / Number(subBin.dryBiocharKg.denominator)]));
    expect(picker.stockMode).toBe(stock.stockMode);
  });

  it("reports the claimed formulation of a product bin and none for a biochar bin", async () => {
    const f = await fixture();
    await postProduct(f, { massKg: 100 });
    const product = await findApiOutputBinStock(f.ctx, { identifier: { id: f.bin.id }, facilityId: f.facility.id });
    expect(product.bin).toMatchObject({ type: "product_bin", formulationId: f.pure.id, archivedAt: null, code: f.bin.code });
    expect(product.subBins[0]).toMatchObject({ layerKind: "biochar_product" });
    const biochar = await findApiOutputBinStock(f.ctx, { identifier: { id: f.source.id } });
    expect(biochar.bin).toMatchObject({ type: "biochar_bin", formulationId: null });
    expect(biochar.subBins.map(subBin => [subBin.layerKind, subBin.code])).toEqual(f.runs.map(run => ["production_run", run.code]));
  });

  it("answers an empty bin as resolved with zero totals and no moisture", async () => {
    const f = await fixture();
    expect(await findApiOutputBinStock(f.ctx, { identifier: { id: f.bin.id } })).toMatchObject({ status: "resolved", unresolvedReason: null, subBins: [],
      totals: { dryBiocharKg: rational(BigInt(0)), solidsKg: rational(BigInt(0)), estimatedWetKg: rational(BigInt(0)), estimatedMoisturePercent: null, moistureBasis: null } });
  });

  it("reads an archived bin with its archived layers", async () => {
    const f = await fixture();
    const product = await postProduct(f, { massKg: 100 });
    const archivedAt = new Date("2026-09-20T00:00:00.000Z");
    await db.update(biocharProducts).set({ archivedAt }).where(eq(biocharProducts.id, product.id));
    await db.update(storageLocations).set({ archivedAt }).where(eq(storageLocations.id, f.bin.id));
    const stock = await findApiOutputBinStock(f.ctx, { identifier: { id: f.bin.id } });
    expect(stock.bin.archivedAt).toBe(archivedAt.toISOString());
    expect(stock.subBins.map(subBin => subBin.layerId)).toEqual([product.id]);
  });

  it("finds no bin of another organization, by id, by code or through its facility", async () => {
    const f = await fixture();
    const other = await fixture();
    await expect(findApiOutputBinStock(other.ctx, { identifier: { id: f.bin.id } })).rejects.toMatchObject({ code: "not_found" });
    await expect(findApiOutputBinStock(other.ctx, { identifier: { code: f.bin.code } })).rejects.toMatchObject({ code: "not_found" });
    await expect(findApiOutputBinStock(f.ctx, { identifier: { id: f.bin.id }, facilityId: other.facility.id })).rejects.toMatchObject({ code: "not_found" });
  });

  it("refuses a feedstock bin as the movement history does", async () => {
    const f = await fixture();
    const [fuel] = await db.select().from(storageLocations).where(and(eq(storageLocations.organizationId, f.ctx.organizationId), eq(storageLocations.type, "feedstock_bin")));
    const expected = await requireApiOutputBin(f.ctx, { id: fuel.id }).then(() => null, (error: unknown) => error);
    expect(expected).toMatchObject({ code: "validation_failed" });
    await expect(findApiOutputBinStock(f.ctx, { identifier: { id: fuel.id } })).rejects.toEqual(expected);
  });

  describe("unresolved stock", () => {
    const unresolved = (reason: string) => ({ status: "unresolved", unresolvedReason: reason, totals: null, subBins: [], stockMode: "split" });

    it("answers a completed run without dry biochar mass", async () => {
      const f = await fixture();
      const [reactor] = await db.select().from(reactors).where(eq(reactors.organizationId, f.ctx.organizationId));
      await db.insert(productionRuns).values({ organizationId: f.ctx.organizationId, facilityId: f.facility.id, reactorId: reactor.id, code: `E2E-STOCK-RUN-${f.tag}`,
        status: "complete", startTime: new Date("2026-09-12T08:00:00Z"), endTime: new Date("2026-09-12T12:00:00Z"), biocharStorageLocationId: f.source.id, biocharOutputKg: 100 });
      expect(await findApiOutputBinStock(f.ctx, { identifier: { id: f.source.id } })).toMatchObject(unresolved("run_incomplete"));
    });

    it("answers a product whose composition has an invalid ingredient mass", async () => {
      const f = await fixture();
      const product = await postProduct(f, { massKg: 100 });
      await db.update(biocharProducts).set({ composition: { ingredients: [{ formulationIngredientId: f.ingredient.id, massKg: -1 }] } }).where(eq(biocharProducts.id, product.id));
      expect(await findApiOutputBinStock(f.ctx, { identifier: { id: f.bin.id } })).toMatchObject(unresolved("ingredient_mass_invalid"));
    });

    it("answers a product whose ingredient snapshots do not match its composition", async () => {
      const f = await fixture();
      const product = await postProduct(f, { massKg: 100 });
      await db.update(biocharProducts).set({ composition: { ingredients: [{ formulationIngredientId: f.ingredient.id, massKg: 5 }] } }).where(eq(biocharProducts.id, product.id));
      expect(await findApiOutputBinStock(f.ctx, { identifier: { id: f.bin.id } })).toMatchObject(unresolved("ingredient_snapshot_mismatch"));
    });
  });
});
