export type CertificationLineageLockEntityType =
  | "creditBatch"
  | "productionRun"
  | "sample"
  | "application"
  | "delivery"
  | "order"
  | "biocharProduct"
  | "feedstock"
  | "transportLeg";

export type CertificationLineageMutation = "create" | "update" | "delete";

const ENTITY_LABELS: Record<CertificationLineageLockEntityType, string> = {
  creditBatch: "credit batch",
  productionRun: "production run",
  sample: "sample",
  application: "application",
  delivery: "delivery",
  order: "order",
  biocharProduct: "biochar product",
  feedstock: "feedstock",
  transportLeg: "transport leg",
};

interface CertificationLineageLockMessageInput {
  mutation: CertificationLineageMutation;
  subjectEntityType: CertificationLineageLockEntityType;
  lineageEntityType: CertificationLineageLockEntityType;
}

export function formatCertificationLineageLockMessage({
  mutation,
  subjectEntityType,
  lineageEntityType,
}: CertificationLineageLockMessageInput): string {
  const lineageSubject =
    subjectEntityType === lineageEntityType
      ? "it"
      : `its ${ENTITY_LABELS[lineageEntityType]}`;

  return `Cannot ${mutation} this ${ENTITY_LABELS[subjectEntityType]} because ${lineageSubject} is part of a submitted Removal. Submitted Removal data is locked. Removal cancellation is not available yet.`;
}
