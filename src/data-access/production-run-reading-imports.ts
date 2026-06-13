import { and, eq, gte, lt } from "drizzle-orm";
import { db } from "@/db";
import {
  documents,
  facilities,
  productionRunReadings,
  productionRuns,
  reactors,
} from "@/db/schema";
import { SafeError } from "@/lib/errors";
import type {
  ReactorDayCsvMapping,
  ReactorDayCsvReading,
  StoredReactorDayCsvMapping,
} from "@/lib/production-readings/reactor-day-csv";
import { requireAuth } from "./utils";

const REACTOR_DAY_CSV_MAPPING_KEY = "reactorDayCsvMapping";

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
  reactorId: string;
  reactorCode: string;
  facilityTimezone: string;
  storedMapping: StoredReactorDayCsvMapping | null;
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
      reactorId: reactors.id,
      reactorCode: reactors.code,
      reactorSpecifications: reactors.specifications,
      facilityTimezone: facilities.timezone,
    })
    .from(documents)
    .innerJoin(productionRuns, eq(documents.entityId, productionRuns.id))
    .innerJoin(reactors, eq(productionRuns.reactorId, reactors.id))
    .innerJoin(facilities, eq(productionRuns.facilityId, facilities.id))
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
  if (!row.facilityTimezone) {
    throw new SafeError(
      "Set the facility timezone before importing reactor-day readings.",
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
    reactorId: row.reactorId,
    reactorCode: row.reactorCode,
    facilityTimezone: row.facilityTimezone,
    storedMapping: readStoredMapping(row.reactorSpecifications),
  };
}

export async function saveReactorDayCsvMapping(
  userId: string,
  reactorId: string,
  mapping: StoredReactorDayCsvMapping,
): Promise<void> {
  requireAuth(userId);

  const [row] = await db
    .select({ specifications: reactors.specifications })
    .from(reactors)
    .where(eq(reactors.id, reactorId));

  if (!row) throw new SafeError("Reactor not found");

  const specifications = isRecord(row.specifications)
    ? row.specifications
    : {};

  await db
    .update(reactors)
    .set({
      specifications: {
        ...specifications,
        [REACTOR_DAY_CSV_MAPPING_KEY]: mapping,
      },
      updatedAt: new Date(),
    })
    .where(eq(reactors.id, reactorId));
}

export async function replaceProductionRunReadingsInWindow(
  userId: string,
  args: {
    productionRunId: string;
    windowStart: Date;
    windowEnd: Date;
    readings: ReactorDayCsvReading[];
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
        gasFlowRate: reading.gasFlowRate,
      })),
    );
  });

  return args.readings.length;
}

function readStoredMapping(
  specifications: unknown,
): StoredReactorDayCsvMapping | null {
  if (!isRecord(specifications)) return null;
  const mapping = specifications[REACTOR_DAY_CSV_MAPPING_KEY];
  if (!isRecord(mapping)) return null;

  if (
    typeof mapping.headerSignature !== "string" ||
    typeof mapping.temperature !== "string" ||
    typeof mapping.pressure !== "string"
  ) {
    return null;
  }

  return {
    headerSignature: mapping.headerSignature,
    temperature: mapping.temperature,
    pressure: mapping.pressure,
    gasFlow: typeof mapping.gasFlow === "string" ? mapping.gasFlow : null,
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function buildStoredReactorDayCsvMapping(
  headerSignature: string,
  mapping: ReactorDayCsvMapping,
): StoredReactorDayCsvMapping {
  return {
    headerSignature,
    temperature: mapping.temperature,
    pressure: mapping.pressure,
    gasFlow: mapping.gasFlow ?? null,
  };
}
