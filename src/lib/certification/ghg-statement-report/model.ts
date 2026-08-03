import { createHash } from "node:crypto";

export const GHG_STATEMENT_TOTAL_TOLERANCE_KG = 0.001;
export const GHG_STATEMENT_REPORT_MODEL_VERSION = 2;

export interface GhgStatementReportDocumentControl {
  organizationName: string;
  facilityCode: string;
  externalProjectId: string;
  externalGhgStatementId: string;
  reportingPeriodStartOn: string;
  reportingPeriodEndOn: string;
  /** Repo-pinned Isometric Standard version the totals were computed under. */
  standardVersion: string;
  /** Repo-pinned Biochar Protocol version the totals were computed under. */
  protocolVersion: string;
  /**
   * Operator-typed Certify project protocol version (nullable free text).
   * Display-only: excluded from the source fingerprint so a settings edit
   * cannot masquerade as live registry drift and stale an approved report.
   */
  configuredProtocolVersion: string | null;
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
    externalEntryIds: string[];
    pendingTotalCo2eRemovedKg: number;
  };
  remoteEntries: LiveGhgEntry[];
}

export interface GhgStatementReportEntry {
  externalEntryId: string;
  startedOn: string;
  completedOn: string;
  netRemovedKg: number;
  netRemovedWithoutDiscountKg: number;
  netRemovedStandardDeviationKg: number | null;
  supplierCreditKg: number | null;
  bufferPoolKg: number | null;
}

export interface GhgStatementReportModel {
  modelVersion: number;
  reportVersion: number;
  preparedAt: string;
  documentControl: GhgStatementReportDocumentControl;
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

function compareCodeUnits(left: string, right: string): number {
  // Fingerprints must not depend on locale or ICU collation differences.
  return left < right ? -1 : left > right ? 1 : 0;
}

function canonicalize(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .sort(([left], [right]) => compareCodeUnits(left, right))
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
  entries: GhgStatementReportEntry[],
  select: (entry: GhgStatementReportEntry) => number | null,
): number | null {
  let total = 0;
  for (const entry of entries) {
    const value = select(entry);
    if (value === null || !Number.isFinite(value)) return null;
    total += value;
  }
  return total;
}

export function buildGhgStatementReportModel(
  input: BuildGhgStatementReportModelInput,
): GhgStatementReportModel {
  const statementEntryIds = [...input.authoritativeStatement.externalEntryIds];
  exactSet(
    "Live GHG Entry membership",
    statementEntryIds,
    input.remoteEntries.map((entry) => entry.id),
  );

  const entries = [...input.remoteEntries]
    .sort((left, right) => compareCodeUnits(left.id, right.id))
    .map((entry): GhgStatementReportEntry => {
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
        entry.ghgStatementId !==
          input.documentControl.externalGhgStatementId
      ) {
        throw new GhgStatementReportReconciliationError(
          `Live GHG Entry ${entry.id} belongs to another GHG Statement.`,
        );
      }
      return {
        externalEntryId: entry.id,
        startedOn: entry.startedOn,
        completedOn: entry.completedOn,
        netRemovedKg: finite("Live net removed", entry.netRemovedKg),
        netRemovedWithoutDiscountKg: finite(
          "Live net before uncertainty",
          entry.netRemovedWithoutDiscountKg,
        ),
        netRemovedStandardDeviationKg:
          entry.netRemovedStandardDeviationKg,
        supplierCreditKg: entry.supplierCreditKg,
        bufferPoolKg: entry.bufferPoolKg,
      };
    });

  const netRemovedKg = entries.reduce(
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
  const netRemovedWithoutDiscountKg = entries.reduce(
    (total, entry) => total + entry.netRemovedWithoutDiscountKg,
    0,
  );
  // Operator-editable and display-only: neutralized in the hash so a
  // Certification Settings edit cannot masquerade as live registry drift.
  const fingerprintedControl = {
    ...input.documentControl,
    configuredProtocolVersion: null,
  };
  const sourceFingerprint = sha256Hex(
    canonicalJson({
      documentControl: fingerprintedControl,
      statement: {
        externalEntryIds: [...statementEntryIds].sort(compareCodeUnits),
        pendingTotalCo2eRemovedKg: statementTotal,
      },
      remoteEntries: entries,
    }),
  );

  return {
    modelVersion: GHG_STATEMENT_REPORT_MODEL_VERSION,
    reportVersion: input.reportVersion,
    preparedAt: input.preparedAt,
    documentControl: input.documentControl,
    entries,
    totals: {
      netRemovedKg,
      netRemovedWithoutDiscountKg,
      uncertaintyDiscountKg:
        netRemovedWithoutDiscountKg - netRemovedKg,
      supplierCreditKg: optionalSum(
        entries,
        (entry) => entry.supplierCreditKg,
      ),
      bufferPoolKg: optionalSum(entries, (entry) => entry.bufferPoolKg),
    },
    sourceFingerprint,
  };
}
