import { createHash } from "node:crypto";
import path from "node:path";
import type { APIRequestContext } from "@playwright/test";
import { and, eq, inArray, isNull } from "drizzle-orm";
import * as schema from "../../../src/db/schema";
import { buildFinalStorageKey } from "../../../src/lib/storage/keys";
import { LocalFsProvider } from "../../../src/lib/storage/local-fs";
import { createDbConnection } from "./db";
import { fixtureOrgId } from "./fixture-org";
import type { SeededReadyBatch } from "./certification-helpers";

/** Forestry waste, supplied by the Isometric sandbox catalogue. */
export const SANDBOX_FEEDSTOCK_TYPE_ID = "ftt_1K9YJNV5TSBXJV9D";
const PDF_MIME_TYPE = "application/pdf";
const PDF_XREF_OFFSET_WIDTH = 10;
const HTTP_OK = 200;
const HTTP_REDIRECT = 302;
const HTTP_FORBIDDEN = 403;
const HTTP_NOT_FOUND = 404;
const STORAGE_REQUEST_TIMEOUT_MS = 30_000;
const FIXTURE_SIGNING_SECRET = "e2e-live-submit-unused-signing-secret";

// A complete one-page PDF, including byte-accurate stream length and xref.
function evidencePdf(): Buffer {
  const stream = "BT /F1 12 Tf 36 100 Td (E2E sandbox supporting evidence) Tj ET\n";
  const objects = [
    "<< /Type /Catalog /Pages 2 0 R >>",
    "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
    "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 300 150] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>",
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
    `<< /Length ${Buffer.byteLength(stream)} >>\nstream\n${stream}endstream`,
  ];
  let pdf = "%PDF-1.4\n";
  const offsets = objects.map((object, index) => {
    const offset = Buffer.byteLength(pdf);
    pdf += `${index + 1} 0 obj\n${object}\nendobj\n`;
    return offset;
  });
  const xrefOffset = Buffer.byteLength(pdf);
  pdf += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  pdf += offsets.map((offset) => `${String(offset).padStart(PDF_XREF_OFFSET_WIDTH, "0")} 00000 n \n`).join("");
  pdf += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xrefOffset}\n%%EOF\n`;
  return Buffer.from(pdf);
}

export async function liveSubmitStorageSkipReason(request: APIRequestContext): Promise<string | undefined> {
  const provider = process.env.STORAGE_PROVIDER?.trim() || "local-fs";
  if (provider !== "local-fs") {
    return "Live submit evidence requires STORAGE_PROVIDER=local-fs; the configured provider is unsupported (including CI s3-compatible placeholders).";
  }
  // This route gates on the SERVER's provider before checking for a token.
  // No token means no disk access: local-fs returns 403; other providers 404.
  const probe = await request.get("/api/storage-local/e2e-live-submit-provider-probe", {
    maxRedirects: 0, timeout: STORAGE_REQUEST_TIMEOUT_MS,
  });
  if (probe.status() === HTTP_NOT_FOUND) {
    return "Live submit skipped: the server's local-fs storage route is unavailable (non-local storage providers are unsupported).";
  }
  if (probe.status() !== HTTP_FORBIDDEN) {
    throw new Error("Live submit could not determine the server's storage provider from its local-fs route.");
  }
}

/**
 * Never infer the reused Next server's root from Playwright's .env.test.
 * The operator supplies the server's resolved root; authenticated byte readback
 * below proves the server sees it before any external submit is attempted.
 */
export async function prepareLiveSubmitEvidence(
  batch: SeededReadyBatch,
  request: APIRequestContext,
): Promise<() => Promise<void>> {
  const root = process.env.E2E_LIVE_SUBMIT_STORAGE_ROOT;
  if (!root || !path.isAbsolute(root)) {
    throw new Error(
      "Live submit cannot determine a reused Next server's storage root. Set E2E_LIVE_SUBMIT_STORAGE_ROOT to the absolute path resolved by the SERVER from STORAGE_LOCAL_FS_ROOT (default .storage under its cwd). Do not copy Playwright's .storage-test value unless the server uses it too.",
    );
  }
  const provider = new LocalFsProvider({
    root,
    appUrl: "http://localhost",
    // Only direct disk I/O is used here; download tokens come from the server.
    signingSecret: FIXTURE_SIGNING_SECRET,
  });
  const keys: string[] = [];
  const cleanup = async () => {
    for (const key of keys) await provider.deleteObject(key);
  };
  const { db, pool } = createDbConnection();
  try {
    const organizationId = fixtureOrgId();
    if (!batch.documentIds.length) throw new Error("Live submit fixture has no seed-owned document IDs.");
    const documents = await db.select().from(schema.documents).where(and(
      eq(schema.documents.organizationId, organizationId),
      inArray(schema.documents.id, batch.documentIds),
      isNull(schema.documents.storageKey),
    ));
    if (!documents.length) throw new Error("Live submit fixture has no URL-only seed documents to prepare.");
    const bytes = evidencePdf();
    const checksumSha256 = createHash("sha256").update(bytes).digest("hex");
    for (const document of documents) {
      // Evidence completeness consumes this as CSV; retain its seeded contents.
      if (document.entityType === "production_run" && document.documentType === "sensor_data") continue;
      const fileName = `${path.parse(document.fileName).name}.pdf`;
      const storageKey = buildFinalStorageKey({
        organizationId, entityType: document.entityType, entityId: document.entityId,
        documentType: document.documentType, documentId: document.id,
        fileName, sha256: checksumSha256,
      });
      keys.push(storageKey);
      await provider.putObject(storageKey, bytes, PDF_MIME_TYPE);
      await db.update(schema.documents).set({
        storageProvider: "local-fs", storageBucket: "local-fs", storageKey,
        fileUrl: null, fileName, fileSizeBytes: bytes.byteLength,
        mimeType: PDF_MIME_TYPE, checksumSha256, uploadStatus: "uploaded",
      }).where(and(eq(schema.documents.organizationId, organizationId), eq(schema.documents.id, document.id)));

      const redirect = await request.get(`/api/documents/${document.id}`, {
        maxRedirects: 0, timeout: STORAGE_REQUEST_TIMEOUT_MS,
      });
      const location = redirect.headers().location;
      if (redirect.status() !== HTTP_REDIRECT || !location ||
          !new URL(location).pathname.startsWith("/api/storage-local/")) {
        throw new Error("Live submit could not verify server local-fs storage. Check the SERVER's STORAGE_PROVIDER and E2E_LIVE_SUBMIT_STORAGE_ROOT.");
      }
      const response = await request.get(location, { maxRedirects: 0, timeout: STORAGE_REQUEST_TIMEOUT_MS });
      if (response.status() !== HTTP_OK || !(await response.body()).equals(bytes)) {
        throw new Error("Live submit evidence is not readable by the SERVER. E2E_LIVE_SUBMIT_STORAGE_ROOT must match its resolved STORAGE_LOCAL_FS_ROOT, not Playwright's root.");
      }
    }
    const [creditBatch] = await db.select({ feedstockTypeId: schema.creditBatches.feedstockTypeId })
      .from(schema.creditBatches).where(and(
        eq(schema.creditBatches.organizationId, organizationId), eq(schema.creditBatches.id, batch.creditBatchId),
      ));
    if (!creditBatch) throw new Error("Live submit fixture credit batch is missing.");
    // The seed's cleanup retains responsibility for restoring the original ID.
    await db.update(schema.feedstockTypes).set({ isometricFeedstockTypeId: SANDBOX_FEEDSTOCK_TYPE_ID })
      .where(and(eq(schema.feedstockTypes.organizationId, organizationId), eq(schema.feedstockTypes.id, creditBatch.feedstockTypeId)));
    return cleanup;
  } catch (error) {
    await cleanup();
    throw error;
  } finally {
    await pool.end();
  }
}
