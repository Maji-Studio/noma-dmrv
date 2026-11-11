/**
 * Files that back unrelated evidence on one Removal (#1531).
 *
 * The operator may attach the same file wherever they like; nothing here
 * blocks. Review & submit only points out a file that is the Source for
 * evidence of different kinds, such as a lab report that is also the file for
 * staff travel, because a verifier opening it for the second finds the first.
 *
 * Some reuse is normal, so roles that may share one file form one kind: one lab
 * report covers its samples, one bill of lading covers the deliveries on one
 * truck, one application file covers several applications, and one invoice
 * covers several entries of one emission component. A file used across kinds
 * gets a note; a file reused within one kind does not.
 */
import { isComponentEvidenceRole, type ComponentEvidenceRole, type NomaEvidenceRole } from "@/lib/isometric/semantic-binding-catalog";

/** Application evidence files that bind to the Biochar Application, not to a Datapoint. */
export const APPLICATION_EVIDENCE_ROLE = "application_evidence";
export type SourceFileRole = NomaEvidenceRole | typeof APPLICATION_EVIDENCE_ROLE;

type FixedKindRole = Exclude<SourceFileRole, ComponentEvidenceRole>;

/**
 * The grouping table: each evidence role and the kind it belongs to. Roles in
 * one kind may share a file. Emissions entries are not listed: each emission
 * component is its own kind.
 */
export const EVIDENCE_KINDS: Record<FixedKindRole, { key: string; label: string; order: number }> = {
  lab_report: { key: "lab-report", label: "Lab report", order: 0 },
  inventory: { key: "application-evidence", label: "Application evidence", order: 1 },
  application_evidence: { key: "application-evidence", label: "Application evidence", order: 1 },
  delivery_bill_of_lading: { key: "delivery-bill-of-lading", label: "Delivery bill of lading", order: 2 },
  feedstock_bill_of_lading: { key: "feedstock-bill-of-lading", label: "Feedstock bill of lading", order: 3 },
  transport_evidence_ledger: { key: "transport-evidence-ledger", label: "Transport evidence ledger", order: 4 },
  durability_evidence_ledger: { key: "durability-evidence-ledger", label: "Durability evidence ledger", order: 5 },
};

/** Emission components follow the fixed kinds, by name. */
const EMISSION_KIND_ORDER = Object.keys(EVIDENCE_KINDS).length;
const EMISSION_KIND_FALLBACK_LABEL = "Emissions entry";

export interface SourceFileRecord {
  label: string;
  href: string | null;
}

/** One file attached as one Source on this Removal. */
export interface SourceFileUse {
  /** The file's identity: equal bytes share a key even when uploaded twice. */
  fileKey: string;
  fileName: string;
  role: SourceFileRole;
  /** Emissions entries only: the component the entry is recorded on. */
  component?: { id: string; name: string | null } | null;
  /** The record or emission component the file backs. */
  record: SourceFileRecord;
}

export interface SharedSourceFileKind {
  key: string;
  label: string;
  records: SourceFileRecord[];
}

export interface SharedSourceFile {
  fileKey: string;
  fileName: string;
  kinds: SharedSourceFileKind[];
}

interface EvidenceKind {
  key: string;
  label: string;
  order: number;
}

/** The kind a use belongs to. */
export function evidenceKindOf(use: Pick<SourceFileUse, "role" | "component">): EvidenceKind {
  if (!isComponentEvidenceRole(use.role)) return EVIDENCE_KINDS[use.role];
  const componentId = use.component?.id ?? "unknown";
  return {
    key: `emission-component:${componentId}`,
    label: use.component?.name?.trim() || EMISSION_KIND_FALLBACK_LABEL,
    order: EMISSION_KIND_ORDER,
  };
}

const byText = (left: string, right: string) => left.localeCompare(right);

/** Files that back evidence of two or more kinds, by file name, each with its kinds in a stable order. */
export function findSharedSourceFiles(uses: readonly SourceFileUse[]): SharedSourceFile[] {
  const files = new Map<string, { names: Set<string>; kinds: Map<string, EvidenceKind & { records: Map<string, SourceFileRecord> }> }>();
  for (const use of uses) {
    const file = files.get(use.fileKey) ?? { names: new Set<string>(), kinds: new Map() };
    files.set(use.fileKey, file);
    file.names.add(use.fileName);
    const kind = evidenceKindOf(use);
    const entry = file.kinds.get(kind.key) ?? { ...kind, records: new Map<string, SourceFileRecord>() };
    file.kinds.set(kind.key, entry);
    entry.records.set(`${use.record.label}\u0000${use.record.href ?? ""}`, use.record);
  }

  return [...files.entries()]
    .filter(([, file]) => file.kinds.size > 1)
    .map(([fileKey, file]) => ({
      fileKey,
      fileName: [...file.names].sort(byText)[0],
      kinds: [...file.kinds.values()]
        .sort((left, right) => left.order - right.order || byText(left.label, right.label) || byText(left.key, right.key))
        .map(({ key, label, records }) => ({
          key,
          label,
          records: [...records.values()].sort((left, right) => byText(left.label, right.label)),
        })),
    }))
    .sort((left, right) => byText(left.fileName, right.fileName) || byText(left.fileKey, right.fileKey));
}
