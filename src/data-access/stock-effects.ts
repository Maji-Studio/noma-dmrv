import { and, eq, inArray } from "drizzle-orm";
import type { DbTransaction } from "@/db";
import { pgErrorCode, PG_QUERY_CANCELED, PG_TRANSACTION_TIMEOUT } from "@/db/errors";
import { storageLocations } from "@/db/schema";
import type { OrgContext } from "@/lib/auth/server";
import { DomainError } from "@/lib/domain-errors";
import { logger } from "@/lib/log";
import type { StockBalance } from "@/lib/representations/stock-effects";
import { requireOrgScope } from "./utils";
import { deriveLaneStock } from "./lane-stock-derivation";
import { getOutputBinAllLayersDryKg } from "./output-stock";

const OBSERVATION_TIMEOUT_CODES = new Set([PG_QUERY_CANCELED, PG_TRANSACTION_TIMEOUT]);
const CONNECTION_FAILURE_CODES = new Set(["57P01", "57P02", "57P03", "ECONNRESET", "ECONNREFUSED", "EPIPE", "ETIMEDOUT"]);

/** Called once per writer attempt with all old/new bins, after locks and before mutation. */
export type SnapshotStock = (tx: DbTransaction, ids: ReadonlyArray<string | null | undefined>) => Promise<void>;

function mustPropagate(error: unknown): boolean {
  const seen = new Set<unknown>();
  let current = error;
  while (current !== null && typeof current === "object" && !seen.has(current)) {
    seen.add(current);
    if (current instanceof DomainError && current.code === "deadline_exceeded") return true;
    const failure = current as { code?: unknown; message?: unknown; cause?: unknown };
    const code = pgErrorCode(current) ?? failure.code;
    if (typeof code === "string" && (OBSERVATION_TIMEOUT_CODES.has(code) || code.startsWith("08") || CONNECTION_FAILURE_CODES.has(code))) return true;
    if (typeof failure.message === "string" && /connection (?:terminated|closed|lost)|client (?:was closed|has encountered a connection error)/i.test(failure.message)) return true;
    current = failure.cause;
  }
  return false;
}

/** A failed observation must leave the writer's transaction usable. */
async function observe<T>(tx: DbTransaction, ids: readonly string[], read: (savepoint: DbTransaction) => Promise<T>): Promise<T | undefined> {
  let readFailure: unknown;
  try {
    return await tx.transaction(async (savepoint) => {
      try {
        return await read(savepoint);
      } catch (error) {
        readFailure = error;
        throw error;
      }
    });
  } catch (error) {
    // Failed SAVEPOINT/RELEASE/ROLLBACK is a transaction failure, not missing stock.
    if (error !== readFailure || mustPropagate(error)) throw error;
    for (const storageLocationId of ids) {
      logger.warn({ errorClass: error instanceof Error ? error.constructor.name : "UnknownError", storageLocationId }, "Stock observation failed");
    }
    return undefined;
  }
}

export async function readStockBalances(ctx: OrgContext, tx: DbTransaction, ids: ReadonlyArray<string | null | undefined>): Promise<StockBalance[]> {
  requireOrgScope(ctx);
  const uniqueIds = [...new Set(ids.filter((id): id is string => !!id))].sort();
  if (!uniqueIds.length) return [];
  const bins = await observe(tx, uniqueIds, async (savepoint) => savepoint
    .select({ id: storageLocations.id, code: storageLocations.code, type: storageLocations.type })
    .from(storageLocations).where(and(eq(storageLocations.organizationId, ctx.organizationId), inArray(storageLocations.id, uniqueIds))));
  // Without metadata there is no honest stock kind/code to report. A missing
  // after observation is treated as unknown by diffStockBalances.
  if (!bins) return [];
  const result: StockBalance[] = [];
  for (const bin of bins.sort((a, b) => a.id.localeCompare(b.id))) {
    if (bin.type !== "feedstock_bin" && bin.type !== "biochar_bin" && bin.type !== "product_bin") continue;
    const balance = await observe(tx, [bin.id], async (savepoint) => {
      if (bin.type === "feedstock_bin") {
        const [stock] = await deriveLaneStock(ctx, savepoint, { storageLocationIds: [bin.id], lanes: "feedstock" });
        return { wetKg: stock?.feedstockStockWetKg ?? 0, dryKg: stock ? stock.feedstockEstimatedDryKg : 0 };
      }
      return { wetKg: null, dryKg: await getOutputBinAllLayersDryKg(ctx, bin.id, savepoint) };
    });
    result.push({ storageLocationId: bin.id, storageLocationCode: bin.code, stockKind: bin.type,
      balance: balance ?? { wetKg: null, dryKg: null } });
  }
  return result;
}
