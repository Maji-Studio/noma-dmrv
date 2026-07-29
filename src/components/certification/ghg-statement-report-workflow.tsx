"use client";

import { useState } from "react";
import { FormField, FormTextarea, ServerError } from "@/components/forms";
import { Button, Modal } from "@/components/ui";
import { StatusBadge } from "@/components/ui/status-badge";
import {
  useApproveGhgStatementReport,
  usePrepareGhgStatementReport,
  useGhgStatementReports,
} from "@/hooks/use-certification";
import type { GhgStatementReportNarratives } from "@/lib/certification/ghg-statement-report/model";

type ReportsQuery = ReturnType<typeof useGhgStatementReports>;

const EMPTY_NARRATIVES: GhgStatementReportNarratives = {
  systemBoundaryAndMethodology: "",
  evidenceIndex: "",
  uncertaintyAndSensitivity: "",
  dataQualityAndExceptions: "",
  monitoringAndDurability: "",
  approvalStatement: "",
};

const NARRATIVE_FIELDS: Array<{
  key: keyof GhgStatementReportNarratives;
  label: string;
  helper: string;
}> = [
  {
    key: "systemBoundaryAndMethodology",
    label: "System boundary and methodology",
    helper:
      "Describe the reviewed boundary, including energy and transport, and the methodology applied.",
  },
  {
    key: "evidenceIndex",
    label: "Evidence and Source index review",
    helper:
      "Describe how you checked the frozen Source bindings. The PDF lists the exact Source IDs.",
  },
  {
    key: "uncertaintyAndSensitivity",
    label: "Uncertainty and sensitivity",
    helper: "Record the uncertainty and sensitivity checks you performed.",
  },
  {
    key: "dataQualityAndExceptions",
    label: "Data quality and exceptions",
    helper:
      "Record data-quality findings, exclusions, incidents, and reporting-period exceptions.",
  },
  {
    key: "monitoringAndDurability",
    label: "Monitoring and durability",
    helper: "Record the monitoring and durability evidence you reviewed.",
  },
  {
    key: "approvalStatement",
    label: "Review statement",
    helper:
      "State what you reviewed before this report can move to approval.",
  },
];

export function GhgStatementReportWorkflow({
  ghgStatementId,
  reportsQuery,
}: {
  ghgStatementId: string;
  reportsQuery: ReportsQuery;
}) {
  const prepare = usePrepareGhgStatementReport();
  const approve = useApproveGhgStatementReport();
  const [prepareOpen, setPrepareOpen] = useState(false);
  const [preparationKey, setPreparationKey] = useState(() =>
    crypto.randomUUID(),
  );
  const [narratives, setNarratives] =
    useState<GhgStatementReportNarratives>(EMPTY_NARRATIVES);
  const [acknowledged, setAcknowledged] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const openPrepare = () => {
    setNarratives(EMPTY_NARRATIVES);
    setAcknowledged(false);
    setError(null);
    prepare.reset();
    setPrepareOpen(true);
  };

  const submitPrepare = async () => {
    setError(null);
    try {
      await prepare.mutateAsync({
        ghgStatementId,
        preparationKey,
        narratives,
        humanReviewAcknowledged: acknowledged as true,
      });
      setPreparationKey(crypto.randomUUID());
      setPrepareOpen(false);
    } catch (prepareError) {
      setError(
        prepareError instanceof Error
          ? prepareError.message
          : "Report preparation failed.",
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
          <h3 className="body-medium font-medium">GHG Statement reports</h3>
          <p className="body-caption text-[var(--color-text-tertiary)]">
            Prepare, review, and approve an immutable report before submission.
          </p>
        </div>
        <Button size="small" variant="primary" onClick={openPrepare}>
          Prepare report
        </Button>
      </div>

      {error && <ServerError message={error} />}

      {reportsQuery.isLoading ? (
        <p className="body-small text-[var(--color-text-tertiary)]">
          Loading report versions...
        </p>
      ) : reportsQuery.error ? (
        <ServerError message="Unable to load report versions." />
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
                  Review or download
                </a>
                {report.lifecycle === "prepared" && (
                  <Button
                    size="small"
                    variant="default"
                    busy={approve.isPending}
                    onClick={() => approveVersion(report)}
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
          No report versions prepared yet.
        </p>
      )}

      <Modal
        isOpen={prepareOpen}
        onClose={() => setPrepareOpen(false)}
        ariaLabelledBy="ghg-report-prepare-title"
        width="lg"
        dismissOnClickOutside={false}
      >
        <div className="flex flex-col gap-20">
          <header>
            <h2 id="ghg-report-prepare-title" className="title-heading-3">
              Prepare GHG Statement report
            </h2>
            <p className="body-small text-[var(--color-text-secondary)]">
              Enter reviewed qualitative statements. Generated registry facts
              are frozen into a new report version.
            </p>
          </header>
          {NARRATIVE_FIELDS.map((field) => (
            <FormField
              key={field.key}
              id={field.key}
              label={field.label}
              helperText={field.helper}
              required
            >
              <FormTextarea
                id={field.key}
                value={narratives[field.key]}
                onChange={(event) =>
                  setNarratives({
                    ...narratives,
                    [field.key]: event.target.value,
                  })
                }
              />
            </FormField>
          ))}
          <label className="flex items-start gap-8 body-small">
            <input
              type="checkbox"
              checked={acknowledged}
              onChange={(event) => setAcknowledged(event.target.checked)}
              className="mt-2 size-16"
            />
            I reviewed the generated facts and these qualitative statements.
          </label>
          {error && <ServerError message={error} />}
          <div className="flex justify-end gap-12">
            <Button
              type="button"
              variant="default"
              onClick={() => setPrepareOpen(false)}
              disabled={prepare.isPending}
            >
              Cancel
            </Button>
            <Button
              type="button"
              variant="primary"
              busy={prepare.isPending}
              disabled={!acknowledged}
              onClick={submitPrepare}
            >
              Prepare report
            </Button>
          </div>
        </div>
      </Modal>
    </section>
  );
}
