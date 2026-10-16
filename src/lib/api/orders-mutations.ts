import { z } from "zod";
import { DomainError } from "@/lib/domain-errors";
import { toOperationJsonSchema } from "@/lib/operations/json-schema";
import { runOperation } from "@/lib/operations/runner";
import { orderRepresentationSchema } from "@/lib/representations/orders";
import { recordOrderInput, updateOrderApiInput } from "@/schemas/order-input";
import { canonicalUuid } from "./canonical-uuid";
import { parseIfMatch } from "./etag";
import { remainingDeadlineMs } from "./write-checks";
import {
  orderBody, representationCheckedDelete, representationCheckedRecord, representationCheckedUpdate, withCurrentOnStale,
} from "./order-write-checks";
import { mutationQuerySchema, parseApiQuery } from "./query";
import { readIdempotencyKey, readJsonBody, readOptionalJsonBody } from "./request-body";
import { orderEtag } from "./representation-etags";
import type { ApiRouteContext } from "./route";
import { rejectUnknownFields } from "./unknown-fields";

const deleteBodySchema = z.strictObject({});
const deleteContract = toOperationJsonSchema(deleteBodySchema);
const createContract = toOperationJsonSchema(recordOrderInput);
const patchContract = toOperationJsonSchema(updateOrderApiInput);
const NOT_FOUND_MESSAGE = "Order was not found.";

export async function createOrderResponse(request: Request, { ctx, headers, deadlineAt, requestId }: ApiRouteContext) {
  const { dryRun } = parseApiQuery(request, mutationQuerySchema);
  const key = readIdempotencyKey(request, true);
  const body = await readJsonBody(request);
  rejectUnknownFields(body, createContract);
  const result = await runOperation(representationCheckedRecord, ctx, body, {
    deadlineMs: remainingDeadlineMs(deadlineAt), dryRun,
    audit: { requestId, credentialId: ctx.credentialId, transport: "rest" as const },
    idempotency: key ? { credentialId: ctx.credentialId, key } : undefined,
  });
  const responseBody = orderBody(result.data);
  if (result.replayed) headers.set("Idempotent-Replayed", "true");
  if (dryRun) headers.set("Dry-Run", "true");
  else {
    headers.set("Location", `/api/v1/orders/${responseBody.data.id}`);
    headers.set("ETag", orderEtag(responseBody.data));
  }
  return Response.json(responseBody, { status: dryRun ? 200 : 201, headers });
}

export async function mutateOrderResponse(request: Request, context: ApiRouteContext, segment: string, method: "PATCH" | "DELETE") {
  const { ctx, headers, deadlineAt, requestId } = context;
  const { dryRun } = parseApiQuery(request, mutationQuerySchema);
  const precondition = request.headers.get("if-match");
  const { version, revision } = parseIfMatch(precondition);
  const id = canonicalUuid(segment);
  if (!id) throw new DomainError("not_found", NOT_FOUND_MESSAGE);
  const key = readIdempotencyKey(request, false);
  const options = {
    audit: { requestId, credentialId: ctx.credentialId, transport: "rest" as const },
    dryRun,
    idempotency: key ? { credentialId: ctx.credentialId, key, target: id, precondition: precondition! } : undefined,
  };
  return withCurrentOnStale(ctx, id, async () => {
    if (method === "PATCH") {
      const body = await readJsonBody(request);
      rejectUnknownFields(body, patchContract);
      // Preserve non-object values for the operation's validation rather than
      // spreading them into a silently successful empty patch.
      const input = body !== null && typeof body === "object" && !Array.isArray(body)
        ? { ...body, orderId: id, expectedVersion: version } : body;
      const result = await runOperation(representationCheckedUpdate(id, revision), ctx, input, { ...options, deadlineMs: remainingDeadlineMs(deadlineAt) });
      const responseBody = orderBody(result.data);
      if (!dryRun) headers.set("ETag", orderEtag(responseBody.data));
      if (result.replayed) headers.set("Idempotent-Replayed", "true");
      if (dryRun) headers.set("Dry-Run", "true");
      return Response.json(responseBody, { headers });
    }
    const body = await readOptionalJsonBody(request);
    if (body !== undefined) {
      rejectUnknownFields(body, deleteContract);
      if (!deleteBodySchema.safeParse(body).success) throw new DomainError("validation_failed", "DELETE accepts only an empty JSON object.");
    }
    const result = await runOperation(representationCheckedDelete(id, revision), ctx, { orderId: id, expectedVersion: version }, { ...options, deadlineMs: remainingDeadlineMs(deadlineAt) });
    if (result.replayed) headers.set("Idempotent-Replayed", "true");
    if (dryRun && result.data) {
      headers.set("Dry-Run", "true");
      return Response.json({ data: orderRepresentationSchema.parse(result.data) }, { headers });
    }
    return new Response(null, { status: 204, headers });
  });
}
