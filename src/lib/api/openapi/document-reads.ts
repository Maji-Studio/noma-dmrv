import type { z } from "zod";
import { API_DOCUMENT_OWNERS, API_DOCUMENT_OWNER_TYPES } from "@/lib/documents/api-owners";
import { documentRepresentationSchema } from "@/lib/representations/documents";
import { itemEnvelopeSchema, listEnvelopeSchema } from "@/lib/representations/envelopes";
import { readDescriptions } from "@/lib/operations/read-descriptions";
import type { JsonSchema } from "@/lib/operations/json-schema";
import { documentListSchema } from "../query-schemas";
import { privateOperation, type Paths } from "./operation-kit";
import { etagHeader, jsonResponse, privateHeaders, problemResponses, queryParameters, targetParameter } from "./transport";

const READ_ERRORS = [400, 401, 403, 404, 429, 500];
const documentParameter = { name: "documentId", in: "path", required: true,
  description: "Document UUID belonging to this record.", schema: { type: "string", format: "uuid" } };

export function addDocumentReadPaths(paths: Paths, publishOutput: (schema: z.ZodType) => JsonSchema) {
  for (const ownerType of API_DOCUMENT_OWNER_TYPES) {
    const owner = API_DOCUMENT_OWNERS[ownerType];
    const base = `/${owner.path}/{idOrCode}/documents`;
    paths[base] = { get: privateOperation(`find_${ownerType}_documents`, owner.readScope, readDescriptions.documents,
      { ...problemResponses(READ_ERRORS), "200": jsonResponse("Document page.", publishOutput(listEnvelopeSchema(documentRepresentationSchema))) },
      [targetParameter(), ...queryParameters(documentListSchema(ownerType))]) };
    paths[`${base}/{documentId}`] = { get: privateOperation(`get_${ownerType}_document`, owner.readScope, readDescriptions.document,
      { ...problemResponses(READ_ERRORS), "200": jsonResponse("Document representation.", publishOutput(itemEnvelopeSchema(documentRepresentationSchema)), etagHeader) },
      [targetParameter(), documentParameter]) };
    paths[`${base}/{documentId}/content`] = { get: privateOperation(`get_${ownerType}_document_content`, owner.readScope, readDescriptions.documentContent,
      { ...problemResponses(READ_ERRORS), "302": { description: "Fresh signed download URL; no body.", headers: { ...privateHeaders,
        Location: { description: "Signed GET URL expiring in 5 minutes. Fetch without the API key.", schema: { type: "string", format: "uri" } },
        "Cache-Control": { description: "Do not store this private capability.", schema: { type: "string", const: "private, no-store" } },
        "Referrer-Policy": { description: "Do not send a referrer when following this redirect.", schema: { type: "string", const: "no-referrer" } },
      } } }, [targetParameter(), documentParameter]) };
  }
}
