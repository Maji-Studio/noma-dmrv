import type { DocumentEntityType, DocumentType } from "@/schemas/documents";

export interface ProjectEmissionSourceUploadConfig {
  accept: string;
  documentType: DocumentType;
  entityId: string;
  entityType: DocumentEntityType;
  maxSizeMb: number;
  multiple: boolean;
}

export function createProjectEmissionSourceUploadConfig(
  facilityId: string,
): ProjectEmissionSourceUploadConfig {
  return {
    accept: "application/pdf,.pdf",
    documentType: "pdf",
    entityId: facilityId,
    entityType: "facility",
    maxSizeMb: 50,
    multiple: false,
  };
}
