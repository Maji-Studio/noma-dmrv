import { createHash } from "node:crypto";
import { payloadHash } from "@/lib/isometric/utils/payload-hash";

export const GHG_STATEMENT_TOTAL_TOLERANCE_KG = 0.001;
export const GHG_STATEMENT_REPORT_MODEL_VERSION = 1;
const SHA256_PATTERN = /^[a-f0-9]{64}$/;

export interface GhgStatementReportNarratives {
  systemBoundaryAndMethodology: string;
  evidenceIndex: string;
  uncertaintyAndSensitivity: string;
  dataQualityAndExceptions: string;
  monitoringAndDurability: string;
  approvalStatement: string;
}

export interface GhgStatementReportDocumentControl {
  organizationName: string;
  facilityCode: string;
  externalProjectId: string;
  externalGhgStatementId: string;
  reportingPeriodStartOn: string;
  reportingPeriodEndOn: string;
  standardVersion: string;
  protocolVersion: string;
}

export interface FrozenRemovalSubmission {
  localRemovalId: string;
  externalRemovalId: string;
  submissionVersion: number;
  payloadHash: string;
  payloadSnapshot: Record<string, unknown>;
}

export interface LiveGhgEntry {
  id: string;
  startedOn: string;
  completedOn: string;
  netRemovedKg: number;
  netRemovedWithoutDiscountKg: number;
  netRemovedStandardDeviationKg: number | null;
  supplierCreditKg: number | null;
  bufferPoolKg: number | null;
  ghgStatementId?: string | null;
}

export interface BuildGhgStatementReportModelInput {
  reportVersion: number;
  preparedAt: string;
  documentControl: GhgStatementReportDocumentControl;
  authoritativeStatement: {
    externalRemovalIds: string[];
    pendingTotalCo2eRemovedKg: number;
  };
  removalSnapshots: FrozenRemovalSubmission[];
  remoteEntries: LiveGhgEntry[];
  narratives: GhgStatementReportNarratives;
}

export interface GhgStatementReportEntry {
  localRemovalId: string;
  externalRemovalId: string;
  removalSubmissionVersion: number;
  removalPayloadHash: string;
  removalPayloadSnapshot: Record<string, unknown>;
  startedOn: string;
  completedOn: string;
  netRemovedKg: number;
  netRemovedWithoutDiscountKg: number;
  netRemovedStandardDeviationKg: number | null;
  supplierCreditKg: number | null;
  bufferPoolKg: number | null;
  sourceBindings: string[];
}

export interface GhgStatementReportModel {
  modelVersion: number;
  reportVersion: number;
  preparedAt: string;
  documentControl: GhgStatementReportDocumentControl;
  narratives: GhgStatementReportNarratives;
  entries: GhgStatementReportEntry[];
  totals: {
    netRemovedKg: number;
    netRemovedWithoutDiscountKg: number;
    uncertaintyDiscountKg: number;
    supplierCreditKg: number | null;
    bufferPoolKg: number | null;
  };
  sourceFingerprint: string;
}

export class GhgStatementReportReconciliationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "GhgStatementReportReconciliationError";
  }
}

function canonicalize(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        // Code-unit ordering, not `localeCompare`: the sort feeds
        // `sourceFingerprint`, and locale/ICU differences between runtimes
        // would otherwise reorder keys and change the fingerprint.
        .sort(([left], [right]) => (left < right ? -1 : left > right ? 1 : 0))
        .map(([key, child]) => [key, canonicalize(child)]),
    );
  }
  return value;
}

export function canonicalJson(value: unknown): string {
  return JSON.stringify(canonicalize(value));
}

export function sha256Hex(value: string | Uint8Array): string {
  return createHash("sha256").update(value).digest("hex");
}

function exactSet(label: string, expected: string[], actual: string[]): void {
  const expectedSet = new Set(expected);
  const actualSet = new Set(actual);
  if (
    expected.length === 0 ||
    expectedSet.size !== expected.length ||
    actualSet.size !== actual.length ||
    expectedSet.size !== actualSet.size ||
    [...expectedSet].some((id) => !actualSet.has(id))
  ) {
    throw new GhgStatementReportReconciliationError(
      `${label} is not represented one-to-one.`,
    );
  }
}

