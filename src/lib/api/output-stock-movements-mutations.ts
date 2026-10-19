import { apiAudit } from "@/lib/api/audit";
import { DomainError } from "@/lib/domain-errors";
import { toOperationJsonSchema } from "@/lib/operations/json-schema";
import { runWithStockBasisPreview } from "@/lib/operations/stock-basis-preview";
import { recordOutputStockMovementApiBody } from "@/schemas/output-stock-movement-input";
import { recordedMovementBody, representationCheckedRecord } from "./output-stock-movement-write-checks";
import { mutationQuerySchema, parseApiQuery } from "./query";
import { readIdempotencyKey, readJsonBody } from "./request-body";
import type { ApiRouteContext } from "./route";
import { rejectUnknownFields } from "./unknown-fields";
import { canonicalUuid } from "./canonical-uuid";

const bodyContract = toOperationJsonSchema(recordOutputStockMovementApiBody);
const BIN_NOT_FOUND_MESSAGE = "Storage location was not found.";

/**
 * POST a loss or count on an output bin. Writes take the bin's UUID only, like
 * every other write target; a code answers 404. There is no movement GET, so
 * the 201 carries no Location, and movements are unversioned, so no ETag.
 */
export async function recordOutputStockMovementResponse(request: Request, { ctx, headers, deadlineAt, requestId }: ApiRouteContext, segment: string) {
  const { dryRun } = parseApiQuery(request, mutationQuerySchema);
  const key = readIdempotencyKey(request, true);
  const storageLocationId = canonicalUuid(segment);
  if (!storageLocationId) {
    throw new DomainError("not_found", BIN_NOT_FOUND_MESSAGE, { issues: [{ path: ["storageLocationId"], code: "not_found", message: BIN_NOT_FOUND_MESSAGE }] });
  }
  const body = await readJsonBody(request);
  rejectUnknownFields(body, bodyContract);
  // Non-object values reach the operation's validation rather than becoming a bin-only body.
  const input = body !== null && typeof body === "object" && !Array.isArray(body) ? { ...body, storageLocationId } : body;
  const result = await runWithStockBasisPreview(representationCheckedRecord, ctx, input, {
    deadlineAt, dryRun,
    audit: apiAudit(ctx, requestId, "rest"),
    idempotency: key ? { credentialId: ctx.credentialId, key, target: storageLocationId } : undefined,
  }, (data) => data.basisFingerprint);
  if (result.replayed) headers.set("Idempotent-Replayed", "true");
  if (dryRun) headers.set("Dry-Run", "true");
  return Response.json(recordedMovementBody(result, dryRun), { status: dryRun ? 200 : 201, headers });
}
