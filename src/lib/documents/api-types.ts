import { DOCUMENT_TYPES, type DocumentType } from "@/schemas/documents";

export const APP_ONLY_DOCUMENT_TYPES = ["reflectance_histogram"] as const satisfies readonly DocumentType[];
const appOnlyDocumentTypes: ReadonlySet<DocumentType> = new Set(APP_ONLY_DOCUMENT_TYPES);

/** Published REST and MCP classifications exclude app-only types. */
export const API_DOCUMENT_TYPES = DOCUMENT_TYPES.filter(
  (type): type is Exclude<DocumentType, (typeof APP_ONLY_DOCUMENT_TYPES)[number]> => !appOnlyDocumentTypes.has(type),
);