function finite(label: string, value: number): number {
  if (!Number.isFinite(value)) {
    throw new GhgStatementReportReconciliationError(`${label} is malformed.`);
  }
  return value;
}

function optionalSum(
  entries: LiveGhgEntry[],
  select: (entry: LiveGhgEntry) => number | null,
): number | null {
  let total = 0;
  for (const entry of entries) {
    const value = select(entry);
    if (value === null || !Number.isFinite(value)) return null;
    total += value;
  }
  return total;
}

function sourceBindings(snapshot: Record<string, unknown>): string[] {
  const found = new Set<string>();
  const walk = (value: unknown, key = ""): void => {
    if (Array.isArray(value)) {
      if (/source_?ids?|sources?/i.test(key)) {
        for (const item of value) {
          if (typeof item === "string" && item.trim()) found.add(item);
        }
      }
      for (const item of value) walk(item, key);
      return;
    }
    if (!value || typeof value !== "object") return;
    for (const [childKey, child] of Object.entries(
      value as Record<string, unknown>,
    )) {
      if (
        /source_?id$/i.test(childKey) &&
        typeof child === "string" &&
        child.trim()
      ) {
        found.add(child);
      }
      walk(child, childKey);
    }
  };
  walk(snapshot);
  return [...found].sort();
}

function semanticPayload(
  snapshot: FrozenRemovalSubmission,
): Record<string, unknown> {
  const semantic = snapshot.payloadSnapshot.semantic;
  if (
    !semantic ||
    typeof semantic !== "object" ||
    Array.isArray(semantic)
  ) {
    throw new GhgStatementReportReconciliationError(
      `Submitted Removal ${snapshot.externalRemovalId} has no immutable semantic payload.`,
    );
  }
  return semantic as Record<string, unknown>;
}

