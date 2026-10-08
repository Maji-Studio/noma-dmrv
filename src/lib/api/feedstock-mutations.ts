import { z } from "zod";
import type { feedstockCreateEnvelopeSchema } from "./representations/envelopes";
import { API_FEEDSTOCK_MAX_ALLOCATIONS, FEEDSTOCK_REPRESENTATION_REVISION } from "@/config/api-rest";
import { readApiFeedstock } from "@/lib/read-models/api-feedstocks";
import { deadlineExceeded, DomainError } from "@/lib/domain-errors";
import { logFeedstockDelivery, updateFeedstock, deleteFeedstock } from "@/lib/operations/feedstocks";
import { runOperation, type Operation, type OperationScope } from "@/lib/operations/runner";
import { toOperationJsonSchema } from "@/lib/operations/json-schema";
import type { ApiRouteContext } from "./route";
import { parseIfMatch } from "./etag";
import { ApiHttpError } from "./http-error";
import { mutationQuerySchema, parseApiQuery } from "./query";
import { readIdempotencyKey, readJsonBody } from "./request-body";
import { rejectUnknownFields } from "./unknown-fields";
import { feedstockEtag, feedstockStockPreview, representFeedstock } from "./representations/feedstocks";

const deleteBodySchema = z.strictObject({});
const deleteContract = toOperationJsonSchema(deleteBodySchema);
const createContract = toOperationJsonSchema(logFeedstockDelivery.input);
const patchContract = toOperationJsonSchema(updateFeedstock.input.omit({ feedstockId: true, expectedVersion: true }));

function remainingDeadlineMs(deadlineAt: number): number {
  const remaining = deadlineAt - Date.now();
  if (remaining <= 0) throw deadlineExceeded("before starting");
  return remaining;
}

export async function createFeedstockResponse(request: Request, { ctx, headers, deadlineAt, requestId }: ApiRouteContext) {
  const { dryRun } = parseApiQuery(request, mutationQuerySchema);
  const key = readIdempotencyKey(request, !dryRun);
  const body = await readJsonBody(request);
  rejectUnknownFields(body, createContract);
  if (body && typeof body === "object" && "allocations" in body &&
    Array.isArray(body.allocations) && body.allocations.length > API_FEEDSTOCK_MAX_ALLOCATIONS) {
    throw new DomainError("validation_failed", "Split this intake into smaller requests.", {
      issues: [{ path: ["allocations"], code: "too_big", message: "Too many bin allocations.", meta: { maximum: API_FEEDSTOCK_MAX_ALLOCATIONS } }],
    });
  }
  const result = await runOperation(logFeedstockDelivery, ctx, body, {
    deadlineMs: remainingDeadlineMs(deadlineAt),
    audit: { requestId, credentialId: ctx.credentialId },
    dryRun, idempotency: key ? { credentialId: ctx.credentialId, key } : undefined,
  });
  const data = result.data.feedstocks.map(representFeedstock);
  if (result.replayed) headers.set("Idempotent-Replayed", "true");
  if (dryRun) headers.set("Dry-Run", "true");
  else headers.set("Location", `/api/v1/feedstocks/${data[0].id}`);
  headers.set("ETag", feedstockEtag(data[0]));
  return Response.json({
    data, ...(result.data.warning ? { warnings: [result.data.warning] } : {}),
    ...(dryRun ? { preview: feedstockStockPreview(data) } : {}),
  } satisfies z.infer<typeof feedstockCreateEnvelopeSchema>, { status: dryRun ? 200 : 201, headers });
}

/** Runs after the idempotency claim/replay, before any domain write. */
async function checkRepresentation(scope: OperationScope, id: string, revision: number) {
  const row = await readApiFeedstock(scope.ctx, { id }, scope.tx);
  if (revision !== FEEDSTOCK_REPRESENTATION_REVISION) throw new DomainError("stale_version", "The representation has changed.");
  return row;
}

export async function mutateFeedstockResponse(request: Request, context: ApiRouteContext, id: string, method: "PATCH" | "DELETE") {
  const { ctx, headers, deadlineAt, requestId } = context;
  const { dryRun } = parseApiQuery(request, mutationQuerySchema);
  const precondition = request.headers.get("if-match");
  const { version, revision } = parseIfMatch(precondition);
  if (!z.uuid().safeParse(id).success) throw new DomainError("not_found", "Feedstock was not found.");
  const key = readIdempotencyKey(request, false);
  const options = {
    audit: { requestId, credentialId: ctx.credentialId },
    dryRun, idempotency: key ? { credentialId: ctx.credentialId, key, target: id, precondition: precondition! } : undefined,
  };
  try {
    if (method === "PATCH") {
      const body = await readJsonBody(request);
      rejectUnknownFields(body, patchContract);
      // Preserve non-object values for the operation's validation rather than
      // spreading them into a silently successful empty patch.
      const input = body !== null && typeof body === "object" && !Array.isArray(body)
        ? { ...body, feedstockId: id, expectedVersion: version } : body;
      const operation: typeof updateFeedstock = {
        ...updateFeedstock,
        execute: async (scope, input) => {
          await checkRepresentation(scope, id, revision);
          return updateFeedstock.execute(scope, input);
        },
      };
      const result = await runOperation(operation, ctx, input, { ...options, deadlineMs: remainingDeadlineMs(deadlineAt) });
      const data = representFeedstock(result.data);
      headers.set("ETag", feedstockEtag(data));
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
    // DELETE has no surviving representation. A dry run returns the version
    // that would be deleted; the operation still checks it while locked.
    const operation: Operation<typeof deleteFeedstock.input, Awaited<ReturnType<typeof readApiFeedstock>> | null> = {
      ...deleteFeedstock,
      describe: (input) => deleteFeedstock.describe!(input, undefined),
      execute: async (scope, input) => {
        const row = await checkRepresentation(scope, id, revision);
        await deleteFeedstock.execute(scope, input);
        return dryRun ? row : null;
      },
    };
    const result = await runOperation(operation, ctx, { feedstockId: id, expectedVersion: version }, { ...options, deadlineMs: remainingDeadlineMs(deadlineAt) });
    if (result.replayed) headers.set("Idempotent-Replayed", "true");
    if (dryRun && result.data) {
      headers.set("Dry-Run", "true");
      return Response.json({ data: representFeedstock(result.data) }, { headers });
    }
    return new Response(null, { status: 204, headers });
  } catch (error) {
    if (error instanceof DomainError && error.code === "stale_version") {
      const current = await readApiFeedstock(ctx, { id });
      throw new ApiHttpError(412, "stale_version", "The feedstock has changed. Read the current representation before retrying.", current);
    }
    throw error;
  }
}
