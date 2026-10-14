import { db, type DbTransaction } from '@/db';
import { biocharProducts, productionRuns, type StorageLocation } from '@/db/schema';
import type { OrgContext } from '@/lib/auth/server';
import type { OutputStockLayer } from '@/lib/output-stock';
import { projectOutputBinStock, resolveStockLayers, unresolvedOutputBinStock, type OutputBinStock, type OutputBinStockFacts } from '@/lib/output-stock/bin-stock-projection';
import type { UnresolvedOutputStockError } from '@/lib/output-stock/layer-projection';
import { and, eq } from 'drizzle-orm';
import { getStockModeAt } from './output-bin-stock-mode';
import { projectOutputBinLayers, projectOutputBinMoistureBases, readOutputBinRows, type OutputBinRef } from './output-stock';
import { requireOrgScope } from './utils';

type Reader = Pick<DbTransaction, 'select'>;

/**
 * One view of the database for a whole stock read. PostgreSQL fixes a
 * repeatable-read snapshot at the transaction's first statement, so every
 * later query sees what that one saw.
 */
const STOCK_SNAPSHOT = { isolationLevel: 'repeatable read', accessMode: 'read only' } as const;

/**
 * Runs `read` in its own read-only snapshot transaction. Every query inside
 * must go through `tx`: the global pool would read another snapshot and, at a
 * pool of one connection, wait on the connection this transaction holds.
 */
export function withStockSnapshot<T>(read: (tx: DbTransaction) => Promise<T>): Promise<T> {
  return db.transaction(read, STOCK_SNAPSHOT);
}

/** An output bin already found in scope, with what a stock read reports about it. */
export type OutputBinStockTarget = Pick<StorageLocation, 'id' | 'code' | 'facilityId' | 'archivedAt' | 'formulationId' | 'stockMode'> & { type: OutputBinRef['type'] };

export interface OutputBinStockReadOptions {
  /** Count archived layers: an archived bin's own layers are archived with it. */
  includeArchived: boolean;
  /** Leave out the readings of the entry a correction replaces. */
  ignoreMovementId?: string;
  /** Rewrites the resolved layers before projection, as a correction restores what it replaces. Reads only through the same reader. */
  adjustLayers?: (layers: OutputStockLayer[]) => Promise<OutputStockLayer[]>;
}

export interface OutputBinStockRead {
  /** A layer without a code carries null: the picker falls back to its id, the API read fails. */
  stock: OutputBinStock<string | null>;
  /** The error behind an unresolved answer, for callers that show it as a failure. */
  unresolved: UnresolvedOutputStockError | null;
}

/** Run codes for a biochar bin's layers, product codes for a product bin's. */
async function readLayerCodes(ctx: OrgContext, bin: Pick<OutputBinStockTarget, 'id' | 'type'>, reader: Reader): Promise<Map<string, string>> {
  const rows = bin.type === 'product_bin'
    ? await reader.select({ id: biocharProducts.id, code: biocharProducts.code }).from(biocharProducts).where(and(eq(biocharProducts.organizationId, ctx.organizationId), eq(biocharProducts.storageLocationId, bin.id)))
    : await reader.select({ id: productionRuns.id, code: productionRuns.code }).from(productionRuns).where(and(eq(productionRuns.organizationId, ctx.organizationId), eq(productionRuns.biocharStorageLocationId, bin.id)));
  return new Map(rows.map(row => [row.id, row.code]));
}

function stockFacts(bin: OutputBinStockTarget): OutputBinStockFacts {
  return { storageLocationId: bin.id, code: bin.code, type: bin.type, facilityId: bin.facilityId, archivedAt: bin.archivedAt?.toISOString() ?? null,
    formulationId: bin.type === 'product_bin' ? bin.formulationId : null };
}

/**
 * What `bin` holds at `at`, every row read through `reader`. Pass a snapshot
 * transaction (`withStockSnapshot`) and an instant taken after its first
 * statement, so a layer the snapshot sees is never left out as placed later.
 * The picker and the API stock read both project through here.
 */
export async function readOutputBinStockAt(ctx: OrgContext, bin: OutputBinStockTarget, at: string, reader: Reader, options: OutputBinStockReadOptions): Promise<OutputBinStockRead> {
  requireOrgScope(ctx);
  const ref: OutputBinRef = { id: bin.id, type: bin.type, facilityId: bin.facilityId, includeArchived: options.includeArchived };
  const [rows, codes, stockMode] = await Promise.all([readOutputBinRows(ctx, ref, reader), readLayerCodes(ctx, bin, reader), getStockModeAt(ctx, bin, at, reader)]);
  const facts = stockFacts(bin);
  const resolved = resolveStockLayers(() => projectOutputBinLayers(ref, rows), at);
  if (resolved.status === 'unresolved') return { stock: unresolvedOutputBinStock(facts, stockMode, resolved.error.reason), unresolved: resolved.error };
  const layers = options.adjustLayers ? await options.adjustLayers(resolved.layers) : resolved.layers;
  const bases = projectOutputBinMoistureBases(ref, layers, rows, options.ignoreMovementId);
  return { stock: projectOutputBinStock({ bin: facts, stockMode, at, layers, bases, codes }), unresolved: null };
}
