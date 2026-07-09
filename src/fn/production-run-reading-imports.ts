"use server";

import { getStorageProvider } from "@/lib/storage";
import { SafeError } from "@/lib/errors";
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
}

export async function importProductionRunReadingsFromDocumentFn(
  input: unknown,
): Promise<ActionResult<ProductionRunReadingsImportResult>> {
  return withAction(async (userId) => {
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
        userId,
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
            ? `None of the ${parsed.parsedRows} timestamped row(s) fall within this run's time window. Check the file covers the run period, or adjust the run's start and end times.`
            : "No timestamped readings were found in this file. Check it is a canonical readings CSV with a timestamp_utc column and one row per reading.",
        );
      }

      const insertedRows = await insertProductionRunReadingsSkippingDuplicates(
        userId,
        {
          productionRunId: context.productionRunId,
          readings: parsed.readings,
        },
      );
      // Everything that was in-window but not newly inserted was already
      // present — the visible signal that a re-run is idempotent.
      const duplicateRows = parsed.inWindowRows - insertedRows;

      await recordReadingsImportOutcome(userId, documentId, {
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
      };
    } catch (error) {
      await recordReadingsImportOutcome(userId, documentId, {
        status: "failed",
        error:
          error instanceof Error ? error.message : "Failed to import readings",
      });
      throw error;
    }
  });
}

function parseReadingsForImport(args: Parameters<typeof parseReadingsCsv>[0]) {
  try {
    return parseReadingsCsv(args);
  } catch (error) {
    throw new SafeError(
      error instanceof Error ? error.message : "Failed to parse readings CSV.",
    );
  }
}

async function readManagedDocumentText(storageKey: string): Promise<string> {
  const provider = getStorageProvider();
  const url = await provider.createDownloadUrl({ key: storageKey });
  const response = await fetch(url, { redirect: "error" });
  if (!response.ok) {
    throw new SafeError(`Failed to read uploaded file (${response.status}).`);
  }
  return response.text();
}

function assertCsvDocument(fileName: string, mimeType: string | null): void {
  const extension = fileName.split(".").pop()?.toLowerCase();
  if (extension === "csv") return;

  const normalizedMime = mimeType?.split(";")[0]?.trim().toLowerCase();
  if (normalizedMime && CSV_MIME_TYPES.has(normalizedMime)) return;

  throw new SafeError("Only CSV files can be imported as readings.");
}
