import { DomainError } from "@/lib/domain-errors";
import { toOperationJsonSchema } from "@/lib/operations/json-schema";
import { runOperation } from "@/lib/operations/runner";
import { runWithStockBasisPreview } from "@/lib/operations/stock-basis-preview";
import { recordDeliveryInput, updateDeliveryApiInput } from "@/schemas/delivery-input";
import { canonicalUuid } from "./canonical-uuid";
import { parseIfMatch } from "./etag";
import { remainingDeadlineMs } from "./feedstock-write-checks";
import { deliveryWriteEtag, deliveryBody, recordedDeliveryBody, representationCheckedRecord, representationCheckedUpdate, withCurrentOnStale } from "./delivery-write-checks";
import { mutationQuerySchema, parseApiQuery } from "./query";
import { readIdempotencyKey, readJsonBody } from "./request-body";
import type { ApiRouteContext } from "./route";
import { rejectUnknownFields } from "./unknown-fields";

const createContract = toOperationJsonSchema(recordDeliveryInput);
const patchContract = toOperationJsonSchema(updateDeliveryApiInput.omit({ expectedVersion: true }));

export async function createDeliveryResponse(request: Request, { ctx, headers, deadlineAt, requestId }: ApiRouteContext) {
  const { dryRun } = parseApiQuery(request, mutationQuerySchema);
  const key = readIdempotencyKey(request, true);
  const body = await readJsonBody(request);
  rejectUnknownFields(body, createContract);
  const result = await runWithStockBasisPreview(representationCheckedRecord, ctx, body, {
    deadlineAt, dryRun,
    audit: { requestId, credentialId: ctx.credentialId, transport: "rest" as const },
    idempotency: key ? { credentialId: ctx.credentialId, key } : undefined,
  }, data => data.basisFingerprint, data => data.allocations);
  const responseBody = recordedDeliveryBody(result, dryRun);
  if (result.replayed) headers.set("Idempotent-Replayed", "true");
  if (dryRun) headers.set("Dry-Run", "true");
  else {
    headers.set("Location", `/api/v1/deliveries/${responseBody.data.id}`);
    headers.set("ETag", deliveryWriteEtag(result.data));
  }
  return Response.json(responseBody, { status: dryRun ? 200 : 201, headers });
}

export async function updateDeliveryResponse(request: Request, { ctx, headers, deadlineAt, requestId }: ApiRouteContext, segment: string) {
  const { dryRun } = parseApiQuery(request, mutationQuerySchema);
  const precondition = request.headers.get("if-match");
  const { version, revision } = parseIfMatch(precondition);
  const id = canonicalUuid(segment);
  if (!id) throw new DomainError("not_found", "Delivery was not found.");
  const key = readIdempotencyKey(request, false);
  return withCurrentOnStale(ctx, id, async () => {
    const body = await readJsonBody(request);
    rejectUnknownFields(body, patchContract);
    const input = body !== null && typeof body === "object" && !Array.isArray(body)
      ? { ...body, deliveryId: id, expectedVersion: version } : body;
    const result = await runOperation(representationCheckedUpdate(id, revision), ctx, input, {
      deadlineMs: remainingDeadlineMs(deadlineAt), dryRun,
      audit: { requestId, credentialId: ctx.credentialId, transport: "rest" as const },
      idempotency: key ? { credentialId: ctx.credentialId, key, target: id, precondition: precondition! } : undefined,
    });
    const responseBody = deliveryBody(result.data);
    if (!dryRun) headers.set("ETag", deliveryWriteEtag(result.data));
    if (result.replayed) headers.set("Idempotent-Replayed", "true");
    if (dryRun) headers.set("Dry-Run", "true");
    return Response.json(responseBody, { headers });
  });
}
