import { apiAudit } from "@/lib/api/audit";
import { z } from "zod";
import { DomainError } from "@/lib/domain-errors";
import { createCustomerApi } from "@/lib/operations/customer-api";
import { toOperationJsonSchema } from "@/lib/operations/json-schema";
import { runWithCascadePreview } from "@/lib/operations/cascade-preview";
import { runOperation } from "@/lib/operations/runner";
import { customerLocationRepresentationSchema } from "@/lib/representations/customer-locations";
import { customerRepresentationSchema } from "@/lib/representations/customers";
import { createCustomerApiInput, updateCustomerApiInput } from "@/schemas/customer-input";
import { partyNotFound } from "@/lib/party-domain-errors";
import { canonicalUuid } from "./canonical-uuid";
import { parseIfMatch } from "./etag";
import { withCurrentOnStale } from "./customer-write-checks";
import { representationCheckedCascadeDelete, representationCheckedTransition, representationCheckedUpdate } from "./customer-write-operations";
import { remainingDeadlineMs } from "./write-checks";
import { customerDeleteQuerySchema, mutationQuerySchema, parseApiQuery } from "./query";
import { readIdempotencyKey, readJsonBody, readOptionalJsonBody } from "./request-body";
import { customerEtag } from "./representation-etags";
import type { ApiRouteContext } from "./route";
import { rejectUnknownFields } from "./unknown-fields";

const createContract = toOperationJsonSchema(createCustomerApiInput);
const patchContract = toOperationJsonSchema(updateCustomerApiInput);
const emptyBodySchema = z.strictObject({});
const emptyContract = toOperationJsonSchema(emptyBodySchema);

/** Parsing restores property order after a JSONB idempotency replay. */
function customerBody(output: { customer: unknown }) {
  return { data: customerRepresentationSchema.parse(output.customer) };
}

function createCustomerBody(output: Awaited<ReturnType<typeof createCustomerApi.execute>>) {
  return { ...customerBody(output), locations: z.array(customerLocationRepresentationSchema).parse(output.locations) };
}

export async function createCustomerResponse(request: Request, { ctx, headers, deadlineAt, requestId }: ApiRouteContext) {
  const { dryRun } = parseApiQuery(request, mutationQuerySchema);
  const key = readIdempotencyKey(request, true);
  const body = await readJsonBody(request);
  rejectUnknownFields(body, createContract);
  const result = await runOperation(createCustomerApi, ctx, body, {
    deadlineMs: remainingDeadlineMs(deadlineAt), dryRun,
    audit: apiAudit(ctx, requestId, "rest"),
    idempotency: key ? { credentialId: ctx.credentialId, key } : undefined,
  });
  const responseBody = createCustomerBody(result.data);
  if (result.replayed) headers.set("Idempotent-Replayed", "true");
  if (dryRun) headers.set("Dry-Run", "true");
  else {
    headers.set("Location", `/api/v1/customers/${responseBody.data.id}`);
    headers.set("ETag", customerEtag(responseBody.data));
  }
  return Response.json(responseBody, { status: dryRun ? 200 : 201, headers });
}

export async function updateCustomerResponse(request: Request, { ctx, headers, deadlineAt, requestId }: ApiRouteContext, segment: string) {
  const { dryRun } = parseApiQuery(request, mutationQuerySchema);
  const precondition = request.headers.get("if-match");
  const { version, revision } = parseIfMatch(precondition);
  const id = canonicalUuid(segment);
  if (!id) throw partyNotFound("customer");
  const key = readIdempotencyKey(request, false);
  return withCurrentOnStale(ctx, id, async () => {
    const body = await readJsonBody(request);
    rejectUnknownFields(body, patchContract);
    const input = body !== null && typeof body === "object" && !Array.isArray(body)
      ? { ...body, customerId: id, expectedVersion: version } : body;
    const result = await runOperation(representationCheckedUpdate(id, revision), ctx, input, {
      deadlineMs: remainingDeadlineMs(deadlineAt), dryRun,
      audit: apiAudit(ctx, requestId, "rest"),
      idempotency: key ? { credentialId: ctx.credentialId, key, target: id, precondition: precondition! } : undefined,
    });
    const responseBody = customerBody(result.data);
    if (!dryRun) headers.set("ETag", customerEtag(responseBody.data));
    if (result.replayed) headers.set("Idempotent-Replayed", "true");
    if (dryRun) headers.set("Dry-Run", "true");
    return Response.json(responseBody, { headers });
  });
}

/** DELETE and the two POST commands share the empty-body and precondition contracts. */
export async function commandCustomerResponse(request: Request, { ctx, headers, deadlineAt, requestId }: ApiRouteContext, segment: string, command: "delete" | "archive" | "restore") {
  const query = parseApiQuery(request, command === "delete" ? customerDeleteQuerySchema : mutationQuerySchema);
  const { dryRun } = query;
  const precondition = request.headers.get("if-match");
  const { version, revision } = parseIfMatch(precondition);
  const id = canonicalUuid(segment);
  if (!id) throw partyNotFound("customer");
  const key = readIdempotencyKey(request, false);
  const body = await readOptionalJsonBody(request);
  if (body !== undefined) {
    rejectUnknownFields(body, emptyContract);
    if (!emptyBodySchema.safeParse(body).success) throw new DomainError("validation_failed", "This command accepts only an empty JSON object.");
  }
  return withCurrentOnStale(ctx, id, async () => {
    const options = {
      deadlineMs: remainingDeadlineMs(deadlineAt), dryRun,
      audit: apiAudit(ctx, requestId, "rest"),
      idempotency: key ? { credentialId: ctx.credentialId, key, target: id, precondition: precondition! } : undefined,
    };
    const input = { customerId: id, expectedVersion: version };
    if (command === "delete") {
      const result = await runWithCascadePreview(representationCheckedCascadeDelete(id, revision), ctx, { ...input, ...("cascadeFingerprint" in query ? { cascadeFingerprint: query.cascadeFingerprint } : {}) }, options);
      if (result.replayed) headers.set("Idempotent-Replayed", "true");
      if (dryRun) {
        headers.set("Dry-Run", "true");
        return Response.json({ ...customerBody(result.data), cascade: result.data.cascade, ...(result.data.warnings.length ? { warnings: result.data.warnings } : {}) }, { headers });
      }
      return new Response(null, { status: 204, headers });
    }
    const result = await runOperation(representationCheckedTransition(id, revision, command), ctx, input, options);
    const responseBody = customerBody(result.data);
    if (result.replayed) headers.set("Idempotent-Replayed", "true");
    if (dryRun) headers.set("Dry-Run", "true");
    else headers.set("ETag", customerEtag(responseBody.data));
    return Response.json(responseBody, { headers });
  });
}
