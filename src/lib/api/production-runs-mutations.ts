import { remainingDeadlineMs } from "./feedstock-write-checks";
import { z } from "zod";
import { checkProductionRunDraws, productionRunBody, representationCheckedStart, representationCheckedUpdate, representationCheckedDelete, withCurrentOnStale } from "./production-run-write-checks";
import { DomainError } from "@/lib/domain-errors";
import { startProductionRun, updateProductionRun } from "@/lib/operations/production-runs";
import { runOperation } from "@/lib/operations/runner";
import { toOperationJsonSchema } from "@/lib/operations/json-schema";
import type { ApiRouteContext } from "./route";
import { parseIfMatch } from "./etag";
import { mutationQuerySchema, parseApiQuery } from "./query";
import { readIdempotencyKey, readJsonBody, readOptionalJsonBody } from "./request-body";
import { rejectUnknownFields } from "./unknown-fields";
import { representProductionRun } from "@/lib/representations/production-runs";
import { productionRunEtag } from "@/lib/api/representation-etags";

const deleteBodySchema = z.strictObject({});
const deleteContract = toOperationJsonSchema(deleteBodySchema);
const createContract = toOperationJsonSchema(startProductionRun.input);
const patchContract = toOperationJsonSchema(updateProductionRun.input.omit({ productionRunId: true, expectedVersion: true }));

export async function createProductionRunResponse(request: Request, { ctx, headers, deadlineAt, requestId }: ApiRouteContext) {
  const { dryRun } = parseApiQuery(request, mutationQuerySchema);
  const key = readIdempotencyKey(request, true);
  const body = await readJsonBody(request);
  rejectUnknownFields(body, createContract);
  checkProductionRunDraws(body);
  const result = await runOperation(representationCheckedStart, ctx, body, {
    deadlineMs: remainingDeadlineMs(deadlineAt),
    audit: { requestId, credentialId: ctx.credentialId, transport: "rest" as const },
    dryRun, idempotency: key ? { credentialId: ctx.credentialId, key } : undefined,
  });
  const responseBody = productionRunBody(result, dryRun);
  const { data } = responseBody;
  if (result.replayed) headers.set("Idempotent-Replayed", "true");
  if (dryRun) headers.set("Dry-Run", "true");
  else headers.set("Location", `/api/v1/production-runs/${data.id}`);
  if (!dryRun) headers.set("ETag", productionRunEtag(data));
  return Response.json(responseBody, { status: dryRun ? 200 : 201, headers });
}

export async function mutateProductionRunResponse(request: Request, context: ApiRouteContext, id: string, method: "PATCH" | "DELETE") {
  const { ctx, headers, deadlineAt, requestId } = context;
  const { dryRun } = parseApiQuery(request, mutationQuerySchema);
  const precondition = request.headers.get("if-match");
  const { version, revision } = parseIfMatch(precondition);
  if (!z.uuid().safeParse(id).success) throw new DomainError("not_found", "Production run was not found.");
  const key = readIdempotencyKey(request, false);
  const options = {
    audit: { requestId, credentialId: ctx.credentialId, transport: "rest" as const },
    dryRun, idempotency: key ? { credentialId: ctx.credentialId, key, target: id, precondition: precondition! } : undefined,
  };
  return withCurrentOnStale(ctx, id, async () => {
    if (method === "PATCH") {
      const body = await readJsonBody(request);
      rejectUnknownFields(body, patchContract);
      checkProductionRunDraws(body);
      // Preserve non-object values for the operation's validation rather than
      // spreading them into a silently successful empty patch.
      const input = body !== null && typeof body === "object" && !Array.isArray(body)
        ? { ...body, productionRunId: id, expectedVersion: version } : body;
      const operation = representationCheckedUpdate(id, revision);
      const result = await runOperation(operation, ctx, input, { ...options, deadlineMs: remainingDeadlineMs(deadlineAt) });
      const data = representProductionRun(result.data);
      if (!dryRun) headers.set("ETag", productionRunEtag(data));
      if (result.replayed) headers.set("Idempotent-Replayed", "true");
      if (dryRun) headers.set("Dry-Run", "true");
      return Response.json({ data, ...(dryRun ? { stockEffects: result.stockEffects } : {}) }, { headers });
    }
    const body = await readOptionalJsonBody(request);
    if (body !== undefined) {
      rejectUnknownFields(body, deleteContract);
      const parsed = deleteBodySchema.safeParse(body);
      if (!parsed.success) throw new DomainError("validation_failed", "DELETE accepts only an empty JSON object.");
    }
    const operation = representationCheckedDelete(id, revision);
    const result = await runOperation(operation, ctx, { productionRunId: id, expectedVersion: version }, { ...options, deadlineMs: remainingDeadlineMs(deadlineAt) });
    if (result.replayed) headers.set("Idempotent-Replayed", "true");
    if (dryRun && result.data) {
      headers.set("Dry-Run", "true");
      return Response.json({ data: representProductionRun(result.data), stockEffects: result.stockEffects }, { headers });
    }
    return new Response(null, { status: 204, headers });
  });
}
