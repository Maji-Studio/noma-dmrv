import type { DocumentRow } from "@/data-access/certification";
import type { ClassifiedRemovalSource } from "@/lib/certification/removal-source-bindings";

export type CandidateLineageEntityType =
  | "application"
  | "delivery"
  | "feedstock"
  | "credit_batch"
  | "sample"
  | "emission_entry";

export interface CandidateLineageEntity {
  entityType: CandidateLineageEntityType;
  entityId: string;
  entityLabel: string;
}

export interface CandidateDocument {
  includedInSubmission?: boolean;
  document: DocumentRow;
  lineageEntity: CandidateLineageEntity;
  binding: ClassifiedRemovalSource | null;
  biocharApplicationId?: string | null;
  mirror: {
    externalDocumentId: string;
    isPublic: boolean;
    mirroredAt: Date;
  } | null;
}

