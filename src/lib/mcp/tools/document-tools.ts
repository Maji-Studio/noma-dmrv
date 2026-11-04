import { documentDownloadUrl } from "@/lib/documents/download-url";
import { requestDocumentUploadWithCapability } from "@/lib/documents/upload-request";
import { z } from "zod";
import { DOCUMENT_CONFIRM_DEADLINE_MS } from "@/config/documents";
import type { ApiContext } from "@/lib/auth/api-context";
import { ApiHttpError } from "@/lib/api/http-error";
import { canonicalUuid } from "@/lib/api/canonical-uuid";
import { lookupIdentifier, readLookupPage } from "@/lib/api/lookup-query";
import { parseQueryInput } from "@/lib/api/query";
import { documentListSchema } from "@/lib/api/query-schemas";
import { rejectUnknownFields } from "@/lib/api/unknown-fields";
import { DomainError } from "@/lib/domain-errors";
import { API_DOCUMENT_OWNERS, API_DOCUMENT_OWNER_TYPES, canAccessOwnerDocuments } from "@/lib/documents/api-owners";
import { confirmDocumentUpload } from "@/lib/documents/confirm-upload";
import { mapConfirmOutcome } from "@/lib/documents/confirm-outcome";
import { validationFailed } from "@/lib/operations/errors";
import { toOperationJsonSchema } from "@/lib/operations/json-schema";
import { DOCUMENT_GUIDANCE, DOCUMENT_TYPE_GUIDANCE } from "@/lib/operations/document-guidance";
import { documentNotFound, readApiDocumentList, resolveApiDocumentOwner } from "@/lib/read-models/api-documents";
import { documentRepresentationSchema } from "@/lib/representations/documents";
import { documentUploadEnvelopeSchema } from "@/lib/representations/document-writes";
import { itemEnvelopeSchema, listEnvelopeSchema } from "@/lib/representations/envelopes";
import { requestDocumentUploadBodyInput } from "@/schemas/document-input";
import type { ReadTool } from "./read-tools";
import type { WriteTool } from "./write-tools";
import { controls, parseControls, writeOptions } from "./write-controls";


const documentType = z.enum([...new Set(Object.values(API_DOCUMENT_OWNERS).flatMap(owner => [...owner.documentTypes]))]).describe(DOCUMENT_TYPE_GUIDANCE);
const unsupportedDryRun = controls.shape.dryRun.describe("Not supported; true is refused.");
const ownerFields = {
  ownerType: z.enum(API_DOCUMENT_OWNER_TYPES),
  ownerId: z.string().min(1).describe("Record UUID or exact code from find_deliveries, find_feedstocks, find_lab_samples or find_applications."),
};
const ownerSchema = z.object({ ownerType: ownerFields.ownerType });
const listInput = documentListSchema("delivery").extend({ ...ownerFields, documentType: documentType.optional() });
const getInput = z.strictObject({ ...ownerFields, documentId: z.string().describe("Document UUID from find_documents or request_document_upload.") });
const requestInput = requestDocumentUploadBodyInput.extend({ ...ownerFields, ...controls.shape, documentType, dryRun: unsupportedDryRun,
  requestKey: controls.shape.requestKey.unwrap().describe("Generate one requestKey per intended upload and reuse it on retry. Required; no dry run is available."),
});
const confirmInput = getInput.extend({ dryRun: unsupportedDryRun });
const requestContract = toOperationJsonSchema(requestInput);
const confirmContract = toOperationJsonSchema(confirmInput);
const annotations = { readOnlyHint: false, openWorldHint: false, destructiveHint: false, idempotentHint: true } as const;

function access(kind: "read" | "write") {
  return {
    requiredScopes(args: unknown) {
      const parsed = ownerSchema.safeParse(args);
      if (!parsed.success) throw validationFailed(parsed.error);
      return [API_DOCUMENT_OWNERS[parsed.data.ownerType][kind === "read" ? "readScope" : "writeScope"]];
    },
    visible: (ctx: ApiContext) => API_DOCUMENT_OWNER_TYPES.some(owner => canAccessOwnerDocuments(ctx, owner, kind)),
    authorize(ctx: ApiContext, args: unknown) {
      if (kind === "read") parseQueryInput(args, ownerSchema);
      const parsed = ownerSchema.safeParse(args);
      if (!parsed.success) throw validationFailed(parsed.error);
      if (!canAccessOwnerDocuments(ctx, parsed.data.ownerType, kind)) {
        throw new ApiHttpError(403, "missing_scope", "The credential cannot authorize this request.");
      }
    },
  };
}
function noDryRun(dryRun: boolean) {
  if (dryRun) throw new DomainError("validation_failed", "This operation does not offer a dry run.");
}

