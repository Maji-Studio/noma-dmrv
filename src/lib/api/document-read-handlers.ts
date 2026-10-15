import { API_DOCUMENT_OWNERS, canAccessOwnerDocuments, type ApiDocumentOwnerType } from "@/lib/documents/api-owners";
import { documentNotFound, readApiDocument, readApiDocumentList, resolveApiDocumentOwner } from "@/lib/read-models/api-documents";
import { representDocument } from "@/lib/representations/documents";
import { documentDownloadUrl } from "@/lib/documents/download-url";
import { apiRoute } from "./route";
import { apiDenialResponse } from "./problem";
import { canonicalUuid } from "./canonical-uuid";
import { lookupIdentifier, parseApiQuery, readLookupPage } from "./lookup-query";
import { documentListSchema, lookupGetSchema } from "./query-schemas";
import { documentEtag } from "./representation-etags";

type Params = { idOrCode: string; documentId?: string };
type ReadKind = "list" | "get" | "content";

/** One adapter for every API owner. Only GET is exported by the route modules. */
export function documentReadHandler(ownerType: ApiDocumentOwnerType, kind: ReadKind) {
  const owner = API_DOCUMENT_OWNERS[ownerType];
  return apiRoute<Params>(`api.v1.${owner.path}.documents.${kind}`, owner.readScope, async (request, context, params) => {
    const { ctx, headers, instance, requestId } = context;
    if (!canAccessOwnerDocuments(ctx, ownerType, "read")) return apiDenialResponse("missing_scope", instance, requestId);
    if (kind === "list") {
      const { limit, cursor, ...filters } = parseApiQuery(request, documentListSchema(ownerType));
      const ownerId = await resolveApiDocumentOwner(ctx, ownerType, lookupIdentifier(params.idOrCode));
      const page = await readLookupPage(ctx, `${owner.path}/${ownerId}/documents`, { limit, cursor, filters },
        (ctx, query) => readApiDocumentList(ctx, ownerType, ownerId, query));
      return Response.json(page, { headers });
    }
    parseApiQuery(request, lookupGetSchema);
    const ownerId = await resolveApiDocumentOwner(ctx, ownerType, lookupIdentifier(params.idOrCode));
    const documentId = canonicalUuid(params.documentId ?? "");
    if (!documentId) throw documentNotFound();
    if (kind === "content") {
      const { url: location } = await documentDownloadUrl(ctx, ownerType, ownerId, documentId);
      headers.set("Location", location);
      headers.set("Referrer-Policy", "no-referrer");
      return new Response(null, { status: 302, headers });
    }
    const row = await readApiDocument(ctx, ownerType, ownerId, documentId);
    const data = representDocument(row);
    const etag = documentEtag(data);
    headers.set("ETag", etag);
    return Response.json({ data }, { headers });
  });
}
