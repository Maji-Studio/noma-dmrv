/**
 * GhgStatementWorkflow — the sequential state of one GHG Statement, rendered
 * with the same CheckRow idiom the Removal confirm step uses so both
 * certification surfaces read identically:
 *
 *   1. Created in registry   — registry record link when present
 *   2. Report generated      — Generate/regenerate inside the submit dialog
 *   3. Report approved       — Review + Approve inside the submit dialog
 *   4. Submitted to verifier — status detail + inline Submit/Resubmit action
 *                              (opens the sheet's submit dialog)
 *
 * The detail sheet renders this as a passive status ladder with one Submit
 * entry point. The submit dialog renders it interactively so every report
 * action stays in one guided flow. Older versions collapse behind a disclosure.
 */
"use client";

import type { ReactNode } from "react";
import { useState } from "react";
import { Button, buttonVariants } from "@/components/ui";
import { StatusBadge } from "@/components/ui/status-badge";
import { ServerError } from "@/components/forms";
import {
  useApproveGhgStatementReport,
  usePrepareGhgStatementReport,
  useGhgStatementReports,
} from "@/hooks/use-certification";
import type { GhgStatementReportView } from "@/fn/certification/ghg-statement-reports";
import { CheckRow } from "./check-row";
import { DisclosureSummary } from "./disclosure-summary";
import type { WorkflowStepModel } from "./ghg-statement-workflow-state";

type ReportsQuery = ReturnType<typeof useGhgStatementReports>;
interface GhgStatementWorkflowProps {
  ghgStatementId: string;
  reportsQuery: ReportsQuery;
  /** The statement exists in Isometric (has a registry submission). */
  created: boolean;
  /** Registry record link node, shown as the created step's detail. */
  registryRecord?: ReactNode;
  /** Server-computed Owner/Admin capability for report mutations. */
  canManageReports: boolean;
  canGenerate?: boolean;
  generationUnavailableReason?: string | null;
  /** Enables Generate, Review, and Approve inside the submit dialog. */
  interactive?: boolean;
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

export function findApprovedGhgStatementReport(
  reports: GhgStatementReportView[],
): GhgStatementReportView | undefined {
  const latest = reports[0];
  return latest?.lifecycle === "approved" || latest?.lifecycle === "submitted"
    ? latest
    : undefined;
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
  canManageReports,
  canGenerate = true,
  generationUnavailableReason,
  interactive = false,
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
  const [reviewedReportId, setReviewedReportId] = useState<string | null>(null);

  const reports = reportsQuery.data ?? [];
  const latest: GhgStatementReportView | undefined = reports[0];
  const generated = reports.length > 0;
  const reportsUnavailable = Boolean(reportsQuery.error) && !generated;
  const reportsRefreshFailed = Boolean(reportsQuery.error) && generated;
  const approvedReport = findApprovedGhgStatementReport(reports);
  const latestPrepared = latest?.lifecycle === "prepared";

  const runGenerate = async () => {
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

  const generateReport = () => {
    setError(null);
    void runGenerate();
  };

  if (reportsQuery.isLoading) {
    return (
      <p aria-busy="true" className="body-small text-[var(--color-text-tertiary)]">
        Loading workflow…
      </p>
    );
  }
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
    : reportsUnavailable
      ? {
          status: "warning",
          detail: "Reports could not be loaded. Refresh the page and try again.",
        }
      : generated
      ? { status: "met", detail: `Version ${latest?.version} generated from Isometric data.` }
      : canGenerate
        ? {
            status: "active",
            detail: prepare.isPending
              ? "Generating a report from current Isometric data."
              : "Generate a report from current Isometric data.",
          }
        : {
            status: "warning",
            detail:
              generationUnavailableReason ??
              "A live GHG Statement with entries is required.",
          };

  const approvedStep: WorkflowStepModel = reportsUnavailable
    ? {
        status: "skipped",
        detail: "Load the reports before reviewing or approving one.",
      }
    : !generated
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
          {interactive &&
            created &&
            !reportsUnavailable &&
            canGenerate &&
            canManageReports && (
            <Button
              size="small"
              variant={generated ? "default" : "primary"}
              className="shrink-0 self-center"
              busy={prepare.isPending}
              onClick={generateReport}
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
                className={
                  interactive
                    ? buttonVariants({ variant: "default", size: "small" })
                    : "body-caption font-medium text-[var(--color-interaction)] underline-offset-2 hover:underline"
                }
                onClick={() => setReviewedReportId(latest.id)}
              >
                {interactive ? "Review report" : "Review"}
              </a>
              {interactive && latestPrepared && canManageReports && (
                <Button
                  size="small"
                  variant="primary"
                  busy={approve.isPending}
                  disabled={reviewedReportId !== latest.id}
                  onClick={() => void approveLatest()}
                >
                  Approve report
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

      {reportsQuery.error && (
        <div
          className="flex flex-wrap items-center justify-between gap-8 border border-[var(--color-border-secondary)] p-12"
          role="status"
        >
          <span className="body-caption text-[var(--color-text-secondary)]">
            {reportsRefreshFailed
              ? "Reports could not be refreshed. Showing the last loaded versions."
              : "Reports could not be loaded."}
          </span>
          <Button
            size="small"
            variant="default"
            busy={reportsQuery.isFetching}
            onClick={() => void reportsQuery.refetch()}
          >
            Retry
          </Button>
        </div>
      )}

      {error && <ServerError message={error} />}

      {reports.length > 1 && (
        <details className="group">
          <DisclosureSummary>
            All report versions ({reports.length})
          </DisclosureSummary>
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