export const documentReadTools: ReadTool[] = [
  {
    kind: "read", name: "find_documents", ...access("read"), input: listInput,
    output: listEnvelopeSchema(documentRepresentationSchema),
    description: `Find documents on a record. Defaults to uploaded files; use uploadStatus all for every state. Archived records remain readable. ${DOCUMENT_GUIDANCE}`,
    async execute(ctx, raw) {
      const { ownerType, ownerId: identifier, ...query } = parseQueryInput(raw, listInput);
      const { limit, cursor, ...filters } = parseQueryInput(query, documentListSchema(ownerType));
      const ownerId = await resolveApiDocumentOwner(ctx, ownerType, lookupIdentifier(identifier));
      return readLookupPage(ctx, `${API_DOCUMENT_OWNERS[ownerType].path}/${ownerId}/documents`, { limit, cursor, filters },
        (ctx, query) => readApiDocumentList(ctx, ownerType, ownerId, query));
    },
    summarize: body => `${(body.data as unknown[]).length} documents.${body.nextCursor ? " More results: pass nextCursor." : ""}`,
  },
  {
    kind: "read", name: "get_document_download_url", ...access("read"), input: getInput,
    output: z.object({ url: z.url(), expiresAt: z.iso.datetime() }),
    description: `Get an expiring download link for an uploaded document. Pending, failed and legacy files have no download link. Use the link without the API key. ${DOCUMENT_GUIDANCE}`,
    async execute(ctx, raw) {
      const { ownerType, ownerId: identifier, documentId: documentIdentifier } = parseQueryInput(raw, getInput);
      const ownerId = await resolveApiDocumentOwner(ctx, ownerType, lookupIdentifier(identifier));
      const documentId = canonicalUuid(documentIdentifier);
      if (!documentId) throw documentNotFound();
      return documentDownloadUrl(ctx, ownerType, ownerId, documentId);
    },
    summarize: () => "Download link ready. Use it before expiresAt without the API key.",
  },
];

export const documentWriteTools: WriteTool[] = [
  {
    kind: "write", name: "request_document_upload", ...access("write"), input: requestInput,
    output: documentUploadEnvelopeSchema, annotations,
    description: `Request an upload for one document. requestKey is required. No dry run is available. Repeat the same requestKey to receive a fresh link while pending. If you cannot make an HTTP PUT, tell the person to attach the file to the record in noma. ${DOCUMENT_GUIDANCE}`,
    async execute(context, raw) {
      const { input, dryRun, requestKey } = parseControls(raw, requestContract);
      noDryRun(dryRun);
      const parsed = requestInput.omit({ dryRun: true, requestKey: true }).safeParse(input);
      if (!parsed.success) throw validationFailed(parsed.error);
      const { result, body } = await requestDocumentUploadWithCapability(context.ctx, parsed.data.ownerType, parsed.data.ownerId, parsed.data, {
        ...writeOptions(context, false, requestKey), deadlineAt: context.deadlineAt,
      });
      return { ...result, body };
    },
    summarize: body => body.upload ? "Upload requested. PUT the bytes to upload.url with upload.headers, then call confirm_document_upload."
      : (body.warnings as string[]).join(" "),
  },
  {
    kind: "write", name: "confirm_document_upload", deadlineMs: DOCUMENT_CONFIRM_DEADLINE_MS, ...access("write"), input: confirmInput,
    output: itemEnvelopeSchema(documentRepresentationSchema), annotations,
    description: `Confirm after the PUT finishes. No requestKey, expectedVersion or dry run is accepted. Repeat this call to recover a lost reply. ${DOCUMENT_GUIDANCE}`,
    async execute(context, raw) {
      rejectUnknownFields(raw, confirmContract);
      const parsed = confirmInput.safeParse(raw);
      if (!parsed.success) throw validationFailed(parsed.error);
      const { ownerType, ownerId: identifier, documentId: documentIdentifier, dryRun } = parsed.data;
      noDryRun(dryRun);
      const ownerId = canonicalUuid(identifier) ?? await resolveApiDocumentOwner(context.ctx, ownerType, lookupIdentifier(identifier));
      const documentId = canonicalUuid(documentIdentifier);
      if (!documentId) throw documentNotFound();
      const outcome = mapConfirmOutcome(await confirmDocumentUpload(context.ctx, { ownerType, ownerId, documentId }, {
        deadlineAt: context.deadlineAt, audit: writeOptions(context, false).audit,
      }));
      if (outcome.status !== 200) throw outcome.error;
      return { body: { data: outcome.data }, dryRun: false, replayed: false };
    },
    summarize: () => "Document uploaded and verified.",
  },
];
