import { z } from "zod";
import { DomainError } from "@/lib/domain-errors";
import { toOperationJsonSchema } from "@/lib/operations/json-schema";
import { runOperation } from "@/lib/operations/runner";
import { runWithStockBasisPreview } from "@/lib/operations/stock-basis-preview";
import { makeBiocharProductApiInput, updateBiocharProductApiInput } from "@/schemas/biochar-product-input";
import { biocharProductEtag } from "./representation-etags";
import { madeProductBody, productBodyData, representationCheckedMake, representationCheckedUpdate, withCurrentOnStale } from "./biochar-product-write-checks";
import { remainingDeadlineMs } from "./feedstock-write-checks";
import { parseIfMatch } from "./etag";
import { mutationQuerySchema, parseApiQuery } from "./query";
import { readIdempotencyKey, readJsonBody } from "./request-body";
import type { ApiRouteContext } from "./route";
import { rejectUnknownFields } from "./unknown-fields";

const createContract = toOperationJsonSchema(makeBiocharProductApiInput);
const patchContract = toOperationJsonSchema(updateBiocharProductApiInput);

export async function createBiocharProductResponse(request: Request, { ctx, headers, deadlineAt, requestId }: ApiRouteContext) {
  const { dryRun } = parseApiQuery(request, mutationQuerySchema);
  const key = readIdempotencyKey(request, true);
  const body = await readJsonBody(request);
  rejectUnknownFields(body, createContract);
  const result = await runWithStockBasisPreview(representationCheckedMake, ctx, body, {
    deadlineAt, dryRun,
    audit: { requestId, credentialId: ctx.credentialId, transport: "rest" as const },
    idempotency: key ? { credentialId: ctx.credentialId, key } : undefined,
  }, (data) => data.basisFingerprint);
  const responseBody = madeProductBody(result, dryRun);
  if (result.replayed) headers.set("Idempotent-Replayed", "true");
  if (dryRun) headers.set("Dry-Run", "true");
  else {
    headers.set("Location", `/api/v1/biochar-products/${responseBody.data.id}`);
    headers.set("ETag", biocharProductEtag(responseBody.data));
  }
  return Response.json(responseBody, { status: dryRun ? 200 : 201, headers });
}

export async function updateBiocharProductResponse(request: Request, { ctx, headers, deadlineAt, requestId }: ApiRouteContext, id: string) {
  const { dryRun } = parseApiQuery(request, mutationQuerySchema);
  const precondition = request.headers.get("if-match");
  const { version, revision } = parseIfMatch(precondition);
  if (!z.uuid().safeParse(id).success) throw new DomainError("not_found", "Biochar product was not found.");
  const key = readIdempotencyKey(request, false);
  return withCurrentOnStale(ctx, id, async () => {
    const body = await readJsonBody(request);
    rejectUnknownFields(body, patchContract);
    // Preserve non-object values for the operation's validation rather than
    // spreading them into a silently successful empty patch.
    const input = body !== null && typeof body === "object" && !Array.isArray(body)
      ? { ...body, biocharProductId: id, expectedVersion: version } : body;
    const result = await runOperation(representationCheckedUpdate(id, revision), ctx, input, {
      deadlineMs: remainingDeadlineMs(deadlineAt), dryRun,
      audit: { requestId, credentialId: ctx.credentialId, transport: "rest" as const },
      idempotency: key ? { credentialId: ctx.credentialId, key, target: id, precondition: precondition! } : undefined,
    });
    const data = productBodyData(result.data);
    if (!dryRun) headers.set("ETag", biocharProductEtag(data));
    if (result.replayed) headers.set("Idempotent-Replayed", "true");
    if (dryRun) headers.set("Dry-Run", "true");
    return Response.json({ data }, { headers });
  });
}
