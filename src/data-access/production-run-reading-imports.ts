import { and, eq, gte, lt } from "drizzle-orm";
import { db } from "@/db";
import { documents, productionRunReadings, productionRuns } from "@/db/schema";
import { SafeError } from "@/lib/errors";
import type { ReadingsCsvRow } from "@/lib/production-readings/readings-csv";
import { requireAuth } from "./utils";

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
      runDate: productionRuns.date,
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

export async function replaceProductionRunReadingsInWindow(
  userId: string,
  args: {
    productionRunId: string;
    windowStart: Date;
    windowEnd: Date;
    readings: ReadingsCsvRow[];
  },
): Promise<number> {
  requireAuth(userId);

  const [run] = await db
    .select({ id: productionRuns.id })
    .from(productionRuns)
    .where(eq(productionRuns.id, args.productionRunId));

  if (!run) throw new SafeError("Production run not found");

  await db.transaction(async (tx) => {
    await tx
      .delete(productionRunReadings)
      .where(
        and(
          eq(productionRunReadings.productionRunId, args.productionRunId),
          gte(productionRunReadings.timestamp, args.windowStart),
          lt(productionRunReadings.timestamp, args.windowEnd),
        ),
      );

    if (args.readings.length === 0) return;

    await tx.insert(productionRunReadings).values(
      args.readings.map((reading) => ({
        productionRunId: args.productionRunId,
        timestamp: reading.timestamp,
        temperatureC: reading.temperatureC,
        pressureBar: reading.pressureBar,
        dryerFrequencyHz: reading.dryerFrequencyHz,
        reactorFrequencyHz: reading.reactorFrequencyHz,
      })),
    );
  });

  return args.readings.length;
}
