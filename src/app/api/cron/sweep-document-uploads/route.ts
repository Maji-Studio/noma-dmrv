import { authorizeCronRequest } from "@/lib/auth/cron";
import { DOCUMENT_SWEEP_DRAIN_BUDGET_MS } from "@/config/documents";
import { sweepDocumentUploads } from "@/data-access/document-upload-sweep";
import { drainStorageObjectDeletionsAcrossOrganizations } from "@/data-access/storage-object-deletions";
import { logger } from "@/lib/log";

export const maxDuration = 60;
export const runtime = "nodejs";

export async function GET(request: Request): Promise<Response> {
  const headers = { "Cache-Control": "private, no-store" };
  const denied = authorizeCronRequest(request);
  if (denied) return denied;
  const swept = await sweepDocumentUploads();
  let drained = { completed: 0, failed: 0, deferred: 0 };
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
