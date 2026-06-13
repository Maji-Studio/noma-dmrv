"use server";

import { getStorageProvider } from "@/lib/storage";
import { SafeError } from "@/lib/errors";
import {
  inspectReactorDayCsv,
  parseReactorDayCsv,
  type ReactorDayCsvMapping,
} from "@/lib/production-readings/reactor-day-csv";
import {
  buildStoredReactorDayCsvMapping,
  getProductionRunReadingsImportContext,
  replaceProductionRunReadingsInWindow,
  saveReactorDayCsvMapping,
} from "@/data-access/production-run-reading-imports";
import {
  importProductionRunReadingsSchema,
  previewProductionRunReadingsImportSchema,
} from "@/schemas/production-run-reading-imports";
import type { ActionResult } from "@/types/actions";
import { withAction } from "./with-action";

const CSV_MIME_TYPES = new Set([
  "text/csv",
  "application/vnd.ms-excel",
]);

export interface ProductionRunReadingsImportPreview {
  documentId: string;
  fileName: string;
  runCode: string;
  fileReactorCode: string;
  fileDate: string;
  headers: string[];
  headerSignature: string;
  requiresMapping: boolean;
  suggestedMapping: ReactorDayCsvMapping;
  warnings: string[];
}

export interface ProductionRunReadingsImportResult {
  productionRunId: string;
  insertedRows: number;
  parsedRows: number;
  inWindowRows: number;
  droppedRows: number;
  fileReactorCode: string;
  fileDate: string;
  warnings: string[];
}

export async function previewProductionRunReadingsImportFn(
  input: unknown,
): Promise<ActionResult<ProductionRunReadingsImportPreview>> {
  return withAction(async (userId) => {
    const { documentId } = previewProductionRunReadingsImportSchema.parse(input);
    const context = await getProductionRunReadingsImportContext(
      userId,
      documentId,
    );
    assertCsvDocument(context.fileName, context.mimeType);
    const csvText = await readManagedDocumentText(context.storageKey);
    const inspection = inspectReactorDayCsv({
      fileName: context.fileName,
      csvText,
      runReactorCode: context.reactorCode,
      storedMapping: context.storedMapping,
    });

    return {
      documentId,
      fileName: context.fileName,
      runCode: context.runCode,
      ...inspection,
    };
  });
}

export async function importProductionRunReadingsFromDocumentFn(
  input: unknown,
): Promise<ActionResult<ProductionRunReadingsImportResult>> {
  return withAction(async (userId) => {
    const { documentId, mapping } =
      importProductionRunReadingsSchema.parse(input);
    const context = await getProductionRunReadingsImportContext(
      userId,
      documentId,
    );
    assertCsvDocument(context.fileName, context.mimeType);
    const csvText = await readManagedDocumentText(context.storageKey);
    const inspection = inspectReactorDayCsv({
      fileName: context.fileName,
      csvText,
      runReactorCode: context.reactorCode,
      storedMapping: context.storedMapping,
    });

    const selectedMapping = mapping ?? context.storedMapping;
    if (!selectedMapping) {
      throw new SafeError("Channel alignment is required before import.");
    }
    if (inspection.requiresMapping && !mapping) {
      throw new SafeError(
        "CSV header changed. Confirm channel alignment before import.",
      );
    }

    const parsed = parseReactorDayCsv({
      fileName: context.fileName,
      csvText,
      timezone: context.facilityTimezone,
      runWindowStart: context.runWindowStart,
      runWindowEnd: context.runWindowEnd,
      mapping: selectedMapping,
    });

    if (mapping || inspection.requiresMapping) {
      await saveReactorDayCsvMapping(
        userId,
        context.reactorId,
        buildStoredReactorDayCsvMapping(
          inspection.headerSignature,
          selectedMapping,
        ),
      );
    }

    const insertedRows = await replaceProductionRunReadingsInWindow(userId, {
      productionRunId: context.productionRunId,
      windowStart: parsed.replacementWindowStart,
      windowEnd: parsed.replacementWindowEnd,
      readings: parsed.readings,
    });

    return {
      productionRunId: context.productionRunId,
      insertedRows,
      parsedRows: parsed.parsedRows,
      inWindowRows: parsed.inWindowRows,
      droppedRows: parsed.droppedRows,
      fileReactorCode: parsed.fileReactorCode,
      fileDate: parsed.fileDate,
      warnings: inspection.warnings,
    };
  });
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

  throw new SafeError("Only CSV reactor-day files can be imported as readings.");
}
