/**
 * GhgStatementWorkflow — the sequential state of one GHG Statement, rendered
 * with the same CheckRow idiom the Removal confirm step uses so both
 * certification surfaces read identically:
 *
 *   1. Created in registry   — registry record link when present
 *   2. Report generated      — inline Generate / Generate new version action
 *   3. Report approved       — Review link + inline Approve action
 *   4. Submitted to verifier — status detail + inline Submit/Resubmit action
 *                              (opens the sheet's submit dialog)
 *
 * The component owns the generate/approve mutations. The created and verifier
 * step models are computed by the detail sheet, which holds the remote
 * statement state. Older report versions collapse behind a disclosure.
 */
"use client";

import type { ReactNode } from "react";
import { useState } from "react";
import { CaretDownIcon } from "@phosphor-icons/react/dist/ssr";
import { Button } from "@/components/ui";
import { StatusBadge } from "@/components/ui/status-badge";
import { ServerError } from "@/components/forms";
import {
  useApproveGhgStatementReport,
  usePrepareGhgStatementReport,
  useGhgStatementReports,
} from "@/hooks/use-certification";
import type { GhgStatementReportView } from "@/fn/certification/ghg-statement-reports";
import { CheckRow, type CheckStatus } from "./check-row";

type ReportsQuery = ReturnType<typeof useGhgStatementReports>;

export interface WorkflowStepModel {
  status: CheckStatus;
  detail?: string;
}

interface GhgStatementWorkflowProps {
  ghgStatementId: string;
  reportsQuery: ReportsQuery;
  /** The statement exists in Isometric (has a registry submission). */
  created: boolean;
  /** Registry record link node, shown as the created step's detail. */
  registryRecord?: ReactNode;
  canGenerate?: boolean;
  generationUnavailableReason?: string | null;
  /** Computed by the sheet from the remote statement + submit mode. */
  verifierStep: WorkflowStepModel;
  /**
   * Opens the submit dialog. Present only while the statement is actually
   * submittable, so the final step carries its own action instead of pointing
   * at a detached footer button.
   */
  onSubmit?: () => void;
  submitLabel?: string;
}

function reportBadge(lifecycle: string): {
  status: "ready" | "complete" | "pending";
  label: string;
} {
  return {
    status:
      lifecycle === "approved"
        ? "ready"
        : lifecycle === "submitted"
          ? "complete"
          : "pending",
    label: lifecycle.charAt(0).toUpperCase() + lifecycle.slice(1),
  };
}

