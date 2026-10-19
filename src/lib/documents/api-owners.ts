import { hasRoleAndScope, type ApiScope } from "@/lib/auth/api-scopes";
import { DELIVERY_EVIDENCE_DOCUMENT_TYPES } from "@/lib/certification/delivery-evidence";
import { TRANSPORT_EVIDENCE_DOCUMENT_TYPES } from "@/lib/certification/transport-evidence";
import type { DocumentEntityType, DocumentType } from "@/schemas/documents";

interface ApiDocumentOwner {
  entityType: DocumentEntityType;
  path: string;
  documentTypes: readonly DocumentType[];
  readScope: ApiScope;
  writeScope: ApiScope;
}

/** API allowlist only. The app's broader owner and type rules stay independent. */
export const API_DOCUMENT_OWNERS = {
  feedstock: {
    entityType: "feedstock", path: "feedstocks",
    documentTypes: TRANSPORT_EVIDENCE_DOCUMENT_TYPES,
    readScope: "feedstocks:read", writeScope: "feedstocks:write",
  },
  delivery: {
    entityType: "delivery", path: "deliveries", documentTypes: DELIVERY_EVIDENCE_DOCUMENT_TYPES,
    readScope: "deliveries:read", writeScope: "deliveries:write",
  },
  lab_sample: {
    entityType: "sample", path: "lab-samples", documentTypes: ["lab_report"],
    readScope: "lab-samples:read", writeScope: "lab-samples:write",
  },
  application: {
    entityType: "application", path: "applications", documentTypes: ["photo", "pdf"],
    readScope: "applications:read", writeScope: "applications:write",
  },
} as const satisfies Record<string, ApiDocumentOwner>;

export type ApiDocumentOwnerType = keyof typeof API_DOCUMENT_OWNERS;
export const API_DOCUMENT_OWNER_TYPES = Object.keys(API_DOCUMENT_OWNERS) as [ApiDocumentOwnerType, ...ApiDocumentOwnerType[]];

export function isApiDocumentOwnerType(value: string): value is ApiDocumentOwnerType {
  return Object.hasOwn(API_DOCUMENT_OWNERS, value);
}

export function allowsApiDocumentType(ownerType: ApiDocumentOwnerType, documentType: DocumentType): boolean {
  const types: readonly DocumentType[] = API_DOCUMENT_OWNERS[ownerType].documentTypes;
  return types.includes(documentType);
}

/** Owner scope and API role floor are always checked together. */
export function canAccessOwnerDocuments(context: Parameters<typeof hasRoleAndScope>[0], ownerType: string, access: "read" | "write"): boolean {
  return isApiDocumentOwnerType(ownerType) && hasRoleAndScope(context, API_DOCUMENT_OWNERS[ownerType][access === "read" ? "readScope" : "writeScope"]);
}

export function apiDocumentOwnerType(entityType: string): ApiDocumentOwnerType {
  const ownerType = API_DOCUMENT_OWNER_TYPES.find((type) => API_DOCUMENT_OWNERS[type].entityType === entityType);
  if (!ownerType) throw new Error("Document owner is not exposed on the API");
  return ownerType;
}
