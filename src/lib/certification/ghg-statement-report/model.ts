import { createHash } from "node:crypto";

export const GHG_STATEMENT_REPORT_MODEL_VERSION = 4;

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
  ghgStatementId?: string | null;
}

export interface BuildGhgStatementReportModelInput {
  reportVersion: number;
  preparedAt: string;
  documentControl: GhgStatementReportDocumentControl;
  authoritativeStatement: {
    externalEntryIds: string[];
    pendingTotalCo2eRemovedKg: number;
    creditAllocation: {
      supplierCreditKg: number;
      bufferPoolKg: number;
    } | null;
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
}

export interface GhgStatementReportModel {
  modelVersion: number;
  reportVersion: number;
  preparedAt: string;
  documentControl: GhgStatementReportDocumentControl;
  entries: GhgStatementReportEntry[];
  totals: {
    /** Isometric's authoritative statement-level total at issuance precision. */
    statementNetRemovedKg: number;
    /** Sum of the statement's higher-precision live GHG Entry net values. */
    entryNetRemovedKg: number;
    entryNetRemovedWithoutDiscountKg: number;
    entryUncertaintyDiscountKg: number;
    /** Isometric's authoritative statement-level credit allocation. */
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

export function buildGhgStatementReportModel(
  input: BuildGhgStatementReportModelInput,
): GhgStatementReportModel {
  // The renderer stamps this timestamp into the PDF metadata and prints it on
  // the page. An unparseable value would put two different preparation times
  // into one checksummed artifact, so the model is rejected instead.
  if (Number.isNaN(new Date(input.preparedAt).getTime())) {
    throw new GhgStatementReportReconciliationError(
      "Report preparation timestamp is malformed.",
    );
  }
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
      };
    });

  const entryNetRemovedKg = entries.reduce(
    (total, entry) => total + entry.netRemovedKg,
    0,
  );
  const statementTotal = finite(
    "GHG Statement pending total",
    input.authoritativeStatement.pendingTotalCo2eRemovedKg,
  );
  // Isometric can quantize the statement total to issuable-credit precision
  // while its GHG Entries retain a higher-precision net-removal result. Keep
  // both registry facts in the report fingerprint without requiring equality.
  const entryNetRemovedWithoutDiscountKg = entries.reduce(
    (total, entry) => total + entry.netRemovedWithoutDiscountKg,
    0,
  );
  const creditAllocation = input.authoritativeStatement.creditAllocation;
  if (creditAllocation !== null) {
    finite("GHG Statement supplier allocation", creditAllocation.supplierCreditKg);
    finite("GHG Statement buffer pool", creditAllocation.bufferPoolKg);
  }
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
        creditAllocation,
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
      statementNetRemovedKg: statementTotal,
      entryNetRemovedKg,
      entryNetRemovedWithoutDiscountKg,
      entryUncertaintyDiscountKg:
        entryNetRemovedWithoutDiscountKg - entryNetRemovedKg,
      supplierCreditKg: creditAllocation?.supplierCreditKg ?? null,
      bufferPoolKg: creditAllocation?.bufferPoolKg ?? null,
    },
    sourceFingerprint,
  };
}
