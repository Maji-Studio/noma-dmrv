"use client";

import { useState } from "react";
import { Button } from "@/components/ui";
import { StatusBadge } from "@/components/ui/status-badge";
import { ServerError } from "@/components/forms";
import {
  useApproveGhgStatementReport,
  usePrepareGhgStatementReport,
  useGhgStatementReports,
} from "@/hooks/use-certification";

type ReportsQuery = ReturnType<typeof useGhgStatementReports>;

export function GhgStatementReportWorkflow({
  ghgStatementId,
  reportsQuery,
  canGenerate = true,
  generationUnavailableReason,
}: {
  ghgStatementId: string;
  reportsQuery: ReportsQuery;
  canGenerate?: boolean;
  generationUnavailableReason?: string | null;
}) {
  const prepare = usePrepareGhgStatementReport();
  const approve = useApproveGhgStatementReport();
  const [preparationKey, setPreparationKey] = useState(() =>
    crypto.randomUUID(),
  );
  const [error, setError] = useState<string | null>(null);
  const hasReports = Boolean(reportsQuery.data?.length);
  const latestVersion = reportsQuery.data?.[0]?.version;

  const generateReport = async () => {
    setError(null);
    try {
      await prepare.mutateAsync({ ghgStatementId, preparationKey });
      setPreparationKey(crypto.randomUUID());
    } catch (prepareError) {
      setError(
        prepareError instanceof Error
          ? prepareError.message
          : "Report generation failed.",
      );
    }
  };

  const approveVersion = async (report: {
    id: string;
    version: number;
  }) => {
    setError(null);
    try {
      await approve.mutateAsync({
        ghgStatementId,
        reportId: report.id,
        version: report.version,
      });
    } catch (approveError) {
      setError(
        approveError instanceof Error
          ? approveError.message
          : "Report approval failed.",
      );
    }
  };

  return (
    <section className="flex flex-col gap-12">
      <div className="flex items-center justify-between gap-12">
        <div>
          <h3 className="body-medium font-medium">Report</h3>
          <p className="body-caption text-[var(--color-text-tertiary)]">
            Generate from current Isometric data, then review before approval.
          </p>
        </div>
        <Button
          size="small"
          variant="primary"
          busy={prepare.isPending}
          disabled={!canGenerate}
          onClick={() => void generateReport()}
        >
          {hasReports ? "Generate new version" : "Generate report"}
        </Button>
      </div>

      {!canGenerate && (
        <p className="body-caption text-[var(--color-text-tertiary)]">
          {generationUnavailableReason ??
            "A live GHG Statement with entries is required."}
        </p>
      )}

      {error && <ServerError message={error} />}

      {reportsQuery.isLoading ? (
        <p
          aria-busy="true"
          className="body-small text-[var(--color-text-tertiary)]"
        >
          Loading reports…
        </p>
      ) : reportsQuery.error ? (
        <ServerError message="Unable to load reports." />
      ) : reportsQuery.data?.length ? (
        <div className="border border-[var(--color-border-secondary)]">
          {reportsQuery.data.map((report) => (
            <div
              key={report.id}
              className="flex flex-wrap items-center justify-between gap-12 border-b border-[var(--color-border-tertiary)] px-12 py-10 last:border-b-0"
            >
              <div className="flex items-center gap-8">
                <span className="body-small">Version {report.version}</span>
                <StatusBadge
                  status={
                    report.lifecycle === "approved"
                      ? "ready"
                      : report.lifecycle === "submitted"
                        ? "complete"
                        : "pending"
                  }
                  label={
                    report.lifecycle.charAt(0).toUpperCase() +
                    report.lifecycle.slice(1)
                  }
                />
              </div>
              <div className="flex items-center gap-8">
                <a
                  href={report.reviewUrl}
                  target="_blank"
                  rel="noreferrer"
                  className="label-button underline"
                >
                  Review
                </a>
                {report.lifecycle === "prepared" &&
                  report.version === latestVersion && (
                    <Button
                      size="small"
                      variant="default"
                      busy={approve.isPending}
                      onClick={() => void approveVersion(report)}
                    >
                      Approve
                    </Button>
                  )}
              </div>
            </div>
          ))}
        </div>
      ) : (
        <p className="body-small text-[var(--color-text-tertiary)]">
          No report generated yet.
        </p>
      )}
    </section>
  );
}
