"use server";

// Orphaned: no mounted operator entry point. See docs/open-questions.md "isometric/structured-telemetry-path".

import { getStorageProvider } from "@/lib/storage";
import { SafeError } from "@/lib/errors";
import { logger, sanitizeErrorMessage } from "@/lib/log";
import { parseReadingsCsv } from "@/lib/production-readings/readings-csv";
import {
  getProductionRunReadingsImportContext,
  insertProductionRunReadingsSkippingDuplicates,
  recordReadingsImportOutcome,
} from "@/data-access/production-run-reading-imports";
import { importProductionRunReadingsSchema } from "@/schemas/production-run-reading-imports";
import type { ActionResult } from "@/types/actions";
import { withAction } from "./with-action";

const CSV_MIME_TYPES = new Set(["text/csv", "application/vnd.ms-excel"]);

export interface ProductionRunReadingsImportResult {
  productionRunId: string;
  insertedRows: number;
  parsedRows: number;
  inWindowRows: number;
  droppedRows: number;
  skippedRows: number;
  invalidRequiredRows: number;
  /** In-window rows skipped because that (run, timestamp) was already imported. */
  duplicateRows: number;
  /** In-window rows collapsed because the file repeated a timestamp. */
  intraFileDuplicateRows: number;
}

export async function importProductionRunReadingsFromDocumentFn(
  input: unknown,
): Promise<ActionResult<ProductionRunReadingsImportResult>> {
  return withAction(async (ctx) => {
    const { documentId } = importProductionRunReadingsSchema.parse(input);

    // Persist the outcome onto the document so a failed import stays
    // recoverable from the UI (#398): only documents whose prior import failed
    // get a re-import affordance. Context validation runs inside this path too,
    // so a recoverable context failure (e.g. the run has no end time yet)
    // records `failed` and surfaces the re-import action once the operator
    // fixes the run. Any failure past this point is recorded as failed, then
    // re-thrown so the operator still sees the error.
    try {
      const context = await getProductionRunReadingsImportContext(
        ctx,
        documentId,
      );
      assertCsvDocument(context.fileName, context.mimeType);

      const csvText = await readManagedDocumentText(context.storageKey);
      const parsed = parseReadingsForImport({
        csvText,
        runWindowStart: context.runWindowStart,
        runWindowEnd: context.runWindowEnd,
      });

      if (parsed.inWindowRows === 0) {
        // Nothing landed inside the run window. Fail loudly instead of
        // returning a green "Imported 0 readings" toast, so a wrong or
        // out-of-window file is obvious and existing readings are untouched.
        throw new SafeError(
          parsed.parsedRows > 0
            ? parsed.parsedRows === 1
              ? "The timestamped row does not fall within this production run's time window. Check that the file covers the run, or change the run's start and end times."
              : `None of the ${parsed.parsedRows} timestamped rows fall within this production run's time window. Check that the file covers the run, or change the run's start and end times.`
            : "This file has no timestamped readings. Use a readings CSV with a timestamp_utc column and one row per reading.",
        );
      }

      const { insertedRows, intraFileDuplicateRows } =
        await insertProductionRunReadingsSkippingDuplicates(ctx, {
          productionRunId: context.productionRunId,
          readings: parsed.readings,
        });
      // In-window rows that were neither newly inserted nor collapsed as an
      // intra-file duplicate timestamp were already present from a prior
      // import — the visible signal that a re-run is idempotent.
      const duplicateRows =
        parsed.inWindowRows - insertedRows - intraFileDuplicateRows;

      await recordReadingsImportOutcome(ctx, documentId, {
        status: "succeeded",
        insertedRows,
        duplicateRows,
      });

      return {
        productionRunId: context.productionRunId,
        insertedRows,
        parsedRows: parsed.parsedRows,
        inWindowRows: parsed.inWindowRows,
        droppedRows: parsed.droppedRows,
        skippedRows: parsed.skippedRows,
        invalidRequiredRows: parsed.invalidRequiredRows,
        duplicateRows,
        intraFileDuplicateRows,
      };
    } catch (error) {
      // Persist only operator-safe text: document metadata is API-readable, so
      // it follows the toActionError rule — SafeError messages verbatim,
      // anything else (e.g. a Drizzle/Postgres failure whose message embeds
      // query text) collapses to a generic message. withAction already logs
      // the original error server-side.
      const message =
        error instanceof SafeError
          ? error.message
          : "The readings were not imported. Check the file and try again.";
      // Never let a failure to persist the outcome mask the real import error
      // or strand the document without its recoverable "failed" flag (#398):
      // record the outcome best-effort, then always re-throw the original error.
      try {
        await recordReadingsImportOutcome(ctx, documentId, {
          status: "failed",
          error: message,
        });
      } catch (recordError) {
        logger.error(
          { documentId, error: sanitizeErrorMessage(recordError) },
          "Failed to record readings import outcome",
        );
      }
      throw error;
    }
  });
}

function parseReadingsForImport(args: Parameters<typeof parseReadingsCsv>[0]) {
  try {
    return parseReadingsCsv(args);
  } catch (error) {
    throw new SafeError(
      error instanceof Error
        ? error.message
        : "The readings CSV could not be read. Check the file and try again.",
    );
  }
}

async function readManagedDocumentText(storageKey: string): Promise<string> {
  const provider = getStorageProvider();
  try {
    const object = await provider.getObject({ key: storageKey });
    return object.bytes.toString("utf8");
  } catch {
    throw new SafeError(
      "The uploaded readings file could not be read. Upload it again and retry the import.",
    );
  }
}

function assertCsvDocument(fileName: string, mimeType: string | null): void {
  const extension = fileName.split(".").pop()?.toLowerCase();
  if (extension === "csv") return;

  const normalizedMime = mimeType?.split(";")[0]?.trim().toLowerCase();
  if (normalizedMime && CSV_MIME_TYPES.has(normalizedMime)) return;

  throw new SafeError("Only CSV files can be imported as readings.");
}
