import { createHash, timingSafeEqual } from "node:crypto";
import { env } from "@/config/env";
import { DOCUMENT_SWEEP_DRAIN_BUDGET_MS } from "@/config/documents";
import { sweepDocumentUploads } from "@/data-access/document-upload-sweep";
import { drainStorageObjectDeletionsAcrossOrganizations } from "@/data-access/storage-object-deletions";
import { logger } from "@/lib/log";

export const maxDuration = 60;
export const runtime = "nodejs";

export async function GET(request: Request): Promise<Response> {
  const headers = { "Cache-Control": "private, no-store" };
  if (!env.CRON_SECRET) return new Response(null, { status: 503, headers });
  const supplied = createHash("sha256").update(request.headers.get("authorization") ?? "").digest();
  const expected = createHash("sha256").update(`Bearer ${env.CRON_SECRET}`).digest();
  if (!timingSafeEqual(supplied, expected)) return new Response(null, { status: 401, headers });
  const swept = await sweepDocumentUploads();
  let drained = { completed: 0, failed: 0 };
  try {
    drained = await drainStorageObjectDeletionsAcrossOrganizations(DOCUMENT_SWEEP_DRAIN_BUDGET_MS);
    if (drained.failed > 0) swept.failedPhases.push("drain");
  } catch {
    swept.failedPhases.push("drain");
    drained.failed++;
  }
  const counts = { ...swept, ...drained };
  if (swept.failedPhases.includes("drain")) logger.error({ phase: "drain", ...counts }, "Document upload sweep phase failed");
  logger.info(counts, "Document uploads swept");
  return Response.json(counts, { status: swept.failedPhases.length ? 500 : 200, headers });
}
