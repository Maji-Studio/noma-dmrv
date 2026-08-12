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
  lineageRelationship?: "linked" | "selected";
}

export function formatCertificationLineageLockMessage({
  mutation,
  subjectEntityType,
  lineageEntityType,
  lineageRelationship,
}: CertificationLineageLockMessageInput): string {
  if (subjectEntityType === lineageEntityType) {
    return `Cannot ${mutation} this ${ENTITY_LABELS[subjectEntityType]} because it is locked by a certification submission.`;
  }

  const lineageLabel = ENTITY_LABELS[lineageEntityType];
  const relationship =
    lineageRelationship ?? (mutation === "create" ? "selected" : "linked");
  const explanation = `Cannot ${mutation} this ${ENTITY_LABELS[subjectEntityType]} because the ${relationship} ${lineageLabel} is locked by a certification submission.`;

  return relationship === "selected"
    ? `${explanation} Select a ${lineageLabel} that is not locked.`
    : explanation;
}
