import { eq, sql } from "drizzle-orm";
import { db } from "@/db";
import { documents, productionRunReadings, productionRuns } from "@/db/schema";
import { SafeError } from "@/lib/errors";
import type { ReadingsCsvRow } from "@/lib/production-readings/readings-csv";
import { requireAuth } from "./utils";
import { productionRunDateExpr } from "./production-runs/date-expr";

export interface ProductionRunReadingsImportContext {
  documentId: string;
  fileName: string;
  storageKey: string;
  mimeType: string | null;
  productionRunId: string;
  runCode: string;
  runDate: string;
  runWindowStart: Date;
  runWindowEnd: Date;
}

export async function getProductionRunReadingsImportContext(
  userId: string,
  documentId: string,
): Promise<ProductionRunReadingsImportContext> {
  requireAuth(userId);

  const [row] = await db
    .select({
      documentId: documents.id,
      entityType: documents.entityType,
      documentType: documents.documentType,
      uploadStatus: documents.uploadStatus,
      fileName: documents.fileName,
      storageKey: documents.storageKey,
      mimeType: documents.mimeType,
      productionRunId: productionRuns.id,
      runCode: productionRuns.code,
      runDate: productionRunDateExpr(),
      runWindowStart: productionRuns.startTime,
      runWindowEnd: productionRuns.endTime,
    })
    .from(documents)
    .innerJoin(productionRuns, eq(documents.entityId, productionRuns.id))
    .where(eq(documents.id, documentId));

  if (!row) throw new SafeError("Readings file not found");
  if (row.entityType !== "production_run" || row.documentType !== "sensor_data") {
    throw new SafeError("Document is not a production-run readings file");
  }
  if (row.uploadStatus !== "uploaded") {
    throw new SafeError("Readings file is not uploaded yet");
  }
  if (!row.storageKey) {
    throw new SafeError("Readings file has no managed storage key");
  }
  // An open run has no end instant, so there is no window to slot readings into.
  // Reject with a clear message rather than the old zero-duration failure (#259,
  // the misleading-error half of #207).
  if (!row.runWindowEnd) {
    throw new SafeError(
      `Run ${row.runCode} has no end time yet — set the run's end time before importing readings`,
    );
  }

  return {
    documentId: row.documentId,
    fileName: row.fileName,
    storageKey: row.storageKey,
    mimeType: row.mimeType,
    productionRunId: row.productionRunId,
    runCode: row.runCode,
    runDate: row.runDate,
    runWindowStart: row.runWindowStart,
    runWindowEnd: row.runWindowEnd,
  };
}

/**
 * Insert parsed readings, skipping any row whose `(production_run_id, timestamp)`
 * already exists (#398). ON CONFLICT DO NOTHING against the unique index — never
 * an upsert: telemetry already published to Isometric must not be silently
 * rewritten. Returns the number of rows actually inserted, so the caller can
 * report `parsed − inserted` as "already imported" and re-imports are visibly
 * idempotent.
 */
export async function insertProductionRunReadingsSkippingDuplicates(
  userId: string,
  args: {
    productionRunId: string;
    readings: ReadingsCsvRow[];
  },
): Promise<number> {
  requireAuth(userId);

  const [run] = await db
    .select({ id: productionRuns.id })
    .from(productionRuns)
    .where(eq(productionRuns.id, args.productionRunId));

  if (!run) throw new SafeError("Production run not found");

  // Collapse duplicate timestamps within the same file first: ON CONFLICT DO
  // NOTHING guards against rows already in the table, but two rows with the
  // same timestamp inside one INSERT statement would still trip the unique
  // index. Last occurrence wins.
  const deduped = Array.from(
    new Map(
      args.readings.map((reading) => [reading.timestamp.getTime(), reading]),
    ).values(),
  );
  if (deduped.length === 0) return 0;

  const inserted = await db
    .insert(productionRunReadings)
    .values(
      deduped.map((reading) => ({
        productionRunId: args.productionRunId,
        timestamp: reading.timestamp,
        temperatureC: reading.temperatureC,
        pressureBar: reading.pressureBar,
        dryerFrequencyHz: reading.dryerFrequencyHz,
        reactorFrequencyHz: reading.reactorFrequencyHz,
      })),
    )
    .onConflictDoNothing({
      target: [
        productionRunReadings.productionRunId,
        productionRunReadings.timestamp,
      ],
    })
    .returning({ id: productionRunReadings.id });

  return inserted.length;
}

export interface ReadingsImportOutcome {
  status: "succeeded" | "failed";
  error?: string;
  insertedRows?: number;
  duplicateRows?: number;
}

/**
 * Persist the outcome of a readings import onto the source document's metadata
 * (#398). Durable status is what lets the UI offer a re-import affordance on a
 * document whose prior import failed, and only on those documents. Merges into
 * `metadata` so unrelated keys survive.
 */
export async function recordReadingsImportOutcome(
  userId: string,
  documentId: string,
  outcome: ReadingsImportOutcome,
): Promise<void> {
  requireAuth(userId);

  const patch = {
    readingsImport: { ...outcome, at: new Date().toISOString() },
  };
  await db
    .update(documents)
    .set({
      metadata: sql`${documents.metadata} || ${JSON.stringify(patch)}::jsonb`,
      updatedAt: new Date(),
    })
    .where(eq(documents.id, documentId));
}
