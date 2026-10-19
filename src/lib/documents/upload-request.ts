import type { ApiContext } from "@/lib/auth/api-context";
import { canonicalUuid } from "@/lib/api/canonical-uuid";
import { lookupIdentifier } from "@/lib/api/lookup-query";
import { remainingDeadlineMs } from "@/lib/api/write-checks";
import { resolveApiDocumentOwner } from "@/lib/read-models/api-documents";
import { requestDocumentUpload } from "@/lib/operations/document-uploads";
import { runOperation, type RunOptions } from "@/lib/operations/runner";
import type { ApiDocumentOwnerType } from "./api-owners";
import { mintDocumentUploadCapability } from "./upload-capability";

export async function requestDocumentUploadWithCapability(
  ctx: ApiContext, ownerType: ApiDocumentOwnerType, identifier: string, body: unknown,
  options: RunOptions & { deadlineAt: number },
) {
  // UUID retries must reach the idempotency claim even after owner deletion.
  const ownerId = canonicalUuid(identifier) ?? await resolveApiDocumentOwner(ctx, ownerType, lookupIdentifier(identifier));
  const input = body !== null && typeof body === "object" && !Array.isArray(body) ? { ...body, ownerType, ownerId } : body;
  const { deadlineAt, ...runOptions } = options;
  const result = await runOperation(requestDocumentUpload, ctx, input, { ...runOptions, deadlineMs: remainingDeadlineMs(deadlineAt) });
  const capability = await mintDocumentUploadCapability(ctx, result.data.id, { deadlineMs: remainingDeadlineMs(deadlineAt) });
  return { result, body: { data: result.data, upload: capability.upload, ...(capability.warning ? { warnings: [capability.warning] } : {}) } };
}
