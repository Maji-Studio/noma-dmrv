import { apiAudit } from "@/lib/api/audit";
import { requestDocumentUploadWithCapability } from "@/lib/documents/upload-request";
import { z } from "zod";
import { DOCUMENT_CONFIRM_DEADLINE_MS } from "@/config/documents";
import { DomainError } from "@/lib/domain-errors";
import { API_DOCUMENT_OWNERS, canAccessOwnerDocuments, type ApiDocumentOwnerType } from "@/lib/documents/api-owners";
import { confirmDocumentUpload } from "@/lib/documents/confirm-upload";
import { mapConfirmOutcome } from "@/lib/documents/confirm-outcome";
import { toOperationJsonSchema } from "@/lib/operations/json-schema";
import { documentNotFound, resolveApiDocumentOwner } from "@/lib/read-models/api-documents";
import { requestDocumentUploadBodyInput } from "@/schemas/document-input";
import { canonicalUuid } from "./canonical-uuid";
import { lookupIdentifier } from "./lookup-query";
import { apiDenialResponse } from "./problem";
import { mutationQuerySchema, parseApiQuery } from "./query";
import { readIdempotencyKey, readJsonBody, readOptionalJsonBody } from "./request-body";
import { documentEtag } from "./representation-etags";
import { apiRoute } from "./route";
import { rejectUnknownFields } from "./unknown-fields";

type Params = { idOrCode: string; documentId?: string };
type WriteKind = "request" | "confirm";
const bodyContract = toOperationJsonSchema(requestDocumentUploadBodyInput);
const emptyBody = z.strictObject({});
const emptyContract = toOperationJsonSchema(emptyBody);
const NO_DRY_RUN = "This operation does not offer a dry run.";

/** The owner scope is admitted before any path lookup, body read or storage I/O. */
export function documentWriteHandler(ownerType: ApiDocumentOwnerType, kind: WriteKind) {
  const owner = API_DOCUMENT_OWNERS[ownerType];
  return apiRoute<Params>(`api.v1.${owner.path}.documents.${kind}`, owner.writeScope, async (request, context, params) => {
    const { ctx, headers, deadlineAt, requestId, instance } = context;
    if (!canAccessOwnerDocuments(ctx, ownerType, "write")) return apiDenialResponse("missing_scope", instance, requestId, { role: ctx.orgRole, oauth: ctx.principal.kind === "oauth", scopes: ctx.scopes, requiredScopes: [owner.writeScope] });
    const { dryRun } = parseApiQuery(request, mutationQuerySchema);
    if (dryRun) throw new DomainError("validation_failed", NO_DRY_RUN);
    const audit = apiAudit(ctx, requestId, "rest");
    if (kind === "request") {
      const key = readIdempotencyKey(request, true)!;
      const body = await readJsonBody(request);
      rejectUnknownFields(body, bodyContract);
      const { result, body: envelope } = await requestDocumentUploadWithCapability(ctx, ownerType, params.idOrCode, body, {
        deadlineAt, audit, idempotency: { credentialId: ctx.credentialId, key },
      });
      if (result.replayed) headers.set("Idempotent-Replayed", "true");
      headers.set("Location", `/api/v1/${owner.path}/${result.data.ownerId}/documents/${result.data.id}`);
      headers.set("ETag", documentEtag(result.data));
      return Response.json(envelope, { status: 201, headers });
    }
    // E1 and E2: headers are intentionally ignored, including malformed keys/tags.
    const body = await readOptionalJsonBody(request);
    if (body !== undefined) {
      rejectUnknownFields(body, emptyContract);
      if (!emptyBody.safeParse(body).success) throw new DomainError("validation_failed", "Confirm accepts only an empty JSON object.");
    }
    const ownerId = canonicalUuid(params.idOrCode) ?? await resolveApiDocumentOwner(ctx, ownerType, lookupIdentifier(params.idOrCode));
    const documentId = canonicalUuid(params.documentId ?? "");
    if (!documentId) throw documentNotFound();
    const outcome = mapConfirmOutcome(await confirmDocumentUpload(ctx, { ownerType, ownerId, documentId }, { deadlineAt, audit }));
    if (outcome.status !== 200) throw outcome.error;
    headers.set("ETag", documentEtag(outcome.data));
    return Response.json({ data: outcome.data }, { headers });
  }, { audience: "rest", ...(kind === "confirm" ? { deadlineMs: DOCUMENT_CONFIRM_DEADLINE_MS } : {}) });
}
