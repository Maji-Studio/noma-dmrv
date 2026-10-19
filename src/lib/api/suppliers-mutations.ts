import { z } from "zod";
import { DomainError } from "@/lib/domain-errors";
import { createSupplierApi } from "@/lib/operations/supplier-api";
import { toOperationJsonSchema } from "@/lib/operations/json-schema";
import { runOperation } from "@/lib/operations/runner";
import { supplierLocationRepresentationSchema } from "@/lib/representations/supplier-locations";
import { supplierRepresentationSchema } from "@/lib/representations/suppliers";
import { createSupplierApiInput, updateSupplierApiInput } from "@/schemas/supplier-input";
import { partyNotFound } from "@/lib/party-domain-errors";
import { canonicalUuid } from "./canonical-uuid";
import { parseIfMatch } from "./etag";
import { withCurrentOnStale } from "./supplier-write-checks";
import { representationCheckedDelete, representationCheckedTransition, representationCheckedUpdate } from "./supplier-write-operations";
import { remainingDeadlineMs } from "./write-checks";
import { mutationQuerySchema, parseApiQuery } from "./query";
import { readIdempotencyKey, readJsonBody, readOptionalJsonBody } from "./request-body";
import { supplierEtag } from "./representation-etags";
import type { ApiRouteContext } from "./route";
import { rejectUnknownFields } from "./unknown-fields";

const createContract = toOperationJsonSchema(createSupplierApiInput);
const patchContract = toOperationJsonSchema(updateSupplierApiInput);
const emptyBodySchema = z.strictObject({});
const emptyContract = toOperationJsonSchema(emptyBodySchema);

/** Parsing restores property order after a JSONB idempotency replay. */
function supplierBody(output: { supplier: unknown }) {
  return { data: supplierRepresentationSchema.parse(output.supplier) };
}

function createSupplierBody(output: Awaited<ReturnType<typeof createSupplierApi.execute>>) {
  return { ...supplierBody(output), locations: z.array(supplierLocationRepresentationSchema).parse(output.locations) };
}

export async function createSupplierResponse(request: Request, { ctx, headers, deadlineAt, requestId }: ApiRouteContext) {
  const { dryRun } = parseApiQuery(request, mutationQuerySchema);
  const key = readIdempotencyKey(request, true);
  const body = await readJsonBody(request);
  rejectUnknownFields(body, createContract);
  const result = await runOperation(createSupplierApi, ctx, body, {
    deadlineMs: remainingDeadlineMs(deadlineAt), dryRun,
    audit: { requestId, credentialId: ctx.credentialId, transport: "rest" },
    idempotency: key ? { credentialId: ctx.credentialId, key } : undefined,
  });
  const responseBody = createSupplierBody(result.data);
  if (result.replayed) headers.set("Idempotent-Replayed", "true");
  if (dryRun) headers.set("Dry-Run", "true");
  else {
    headers.set("Location", `/api/v1/suppliers/${responseBody.data.id}`);
    headers.set("ETag", supplierEtag(responseBody.data));
  }
  return Response.json(responseBody, { status: dryRun ? 200 : 201, headers });
}

export async function updateSupplierResponse(request: Request, { ctx, headers, deadlineAt, requestId }: ApiRouteContext, segment: string) {
  const { dryRun } = parseApiQuery(request, mutationQuerySchema);
  const precondition = request.headers.get("if-match");
  const { version, revision } = parseIfMatch(precondition);
  const id = canonicalUuid(segment);
  if (!id) throw partyNotFound("supplier");
  const key = readIdempotencyKey(request, false);
  return withCurrentOnStale(ctx, id, async () => {
    const body = await readJsonBody(request);
    rejectUnknownFields(body, patchContract);
    const input = body !== null && typeof body === "object" && !Array.isArray(body)
      ? { ...body, supplierId: id, expectedVersion: version } : body;
    const result = await runOperation(representationCheckedUpdate(id, revision), ctx, input, {
      deadlineMs: remainingDeadlineMs(deadlineAt), dryRun,
      audit: { requestId, credentialId: ctx.credentialId, transport: "rest" },
      idempotency: key ? { credentialId: ctx.credentialId, key, target: id, precondition: precondition! } : undefined,
    });
    const responseBody = supplierBody(result.data);
    if (!dryRun) headers.set("ETag", supplierEtag(responseBody.data));
    if (result.replayed) headers.set("Idempotent-Replayed", "true");
    if (dryRun) headers.set("Dry-Run", "true");
    return Response.json(responseBody, { headers });
  });
}

/** DELETE and the two POST commands share the empty-body and precondition contracts. */
export async function commandSupplierResponse(request: Request, { ctx, headers, deadlineAt, requestId }: ApiRouteContext, segment: string, command: "delete" | "archive" | "restore") {
  const { dryRun } = parseApiQuery(request, mutationQuerySchema);
  const precondition = request.headers.get("if-match");
  const { version, revision } = parseIfMatch(precondition);
  const id = canonicalUuid(segment);
  if (!id) throw partyNotFound("supplier");
  const key = readIdempotencyKey(request, false);
  const body = await readOptionalJsonBody(request);
  if (body !== undefined) {
    rejectUnknownFields(body, emptyContract);
    if (!emptyBodySchema.safeParse(body).success) throw new DomainError("validation_failed", "This command accepts only an empty JSON object.");
  }
  return withCurrentOnStale(ctx, id, async () => {
    const options = {
      deadlineMs: remainingDeadlineMs(deadlineAt), dryRun,
      audit: { requestId, credentialId: ctx.credentialId, transport: "rest" as const },
      idempotency: key ? { credentialId: ctx.credentialId, key, target: id, precondition: precondition! } : undefined,
    };
    const input = { supplierId: id, expectedVersion: version };
    if (command === "delete") {
      const result = await runOperation(representationCheckedDelete(id, revision), ctx, input, options);
      if (result.replayed) headers.set("Idempotent-Replayed", "true");
      if (dryRun) {
        headers.set("Dry-Run", "true");
        return Response.json({ data: supplierRepresentationSchema.parse(result.data) }, { headers });
      }
      return new Response(null, { status: 204, headers });
    }
    const result = await runOperation(representationCheckedTransition(id, revision, command), ctx, input, options);
    const responseBody = supplierBody(result.data);
    if (result.replayed) headers.set("Idempotent-Replayed", "true");
    if (dryRun) headers.set("Dry-Run", "true");
    else headers.set("ETag", supplierEtag(responseBody.data));
    return Response.json(responseBody, { headers });
  });
}