export function GhgStatementWorkflow({
  ghgStatementId,
  reportsQuery,
  created,
  registryRecord,
  canGenerate = true,
  generationUnavailableReason,
  verifierStep,
  onSubmit,
  submitLabel = "Submit",
}: GhgStatementWorkflowProps) {
  const prepare = usePrepareGhgStatementReport();
  const approve = useApproveGhgStatementReport();
  const [preparationKey, setPreparationKey] = useState(() =>
    crypto.randomUUID(),
  );
  const [error, setError] = useState<string | null>(null);

  if (reportsQuery.isLoading) {
    return (
      <p aria-busy="true" className="body-small text-[var(--color-text-tertiary)]">
        Loading workflow…
      </p>
    );
  }
  if (reportsQuery.error) {
    return (
      <ServerError message="Reports could not be loaded. Refresh the page and try again." />
    );
  }

  const reports = reportsQuery.data ?? [];
  const latest: GhgStatementReportView | undefined = reports[0];
  const generated = reports.length > 0;
  const approvedReport = reports.find(
    (report) =>
      report.lifecycle === "approved" || report.lifecycle === "submitted",
  );
  const latestPrepared = latest?.lifecycle === "prepared";

  const generateReport = async () => {
    setError(null);
    try {
      await prepare.mutateAsync({ ghgStatementId, preparationKey });
      setPreparationKey(crypto.randomUUID());
    } catch (prepareError) {
      setError(
        prepareError instanceof Error
          ? prepareError.message
          : "The report was not generated. Try again.",
      );
    }
  };

  const approveLatest = async () => {
    if (!latest) return;
    setError(null);
    try {
      await approve.mutateAsync({
        ghgStatementId,
        reportId: latest.id,
        version: latest.version,
      });
    } catch (approveError) {
      setError(
        approveError instanceof Error
          ? approveError.message
          : "The report was not approved. Try again.",
      );
    }
  };

  const generatedStep: WorkflowStepModel = !created
    ? { status: "skipped" }
    : generated
      ? { status: "met", detail: `Version ${latest?.version} generated from Isometric data.` }
      : canGenerate
        ? { status: "active", detail: "Generate a report from current Isometric data." }
        : {
            status: "warning",
            detail:
              generationUnavailableReason ??
              "A live GHG Statement with entries is required.",
          };

  const approvedStep: WorkflowStepModel = !generated
    ? { status: "skipped", detail: created ? "Review the report, then approve it." : undefined }
    : latestPrepared
      ? { status: "active", detail: `Review version ${latest?.version}, then approve it.` }
      : approvedReport
        ? { status: "met", detail: `Version ${approvedReport.version} approved.` }
        : { status: "skipped" };

  return (
    <div className="flex flex-col gap-8">
      <ol className="flex flex-col border border-[var(--color-border-secondary)] bg-[var(--color-background-white)]">
        <CheckRow
          isFirst
          status={created ? "met" : "warning"}
          label="Created in registry"
          detail={
            created
              ? registryRecord
              : "Not in Isometric yet. Sync from registry to reconcile it."
          }
        />
        <CheckRow
          isFirst={false}
          status={generatedStep.status}
          label="Report generated"
          detail={generatedStep.detail}
        >
          {created && canGenerate && (
            <Button
              size="small"
              variant={generated ? "default" : "primary"}
              className="shrink-0 self-center"
              busy={prepare.isPending}
              onClick={() => void generateReport()}
            >
              {generated ? "Generate new version" : "Generate report"}
            </Button>
          )}
        </CheckRow>
        <CheckRow
          isFirst={false}
          status={approvedStep.status}
          label="Report approved"
          detail={approvedStep.detail}
        >
          {latest && (
            <span className="flex shrink-0 items-center gap-12 self-center">
              <a
                href={latest.reviewUrl}
                target="_blank"
                rel="noreferrer"
                className="body-caption font-medium text-[var(--color-interaction)] underline-offset-2 hover:underline"
              >
                Review
              </a>
              {latestPrepared && (
                <Button
                  size="small"
                  variant="primary"
                  busy={approve.isPending}
                  onClick={() => void approveLatest()}
                >
                  Approve
                </Button>
              )}
            </span>
          )}
        </CheckRow>
        <CheckRow
          isFirst={false}
          status={verifierStep.status}
          label="Submitted to verifier"
          detail={verifierStep.detail}
        >
          {onSubmit && (
            <Button
              size="small"
              variant="primary"
              className="shrink-0 self-center"
              onClick={onSubmit}
            >
              {submitLabel}
            </Button>
          )}
        </CheckRow>
      </ol>

      {error && <ServerError message={error} />}

      {reports.length > 1 && (
        <details className="group">
          <summary className="flex cursor-pointer items-center gap-6 list-none [&::-webkit-details-marker]:hidden body-caption text-[var(--color-text-tertiary)] hover:text-[var(--color-text-secondary)]">
            <CaretDownIcon
              size={10}
              weight="bold"
              className="transition-transform duration-150 group-open:rotate-180"
            />
            <span className="underline underline-offset-2">
              All report versions ({reports.length})
            </span>
          </summary>
          <ol className="mt-8 flex flex-col border-l border-[var(--color-border-secondary)] pl-12">
            {reports.map((report) => {
              const badge = reportBadge(report.lifecycle);
              return (
                <li
                  key={report.id}
                  className="flex flex-wrap items-center justify-between gap-8 py-6"
                >
                  <span className="flex items-center gap-8">
                    <span className="body-caption text-[var(--color-text-primary)]">
                      Version {report.version}
                    </span>
                    <StatusBadge status={badge.status} label={badge.label} />
                  </span>
                  <a
                    href={report.reviewUrl}
                    target="_blank"
                    rel="noreferrer"
                    className="body-caption text-[var(--color-text-tertiary)] underline underline-offset-2 hover:text-[var(--color-text-secondary)]"
                  >
                    Review
                  </a>
                </li>
              );
            })}
          </ol>
        </details>
      )}
    </div>
  );
}
