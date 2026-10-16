import { recordLocks, withRecordLockGuidance } from "@/lib/record-lock";

const SENT_LOCK = recordLocks.removal({ dependents: [], removals: [{ id: "removal", submissions: [{ status: "submitted" }], statements: [] }] });

export type CertificationLineageLockEntityType =
  | "creditBatch"
  | "productionRun"
  | "sample"
  | "application"
  | "delivery"
  | "order"
  | "biocharProduct"
  | "feedstock"
  | "transportLeg"
  | "vehicle";

export type CertificationLineageMutation = "create" | "update" | "delete";

/** The one line a document panel shows above its files once its record is locked. */
export const RECORD_FILES_LOCKED_MESSAGE =
  "This record is in a submitted Removal, so its files cannot change.";

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
  vehicle: "vehicle",
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
    return withRecordLockGuidance(`Cannot ${mutation} this ${ENTITY_LABELS[subjectEntityType]} because it is locked by a certification submission.`, SENT_LOCK);
  }

  const lineageLabel = ENTITY_LABELS[lineageEntityType];
  const article = /^[aeiou]/i.test(lineageLabel) ? "an" : "a";
  const relationship =
    lineageRelationship ?? (mutation === "create" ? "selected" : "linked");
  const explanation = `Cannot ${mutation} this ${ENTITY_LABELS[subjectEntityType]} because the ${relationship} ${lineageLabel} is locked by a certification submission.`;

  return relationship === "selected"
    ? `${explanation} Select ${article} ${lineageLabel} that is not locked.`
    : withRecordLockGuidance(explanation, SENT_LOCK);
}
