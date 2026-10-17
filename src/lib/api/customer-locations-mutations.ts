import { DomainError } from "@/lib/domain-errors";
import { parseIfMatch } from "./etag";
import { partyLocationNotFound, partyNotFound } from "@/lib/party-domain-errors";
import { readApiCustomerLocation } from "@/lib/read-models/api-customer-locations";
import { representationCheckedUpdate, representationCheckedDelete, representationCheckedTransition } from "./customer-location-write-operations";
import { z } from "zod";
import { addCustomerLocationApi } from "@/lib/operations/party-location-api";
import { runOperation } from "@/lib/operations/runner";
import { toOperationJsonSchema } from "@/lib/operations/json-schema";
import { customerLocationRepresentationSchema } from "@/lib/representations/customer-locations";
import { customerLocationApiInput } from "@/schemas/party-location-input";
import { canonicalUuid } from "./canonical-uuid";
import { remainingDeadlineMs, withCurrentOnStale } from "./write-checks";
import { mutationQuerySchema, parseApiQuery } from "./query";
import { readIdempotencyKey, readJsonBody, readOptionalJsonBody } from "./request-body";
import { customerLocationEtag } from "./representation-etags";
import type { ApiRouteContext } from "./route";
import { rejectUnknownFields } from "./unknown-fields";

const createContract = toOperationJsonSchema(customerLocationApiInput);

const patchContract = toOperationJsonSchema(z.object(customerLocationApiInput.shape).partial());
const emptyBodySchema = z.strictObject({});
const emptyContract = toOperationJsonSchema(emptyBodySchema);


/** Restore property order after JSONB replay and retain operation warnings. */
function locationBody(output: { data: unknown; warnings: string[] }) {
  return { data: customerLocationRepresentationSchema.parse(output.data),
    ...(output.warnings.length ? { warnings: z.array(z.string()).parse(output.warnings) } : {}) };
}

export async function addCustomerLocationResponse(request: Request, { ctx, headers, deadlineAt, requestId }: ApiRouteContext, segment: string) {
  const { dryRun } = parseApiQuery(request, mutationQuerySchema);
  const key = readIdempotencyKey(request, true);
  const id = canonicalUuid(segment);
  if (!id) throw partyNotFound("customer");
  const body = await readJsonBody(request);
  rejectUnknownFields(body, createContract);
  const input = body !== null && typeof body === "object" && !Array.isArray(body) ? { ...body, customerId: id } : body;
  const result = await runOperation(addCustomerLocationApi, ctx, input, {
    deadlineMs: remainingDeadlineMs(deadlineAt), dryRun,
    audit: { requestId, credentialId: ctx.credentialId, transport: "rest" },
    idempotency: key ? { credentialId: ctx.credentialId, key } : undefined,
  });
  const responseBody = locationBody(result.data);
  if (result.replayed) headers.set("Idempotent-Replayed", "true");
  if (dryRun) headers.set("Dry-Run", "true");
  else {
    headers.set("Location", `/api/v1/customers/${id}/locations/${responseBody.data.id}`);
    headers.set("ETag", customerLocationEtag(responseBody.data));
  }
  return Response.json(responseBody, { status: dryRun ? 200 : 201, headers });
}


/** Child wrappers run after replay and enforce existence and archive precedence. */
export async function mutateCustomerLocationResponse(request: Request, { ctx, headers, deadlineAt, requestId }: ApiRouteContext, segment: string, childSegment: string, command: "patch" | "delete" | "archive" | "restore") {
  const { dryRun } = parseApiQuery(request, mutationQuerySchema);
  const precondition = request.headers.get("if-match");
  const { version, revision } = parseIfMatch(precondition);
  const id = canonicalUuid(segment);
  const locationId = canonicalUuid(childSegment);
  if (!id || !locationId) throw partyLocationNotFound("customer");
  const key = readIdempotencyKey(request, false);
  const body = command === "patch" ? await readJsonBody(request) : await readOptionalJsonBody(request);
  if (command === "patch") rejectUnknownFields(body, patchContract);
  else if (body !== undefined) {
    rejectUnknownFields(body, emptyContract);
    if (!emptyBodySchema.safeParse(body).success) throw new DomainError("validation_failed", "This command accepts only an empty JSON object.");
  }
  return withCurrentOnStale(async () => {
    const target = { customerId: id, locationId, expectedVersion: version };
    const input = command === "patch"
      ? body !== null && typeof body === "object" && !Array.isArray(body) ? { ...body, ...target } : body
      : target;
    const operation = command === "patch" ? representationCheckedUpdate(id, locationId, revision)
      : command === "delete" ? representationCheckedDelete(id, locationId, revision)
        : representationCheckedTransition(id, locationId, revision, command);
    const result = await runOperation(operation, ctx, input, {
      deadlineMs: remainingDeadlineMs(deadlineAt), dryRun,
      audit: { requestId, credentialId: ctx.credentialId, transport: "rest" },
      idempotency: key ? { credentialId: ctx.credentialId, key, target: locationId, precondition: precondition! } : undefined,
    });
    if (result.replayed) headers.set("Idempotent-Replayed", "true");
    if (dryRun) headers.set("Dry-Run", "true");
    if (command === "delete" && !dryRun) return new Response(null, { status: 204, headers });
    const responseBody = locationBody(result.data);
    if (!dryRun) headers.set("ETag", customerLocationEtag(responseBody.data));
    return Response.json(responseBody, { headers });
  }, { noun: "customer location", readCurrent: async () => {
    const current = await readApiCustomerLocation(ctx, id, locationId);
    if (!current) throw partyLocationNotFound("customer");
    return current;
  } });
}
