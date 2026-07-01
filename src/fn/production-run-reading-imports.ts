"use server";

import { getStorageProvider } from "@/lib/storage";
import { SafeError } from "@/lib/errors";
import { parseReadingsCsv } from "@/lib/production-readings/readings-csv";
import {
  getProductionRunReadingsImportContext,
  replaceProductionRunReadingsInWindow,
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
}

export async function importProductionRunReadingsFromDocumentFn(
  input: unknown,
): Promise<ActionResult<ProductionRunReadingsImportResult>> {
  return withAction(async (userId) => {
    const { documentId } = importProductionRunReadingsSchema.parse(input);
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

    if (!parsed.replacementWindow) {
      // Nothing landed inside the run window. Fail loudly instead of returning
      // a green "Imported 0 readings" toast, so a wrong or out-of-window file
      // is obvious and existing readings are known to be untouched.
      throw new SafeError(
        parsed.parsedRows > 0
          ? `None of the ${parsed.parsedRows} timestamped row(s) fall within this run's time window. Check the file covers the run period, or adjust the run's start and end times.`
          : "No timestamped readings were found in this file. Check it is a canonical readings CSV with a timestamp_utc column and one row per reading.",
      );
    }

    const insertedRows = await replaceProductionRunReadingsInWindow(userId, {
      productionRunId: context.productionRunId,
      windowStart: parsed.replacementWindow.start,
      windowEnd: parsed.replacementWindow.end,
      readings: parsed.readings,
    });

    return {
      productionRunId: context.productionRunId,
      insertedRows,
      parsedRows: parsed.parsedRows,
      inWindowRows: parsed.inWindowRows,
      droppedRows: parsed.droppedRows,
      skippedRows: parsed.skippedRows,
      invalidRequiredRows: parsed.invalidRequiredRows,
    };
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
