import { requestUpload, confirmUpload } from "@/fn/documents";
import { importProductionRunReadingsFromDocumentFn } from "@/fn/production-run-reading-imports";
import { getStorageProvider } from "@/lib/storage";
import { buildReadingsCsv, READINGS_PER_RUN } from "./readings-csv";
import { SeedError, unwrap, type SeedCounts } from "./actions";

export async function seedReadings(runId: string, start: Date, counts: SeedCounts) {
  const body = buildReadingsCsv(start);
  const contentType = "text/csv";
  const upload = await unwrap(`request readings upload ${runId}`, requestUpload({
    entityType: "production_run", entityId: runId, documentType: "sensor_data",
    fileName: `readings-${runId}.csv`, contentType, sizeBytes: body.byteLength,
  }));
  const provider = getStorageProvider();
  if (provider.name === "local-fs") {
    // Authorized CLI fallback: retain requestUpload/confirmUpload's document
    // validation without depending on a running Next local-upload route.
    await provider.putObject(upload.storageKey, body, contentType);
    console.log(`Local storage upload fallback used for production run ${runId}.`);
  } else {
    const response = await fetch(upload.uploadUrl, {
      method: "PUT", headers: upload.headers, body: new Uint8Array(body), redirect: "error",
    });
    if (!response.ok) throw new SeedError(`upload readings ${runId}: HTTP ${response.status}`);
  }
  await unwrap(`confirm readings upload ${runId}`, confirmUpload({ documentId: upload.documentId }));
  counts.add("sensor CSV documents");
  const imported = await unwrap(`import readings ${runId}`, importProductionRunReadingsFromDocumentFn({ documentId: upload.documentId }));
  if (imported.insertedRows !== READINGS_PER_RUN) {
    throw new SeedError(`import readings ${runId}: expected ${READINGS_PER_RUN} inserted rows, got ${imported.insertedRows}`);
  }
  counts.add("readings", imported.insertedRows);
}
