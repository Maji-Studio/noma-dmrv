import { recordLocks, withRecordLockGuidance, formatRecordLockHolders, type RecordLock } from "@/lib/record-lock";

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

/**
 * The same line for a record whose every holding Removal was interrupted while
 * being sent. It keeps the consequence and names no release: finishing the
 * submission leaves the record Sent, and the header's lock notice already says
 * how to edit again (record-lock.ts `INTERRUPTED_HOW_TO_FREE`).
 */
export const RECORD_FILES_INTERRUPTED_MESSAGE =
  "This record is in a Removal whose submission was interrupted, so its files cannot change.";

/** The lock fields the files line reads; the server lock and its screen view both fit. */
interface FilesLockFacts {
  level: RecordLock["level"];
  heldBy: readonly unknown[];
  interruptedHolders?: readonly unknown[];
}

/**
 * The files line, worded as the record header words the same lock: interrupted
 * only when every holder is interrupted (a mixed lock reads Sent there too).
 * An unknown lock keeps the submitted line, as before the lock read answers.
 */
export function formatRecordFilesLockedMessage(lock: FilesLockFacts | undefined): string {
  const interrupted = lock?.level === "sent" ? lock.interruptedHolders?.length ?? 0 : 0;
  return lock && interrupted > 0 && interrupted >= lock.heldBy.length
    ? RECORD_FILES_INTERRUPTED_MESSAGE
    : RECORD_FILES_LOCKED_MESSAGE;
}

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
  lock?: RecordLock;
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
  lock = SENT_LOCK,
}: CertificationLineageLockMessageInput): string {
  if (subjectEntityType === lineageEntityType) {
    return withRecordLockGuidance(`Cannot ${mutation} this ${ENTITY_LABELS[subjectEntityType]} because it is locked by a certification submission.`, lock);
  }

  const lineageLabel = ENTITY_LABELS[lineageEntityType];
  const article = /^[aeiou]/i.test(lineageLabel) ? "an" : "a";
  const relationship =
    lineageRelationship ?? (mutation === "create" ? "selected" : "linked");
  const explanation = `Cannot ${mutation} this ${ENTITY_LABELS[subjectEntityType]} because the ${relationship} ${lineageLabel} is locked by a certification submission.`;

  return relationship === "selected"
    ? withRecordLockGuidance(`${explanation} Select ${article} ${lineageLabel} that is not locked.`, lock)
    : withRecordLockGuidance(explanation, lock);
}

export function formatCertificationHolderDetail(lock: RecordLock): string {
  return formatRecordLockHolders(lock);
}

export function formatCertifierMappingLockMessage(action: "change" | "unlink"): string {
  return `${action === "change" ? "Cannot change certifier project or facility ID" : "Cannot unlink"}: this facility has certifier submissions. Delete interrupted Removals and their registry records first. Completed Removal or GHG Statement submissions keep this mapping fixed.`;
}