export function buildGhgStatementReportModel(
  input: BuildGhgStatementReportModelInput,
): GhgStatementReportModel {
  const statementIds = [...input.authoritativeStatement.externalRemovalIds];
  exactSet(
    "Submitted Removal snapshot membership",
    statementIds,
    input.removalSnapshots.map((snapshot) => snapshot.externalRemovalId),
  );
  exactSet(
    "Live GHG Entry membership",
    statementIds,
    input.remoteEntries.map((entry) => entry.id),
  );
  if (
    new Set(
      input.removalSnapshots.map((snapshot) => snapshot.localRemovalId),
    ).size !== input.removalSnapshots.length
  ) {
    throw new GhgStatementReportReconciliationError(
      "Submitted Removal membership is not one-to-one with local Removals.",
    );
  }

  const snapshots = [...input.removalSnapshots].sort((left, right) =>
    left.externalRemovalId.localeCompare(right.externalRemovalId),
  );
  const entriesById = new Map(
    input.remoteEntries.map((entry) => [entry.id, entry]),
  );
  const entries: GhgStatementReportEntry[] = snapshots.map((snapshot) => {
    if (
      !SHA256_PATTERN.test(snapshot.payloadHash) ||
      snapshot.submissionVersion < 1 ||
      !snapshot.payloadSnapshot ||
      typeof snapshot.payloadSnapshot !== "object" ||
      Array.isArray(snapshot.payloadSnapshot)
    ) {
      throw new GhgStatementReportReconciliationError(
        `Submitted Removal ${snapshot.externalRemovalId} has a malformed immutable snapshot.`,
      );
    }
    if (payloadHash(semanticPayload(snapshot)) !== snapshot.payloadHash) {
      throw new GhgStatementReportReconciliationError(
        `Submitted Removal ${snapshot.externalRemovalId} payload hash does not match its immutable snapshot.`,
      );
    }
    const entry = entriesById.get(snapshot.externalRemovalId);
    if (!entry) {
      throw new GhgStatementReportReconciliationError(
        `Live GHG Entry ${snapshot.externalRemovalId} is missing.`,
      );
    }
    for (const [label, value] of [
      ["standard deviation", entry.netRemovedStandardDeviationKg],
      ["supplier allocation", entry.supplierCreditKg],
      ["buffer pool", entry.bufferPoolKg],
    ] as const) {
      if (value !== null && !Number.isFinite(value)) {
        throw new GhgStatementReportReconciliationError(
          `Live GHG Entry ${entry.id} ${label} is malformed.`,
        );
      }
    }
    if (
      entry.ghgStatementId !== undefined &&
      entry.ghgStatementId !== null &&
      entry.ghgStatementId !== input.documentControl.externalGhgStatementId
    ) {
      throw new GhgStatementReportReconciliationError(
        `Live GHG Entry ${entry.id} belongs to another GHG Statement.`,
      );
    }
    return {
      localRemovalId: snapshot.localRemovalId,
      externalRemovalId: snapshot.externalRemovalId,
      removalSubmissionVersion: snapshot.submissionVersion,
      removalPayloadHash: snapshot.payloadHash,
      removalPayloadSnapshot: canonicalize(
        snapshot.payloadSnapshot,
      ) as Record<string, unknown>,
      startedOn: entry.startedOn,
      completedOn: entry.completedOn,
      netRemovedKg: finite("Live net removed", entry.netRemovedKg),
      netRemovedWithoutDiscountKg: finite(
        "Live net before uncertainty",
        entry.netRemovedWithoutDiscountKg,
      ),
      netRemovedStandardDeviationKg: entry.netRemovedStandardDeviationKg,
      supplierCreditKg: entry.supplierCreditKg,
      bufferPoolKg: entry.bufferPoolKg,
      sourceBindings: sourceBindings(snapshot.payloadSnapshot),
    };
  });

  const sortedLiveEntries = entries.map((entry) => ({
    id: entry.externalRemovalId,
    netRemovedKg: entry.netRemovedKg,
    netRemovedWithoutDiscountKg: entry.netRemovedWithoutDiscountKg,
    netRemovedStandardDeviationKg: entry.netRemovedStandardDeviationKg,
    supplierCreditKg: entry.supplierCreditKg,
    bufferPoolKg: entry.bufferPoolKg,
    startedOn: entry.startedOn,
    completedOn: entry.completedOn,
  }));
  const netRemovedKg = sortedLiveEntries.reduce(
    (total, entry) => total + entry.netRemovedKg,
    0,
  );
  const statementTotal = finite(
    "GHG Statement pending total",
    input.authoritativeStatement.pendingTotalCo2eRemovedKg,
  );
  if (
    Math.abs(netRemovedKg - statementTotal) >
    GHG_STATEMENT_TOTAL_TOLERANCE_KG
  ) {
    throw new GhgStatementReportReconciliationError(
      "The GHG Statement total does not match the exact live GHG Entry sum.",
    );
  }
  const netRemovedWithoutDiscountKg = sortedLiveEntries.reduce(
    (total, entry) => total + entry.netRemovedWithoutDiscountKg,
    0,
  );
  const sourceFingerprint = sha256Hex(
    canonicalJson({
      documentControl: input.documentControl,
      statement: {
        externalRemovalIds: [...statementIds].sort(),
        pendingTotalCo2eRemovedKg: statementTotal,
      },
      removalSnapshots: snapshots,
      remoteEntries: sortedLiveEntries,
    }),
  );

  return {
    modelVersion: GHG_STATEMENT_REPORT_MODEL_VERSION,
    reportVersion: input.reportVersion,
    preparedAt: input.preparedAt,
    documentControl: input.documentControl,
    narratives: input.narratives,
    entries,
    totals: {
      netRemovedKg,
      netRemovedWithoutDiscountKg,
      uncertaintyDiscountKg:
        netRemovedWithoutDiscountKg - netRemovedKg,
      supplierCreditKg: optionalSum(
        input.remoteEntries,
        (entry) => entry.supplierCreditKg,
      ),
      bufferPoolKg: optionalSum(
        input.remoteEntries,
        (entry) => entry.bufferPoolKg,
      ),
    },
    sourceFingerprint,
  };
}
