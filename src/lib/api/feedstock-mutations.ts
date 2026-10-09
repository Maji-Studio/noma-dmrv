import { z } from "zod";
import { checkFeedstockAllocations, feedstockCreateBody, remainingDeadlineMs, representationCheckedUpdate, representationCheckedDelete, withCurrentOnStale } from "./feedstock-write-checks";
import { DomainError } from "@/lib/domain-errors";
import { logFeedstockDelivery, updateFeedstock } from "@/lib/operations/feedstocks";
import { runOperation } from "@/lib/operations/runner";
import { toOperationJsonSchema } from "@/lib/operations/json-schema";
import type { ApiRouteContext } from "./route";
import { parseIfMatch } from "./etag";
import { mutationQuerySchema, parseApiQuery } from "./query";
import { readIdempotencyKey, readJsonBody } from "./request-body";
import { rejectUnknownFields } from "./unknown-fields";
import { representFeedstock } from "@/lib/representations/feedstocks";
import { feedstockEtag } from "@/lib/api/representation-etags";

const deleteBodySchema = z.strictObject({});
const deleteContract = toOperationJsonSchema(deleteBodySchema);
const createContract = toOperationJsonSchema(logFeedstockDelivery.input);
const patchContract = toOperationJsonSchema(updateFeedstock.input.omit({ feedstockId: true, expectedVersion: true }));

export async function createFeedstockResponse(request: Request, { ctx, headers, deadlineAt, requestId }: ApiRouteContext) {
  const { dryRun } = parseApiQuery(request, mutationQuerySchema);
  const key = readIdempotencyKey(request, !dryRun);
  const body = await readJsonBody(request);
  rejectUnknownFields(body, createContract);
  checkFeedstockAllocations(body);
  const result = await runOperation(logFeedstockDelivery, ctx, body, {
    deadlineMs: remainingDeadlineMs(deadlineAt),
    audit: { requestId, credentialId: ctx.credentialId, transport: "rest" as const },
    dryRun, idempotency: key ? { credentialId: ctx.credentialId, key } : undefined,
  });
  const responseBody = feedstockCreateBody(result, dryRun);
  const { data } = responseBody;
  if (result.replayed) headers.set("Idempotent-Replayed", "true");
  if (dryRun) headers.set("Dry-Run", "true");
  else headers.set("Location", `/api/v1/feedstocks/${data[0].id}`);
  if (!dryRun) headers.set("ETag", feedstockEtag(data[0]));
  return Response.json(responseBody, { status: dryRun ? 200 : 201, headers });
}

export async function mutateFeedstockResponse(request: Request, context: ApiRouteContext, id: string, method: "PATCH" | "DELETE") {
  const { ctx, headers, deadlineAt, requestId } = context;
  const { dryRun } = parseApiQuery(request, mutationQuerySchema);
  const precondition = request.headers.get("if-match");
  const { version, revision } = parseIfMatch(precondition);
  if (!z.uuid().safeParse(id).success) throw new DomainError("not_found", "Feedstock was not found.");
  const key = readIdempotencyKey(request, false);
  const options = {
    audit: { requestId, credentialId: ctx.credentialId, transport: "rest" as const },
    dryRun, idempotency: key ? { credentialId: ctx.credentialId, key, target: id, precondition: precondition! } : undefined,
  };
  return withCurrentOnStale(ctx, id, async () => {
    if (method === "PATCH") {
      const body = await readJsonBody(request);
      rejectUnknownFields(body, patchContract);
      // Preserve non-object values for the operation's validation rather than
      // spreading them into a silently successful empty patch.
      const input = body !== null && typeof body === "object" && !Array.isArray(body)
        ? { ...body, feedstockId: id, expectedVersion: version } : body;
      const operation = representationCheckedUpdate(id, revision);
      const result = await runOperation(operation, ctx, input, { ...options, deadlineMs: remainingDeadlineMs(deadlineAt) });
      const data = representFeedstock(result.data);
      if (!dryRun) headers.set("ETag", feedstockEtag(data));
      if (result.replayed) headers.set("Idempotent-Replayed", "true");
      if (dryRun) headers.set("Dry-Run", "true");
      return Response.json({ data }, { headers });
    }
    if (request.body !== null) {
      const body = await readJsonBody(request);
      rejectUnknownFields(body, deleteContract);
      const parsed = deleteBodySchema.safeParse(body);
      if (!parsed.success) throw new DomainError("validation_failed", "DELETE accepts only an empty JSON object.");
    }
    const operation = representationCheckedDelete(id, revision);
    const result = await runOperation(operation, ctx, { feedstockId: id, expectedVersion: version }, { ...options, deadlineMs: remainingDeadlineMs(deadlineAt) });
    if (result.replayed) headers.set("Idempotent-Replayed", "true");
    if (dryRun && result.data) {
      headers.set("Dry-Run", "true");
      return Response.json({ data: representFeedstock(result.data) }, { headers });
    }
    return new Response(null, { status: 204, headers });
  });
}
