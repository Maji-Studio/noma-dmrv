/**
 * GhgStatementTechnicalDetails — the debug pane of the GHG statement detail
 * sheet: raw identifiers, ledger and registry state, and the derived submit
 * mode, plus the raw registry response and the persisted submission metadata
 * overlay as JSON. Operator-facing surfaces stay curated; this accordion is
 * where an admin checks what the system actually knows when the curated view
 * looks wrong. Values render literally (`null` stays "null") on purpose.
 */
"use client";

import type { ReactNode } from "react";
import type { CertificationSubmissionRow } from "@/data-access/certification";
import type { CertifierGhgStatementRow } from "@/data-access/certifier-ghg-statements";
import type { GhgStatementReportView } from "@/fn/certification/ghg-statement-reports";
import type { GhgStatement } from "@/lib/isometric";
import type { GhgSubmitMode } from "@/lib/isometric/utils/ghg-statement-state";
import { DisclosureSummary } from "./disclosure-summary";

interface GhgStatementTechnicalDetailsProps {
  statement: CertifierGhgStatementRow;
  statementSubmission: CertificationSubmissionRow | null;
  remote: GhgStatement | null;
  isLockedInFlight: boolean;
  mode: GhgSubmitMode;
  latestReport: GhgStatementReportView | null;
}

function Row({ label, value }: { label: string; value: ReactNode }) {
  return (
    <div className="flex items-start justify-between gap-12 border-t border-[var(--color-border-tertiary)] py-6 first:border-t-0">
      <dt className="body-caption shrink-0 text-[var(--color-text-tertiary)]">
        {label}
      </dt>
      <dd className="body-caption min-w-0 break-all text-right font-mono text-[var(--color-text-primary)]">
        {value}
      </dd>
    </div>
  );
}

function JsonBlock({ label, value }: { label: string; value: unknown }) {
  return (
    <details className="group">
      <DisclosureSummary>{label}</DisclosureSummary>
      <pre className="mt-6 overflow-x-auto border border-[var(--color-border-tertiary)] bg-[var(--color-background-light)] p-8 body-caption font-mono text-[var(--color-text-secondary)]">
        {JSON.stringify(value, null, 2)}
      </pre>
    </details>
  );
}

const literal = (value: string | number | boolean | null | undefined): string =>
  value === undefined ? "undefined" : value === null ? "null" : String(value);

export function GhgStatementTechnicalDetails({
  statement,
  statementSubmission,
  remote,
  isLockedInFlight,
  mode,
  latestReport,
}: GhgStatementTechnicalDetailsProps) {
  return (
    <div className="flex flex-col gap-12">
      <dl className="flex flex-col">
        <Row label="Statement ID" value={statement.id} />
        <Row label="Facility ID" value={statement.facilityId} />
        <Row
          label="Submission ID"
          value={literal(statementSubmission?.id ?? null)}
        />
        <Row
          label="Registry ID"
          value={
            statementSubmission?.externalId
              ? `${statementSubmission.externalId} · v${literal(statementSubmission.version)}`
              : "null"
          }
        />
        <Row label="Submit mode" value={mode} />
        <Row label="Locked in flight" value={literal(isLockedInFlight)} />
        <Row
          label="Period end (local)"
          value={statement.reportingPeriodEndOn}
        />
        <Row
          label="Period start (reconciled)"
          value={literal(statement.reportingPeriodStartOn)}
        />
        <Row label="Remote status" value={literal(remote?.status ?? null)} />
        <Row
          label="Remote period"
          value={
            remote
              ? `${literal(remote.reporting_period_start_at)} to ${literal(remote.reporting_period_end_at)}`
              : "null"
          }
        />
        <Row
          label="GHG Entry IDs"
          value={
            remote
              ? remote.ghg_entry_ids.length > 0
                ? remote.ghg_entry_ids.join(", ")
                : "[]"
              : "null"
          }
        />
        <Row
          label="Pending CO₂e (kg)"
          value={literal(remote?.pending_total_co2e_removed_kg ?? null)}
        />
        <Row
          label="Latest report"
          value={
            latestReport
              ? `v${latestReport.version} · ${latestReport.lifecycle}`
              : "null"
          }
        />
        {latestReport && (
          <Row
            label="Report fingerprint"
            value={latestReport.sourceFingerprint}
          />
        )}
        {latestReport && (
          <Row
            label="Report checksum"
            value={latestReport.contentChecksumSha256}
          />
        )}
      </dl>

      <JsonBlock label="Raw registry statement" value={remote} />
      <JsonBlock
        label="Submission metadata"
        value={statementSubmission?.metadata ?? null}
      />
    </div>
  );
}
