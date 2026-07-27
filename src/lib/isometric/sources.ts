import { IsometricApiError, type IsometricClient } from "./client";
import type { components } from "./generated/certify";

export type CreateDocumentSourceRequest =
  components["schemas"]["CreateDocumentSourceRequest"];
export type CreateSourceResponse =
  components["schemas"]["CreateSourceResponse"];
export type Source = components["schemas"]["Source"];
export type SignedUploadUrlRequest =
  components["schemas"]["SignedUploadUrlRequest"];

const SUPPLIER_REF_LOOKUP_PAGE_SIZE = 1;

export function createSource(
  client: IsometricClient,
  body: CreateDocumentSourceRequest,
): Promise<CreateSourceResponse> {
  return client.post<CreateSourceResponse>("/sources", body);
}

// Reconciliation entry: when a previous mirror attempt POSTed /sources but
// crashed before/inside the PUT, the local row is missing. The follow-up call
// either returns a fresh upload URL (we retry the PUT) or 409 (already
// uploaded — just insert the local row). `requestSignedUploadUrl` returns
// `{ kind: "url", uploadUrl }` for the URL case and `{ kind: "already_uploaded" }`
// for the 409 case so callers can branch without inspecting raw errors.
//
// Isometric's response body for the success path is a JSON string (the URL
// itself), not an object — see openapi-typescript output at
// `post_signed_upload_url_sources__id__signed_upload_url_post`.
export interface SignedUploadUrlResult {
  kind: "url" | "already_uploaded";
  uploadUrl?: string;
}

export async function requestSignedUploadUrl(
  client: IsometricClient,
  sourceId: string,
  body: SignedUploadUrlRequest,
): Promise<SignedUploadUrlResult> {
  try {
    const uploadUrl = await client.post<string>(
      `/sources/${sourceId}/signed_upload_url`,
      body,
    );
    return { kind: "url", uploadUrl };
  } catch (err) {
    if (err instanceof IsometricApiError && err.status === 409) {
      return { kind: "already_uploaded" };
    }
    throw err;
  }
}

export async function findSourceBySupplierRef(
  client: IsometricClient,
  ref: string,
): Promise<Source | null> {
  for await (const node of client.paginate<Source>("/sources", {
    query: { supplier_reference_id: ref },
    pageSize: SUPPLIER_REF_LOOKUP_PAGE_SIZE,
  })) {
    return node;
  }
  return null;
}

// DELETE /sources/{id} intentionally not exported in Phase 3.5.
// Source IDs land in certification_submissions.payloadSnapshot — remote
// deletion would break submission audit/resume. Before submission, evidence
// replacement retires only the unreferenced local mapping from its owning
// record; the remote Source remains intact.
