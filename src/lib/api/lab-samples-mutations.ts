import { z } from "zod";
import { DomainError } from "@/lib/domain-errors";
import { toOperationJsonSchema } from "@/lib/operations/json-schema";
import { runOperation } from "@/lib/operations/runner";
import { labSampleRepresentationSchema } from "@/lib/representations/lab-samples";
import { recordLabSampleInput, updateLabSampleApiInput } from "@/schemas/lab-sample-input";
import { canonicalUuid } from "./canonical-uuid";
import { parseIfMatch } from "./etag";
import { remainingDeadlineMs } from "./feedstock-write-checks";
import {
  labSampleBody, representationCheckedDelete, representationCheckedRecord, representationCheckedUpdate, withCurrentOnStale,
} from "./lab-sample-write-checks";
import { mutationQuerySchema, parseApiQuery } from "./query";
import { readIdempotencyKey, readJsonBody, readOptionalJsonBody } from "./request-body";
import { labSampleEtag } from "./representation-etags";
import type { ApiRouteContext } from "./route";
import { rejectUnknownFields } from "./unknown-fields";

const deleteBodySchema = z.strictObject({});
const deleteContract = toOperationJsonSchema(deleteBodySchema);
const createContract = toOperationJsonSchema(recordLabSampleInput);
const patchContract = toOperationJsonSchema(updateLabSampleApiInput);
const NOT_FOUND_MESSAGE = "Lab sample was not found.";

export async function createLabSampleResponse(request: Request, { ctx, headers, deadlineAt, requestId }: ApiRouteContext) {
  const { dryRun } = parseApiQuery(request, mutationQuerySchema);
  const key = readIdempotencyKey(request, true);
  const body = await readJsonBody(request);
  rejectUnknownFields(body, createContract);
  const result = await runOperation(representationCheckedRecord, ctx, body, {
    deadlineMs: remainingDeadlineMs(deadlineAt), dryRun,
    audit: { requestId, credentialId: ctx.credentialId, transport: "rest" as const },
    idempotency: key ? { credentialId: ctx.credentialId, key } : undefined,
  });
  const responseBody = labSampleBody(result.data);
  if (result.replayed) headers.set("Idempotent-Replayed", "true");
  if (dryRun) headers.set("Dry-Run", "true");
  else {
    headers.set("Location", `/api/v1/lab-samples/${responseBody.data.id}`);
    headers.set("ETag", labSampleEtag(responseBody.data));
  }
  return Response.json(responseBody, { status: dryRun ? 200 : 201, headers });
}

export async function mutateLabSampleResponse(request: Request, context: ApiRouteContext, segment: string, method: "PATCH" | "DELETE") {
  const { ctx, headers, deadlineAt, requestId } = context;
  const { dryRun } = parseApiQuery(request, mutationQuerySchema);
  const precondition = request.headers.get("if-match");
  const { version, revision } = parseIfMatch(precondition);
  const id = canonicalUuid(segment);
  if (!id) throw new DomainError("not_found", NOT_FOUND_MESSAGE);
  const key = readIdempotencyKey(request, false);
  const options = {
    audit: { requestId, credentialId: ctx.credentialId, transport: "rest" as const },
    dryRun, deadlineMs: remainingDeadlineMs(deadlineAt),
    idempotency: key ? { credentialId: ctx.credentialId, key, target: id, precondition: precondition! } : undefined,
  };
  return withCurrentOnStale(ctx, id, async () => {
    if (method === "PATCH") {
      const body = await readJsonBody(request);
      rejectUnknownFields(body, patchContract);
      // Preserve non-object values for the operation's validation rather than
      // spreading them into a silently successful empty patch.
      const input = body !== null && typeof body === "object" && !Array.isArray(body)
        ? { ...body, labSampleId: id, expectedVersion: version } : body;
      const result = await runOperation(representationCheckedUpdate(id, revision), ctx, input, options);
      const responseBody = labSampleBody(result.data);
      if (!dryRun) headers.set("ETag", labSampleEtag(responseBody.data));
      if (result.replayed) headers.set("Idempotent-Replayed", "true");
      if (dryRun) headers.set("Dry-Run", "true");
      return Response.json(responseBody, { headers });
    }
    const body = await readOptionalJsonBody(request);
    if (body !== undefined) {
      rejectUnknownFields(body, deleteContract);
      if (!deleteBodySchema.safeParse(body).success) throw new DomainError("validation_failed", "DELETE accepts only an empty JSON object.");
    }
    const result = await runOperation(representationCheckedDelete(id, revision), ctx, { labSampleId: id, expectedVersion: version }, options);
    if (result.replayed) headers.set("Idempotent-Replayed", "true");
    if (dryRun && result.data) {
      headers.set("Dry-Run", "true");
      return Response.json({ data: labSampleRepresentationSchema.parse(result.data) }, { headers });
    }
    return new Response(null, { status: 204, headers });
  });
}
