/**
 * GhgStatementDetailSheet — the read-only quick view for a GHG Statement,
 * aligned with the Removal detail sheet: status first, the carbon headline at
 * a glance, then the four-step workflow (create → generate → approve →
 * submit). Secondary context (linked Removals, submission history) collapses
 * into accordions so the operator only scans what the current task needs.
 * Isometric owns statement membership (ADR 0004), so the Removals list stays
 * read-only.
 */
"use client";

import { useState } from "react";
import { ArrowsClockwiseIcon } from "@phosphor-icons/react/dist/ssr";
import { Button } from "@/components/ui";
import { Accordion } from "@/components/ui/accordion";
import { SlideOverPanel } from "@/components/ui/slide-over-panel";
import { StatusBadge } from "@/components/ui/status-badge";
import { useToast } from "@/components/ui/toast";
import {
  useGhgStatementReports,
  useGhgStatementBreakdown,
  useGhgStatementState,
  useRefreshGhgStatementStatus,
} from "@/hooks/use-certification";
import type { GhgStatementListItem } from "@/fn/certification/ghg-statements";
import { deriveSubmissionStatus } from "@/lib/certification/from-submission";
import type { GhgStatement } from "@/lib/isometric";
import { chooseGhgSubmitMode } from "@/lib/isometric/utils/ghg-statement-state";
import { isLockedInFlight } from "@/lib/isometric/utils/lock";
import { formatDate, formatDateRange } from "@/lib/format-utils";
import { EnvBanner } from "./env-banner";
import { GhgStatementCarbonBreakdown } from "./ghg-statement-carbon-breakdown";
import {
  findApprovedGhgStatementReport,
  GhgStatementWorkflow,
  type WorkflowStepModel,
} from "./ghg-statement-workflow";
import { GhgStatementSubmitDialog } from "./ghg-statement-submit-dialog";
import { GhgStatementTechnicalDetails } from "./ghg-statement-technical-details";
import { RegistryRecordLink } from "./registry-record-link";
import { RemovalBatchesAccordion } from "./removal-batches-accordion";
import { SubmissionStatusBadge } from "./submission-status-badge";
import { SyncEventList } from "./sync-event-log";

const ICON_SIZE = 14;
const SHORT_ID = 8;

const ACCORDION_ITEM =
  "rounded-none border-[var(--color-border-secondary)] bg-[var(--color-background-white)]";
const ACCORDION_TRIGGER =
  "bg-[var(--color-background-white)] px-16 py-12 hover:bg-[var(--color-surface-light)]";
const ACCORDION_LABEL =
  "body-small normal-case tracking-normal text-[var(--color-text-primary)]";

interface GhgStatementDetailSheetProps {
  item: GhgStatementListItem;
  isProduction: boolean;
  canManageReports: boolean;
  open: boolean;
  onClose: () => void;
}

function statementPeriod(item: GhgStatementListItem): string {
  if (item.remotePeriodMissing) return "No period set";
  const { reportingPeriodStartOn } = item.statement;
  const reportingPeriodEndOn = item.effectiveReportingPeriodEndOn;
  return reportingPeriodStartOn
    ? formatDateRange(reportingPeriodStartOn, reportingPeriodEndOn)
    : `Ends ${formatDate(reportingPeriodEndOn)}`;
}

/**
 * The verifier step of the workflow, derived from the live registry statement.
 * The former dangling "blocked" note now lives here, next to the step it
 * explains.
 */
function deriveVerifierStep(
  remote: GhgStatement | null,
  remoteUnavailable: boolean,
  hasMembership: boolean,
  hasApprovedReport: boolean,
): WorkflowStepModel {
  if (!remote) {
    return remoteUnavailable
      ? {
          status: "warning",
          detail:
            "Live Isometric statement data is unavailable. Refresh and try again.",
        }
      : { status: "skipped" };
  }
  switch (remote.status) {
    case "AWAITING_VERIFICATION":
      return { status: "met", detail: "In verification. No action is needed." };
    case "VERIFIED":
      return chooseGhgSubmitMode(remote) === "resubmit"
        ? {
            status: "warning",
            detail:
              "Verified with pending changes. Resubmit to update the verifier.",
          }
        : { status: "met", detail: "Verified." };
    case "CREDITS_ISSUED":
      return { status: "met", detail: "Credits issued." };
    case "FAILED_VERIFICATION":
      return {
        status: "warning",
        detail: "Verification failed. Update the Removals, then resubmit.",
      };
    default:
      if (!hasMembership) {
        return {
          status: "warning",
          detail: "No GHG Entries are available to submit.",
        };
      }
      return hasApprovedReport
        ? {
            status: "active",
            detail: "Submit the approved report to the verifier.",
          }
        : { status: "skipped" };
  }
}

export function GhgStatementDetailSheet({
  item,
  isProduction,
  canManageReports,
  open,
  onClose,
}: GhgStatementDetailSheetProps) {
  const period = statementPeriod(item);

  return (
    <SlideOverPanel.Root open={open} onOpenChange={(next) => !next && onClose()}>
      <SlideOverPanel.Content size="default">
        <SlideOverPanel.Header showClose>
          <SlideOverPanel.Title>GHG Statement</SlideOverPanel.Title>
          <SlideOverPanel.Description>{period}</SlideOverPanel.Description>
        </SlideOverPanel.Header>

        <DetailState
          item={item}
          isProduction={isProduction}
          canManageReports={canManageReports}
          open={open}
        />
      </SlideOverPanel.Content>
    </SlideOverPanel.Root>
  );
}

function DetailState({
  item,
  isProduction,
  canManageReports,
  open,
}: {
  item: GhgStatementListItem;
  isProduction: boolean;
  canManageReports: boolean;
  open: boolean;
}) {
  const { statement } = item;
  const query = useGhgStatementState(statement.id);
  const reportsQuery = useGhgStatementReports(statement.id);
  const breakdownQuery = useGhgStatementBreakdown(statement.id, open);
  const refreshMutation = useRefreshGhgStatementStatus();
  const toast = useToast();
  const [submitOpen, setSubmitOpen] = useState(false);

  if (query.isLoading) {
    return (
      <>
        <SlideOverPanel.Body>
          <p
            aria-busy="true"
            className="body-small text-[var(--color-text-tertiary)]"
          >
            Loading statement…
          </p>
        </SlideOverPanel.Body>
        <CloseFooter />
      </>
    );
  }

  if (query.error || !query.data) {
    return (
      <>
        <SlideOverPanel.Body>
          <p className="body-small text-[var(--clr-red)]" role="alert">
            Statement details could not be loaded. Refresh the page and try
            again.
          </p>
        </SlideOverPanel.Body>
        <CloseFooter />
      </>
    );
  }

  const { statementSubmission, linkedRemovals, remote, recentSyncEvents } =
    query.data;
  const locked = statementSubmission
    ? isLockedInFlight(statementSubmission)
    : false;
  const derived = deriveSubmissionStatus(
    statementSubmission,
    locked,
    "ghgStatement",
  );
  const mode = remote ? chooseGhgSubmitMode(remote) : "submit";
  const created = Boolean(statementSubmission?.externalId);
  const hasMembership = remote
    ? remote.ghg_entry_ids.length > 0
    : linkedRemovals.length > 0;
  const rollupReady =
    breakdownQuery.data?.status === "available" &&
    remote?.pending_total_co2e_removed_kg != null &&
    Number.isFinite(remote.pending_total_co2e_removed_kg);
  const canGenerate = Boolean(remote?.ghg_entry_ids.length) && rollupReady;
  const remoteUnavailable = created && remote === null;
  const generationUnavailableReason = canGenerate
    ? null
    : remoteUnavailable
      ? "Live Isometric statement data is unavailable. Refresh and try again."
      : remote?.ghg_entry_ids.length
        ? "Wait for Isometric to finish calculating the registry totals."
        : "Submit a Removal in this reporting period before generating a report.";
  const approvedReport = findApprovedGhgStatementReport(
    reportsQuery.data ?? [],
  );
  const reportManagementUnavailableReason = !canManageReports
    ? "An Owner or Admin generates and approves reports."
    : generationUnavailableReason;
  const verifierStep = deriveVerifierStep(
    remote,
    remoteUnavailable,
    hasMembership,
    Boolean(approvedReport),
  );
  const canSubmit =
    canManageReports &&
    created &&
    (mode === "submit" || mode === "resubmit") &&
    hasMembership;
  const isResubmit = mode === "resubmit";

  const handleRefresh = () => {
    if (!statementSubmission) return;
    refreshMutation.mutate(statementSubmission.id, {
      onSuccess: (result) => toast.success(`Status: ${result.status}.`),
      onError: (error) =>
        toast.error(
          error instanceof Error
            ? error.message
            : "The verifier status was not refreshed. Try again.",
        ),
    });
  };

  return (
    <>
      <SlideOverPanel.Body className="flex flex-col gap-24">
        <EnvBanner isProduction={isProduction} variant="inline" />

        <section
          aria-labelledby="ghg-statement-status"
          className="border-y border-[var(--color-border-secondary)] py-12"
        >
          <div className="flex items-center justify-between gap-12">
            <h3
              id="ghg-statement-status"
              className="body-caption uppercase tracking-wide text-[var(--color-text-tertiary)]"
            >
              Statement status
            </h3>
            <StatusBadge status={derived.value} label={derived.label} />
          </div>
        </section>

        <GhgStatementCarbonBreakdown query={breakdownQuery} />

        <section className="flex flex-col gap-8">
          <h3 className="body-caption uppercase tracking-wide text-[var(--color-text-tertiary)]">
            Workflow
          </h3>
          <GhgStatementWorkflow
            ghgStatementId={statement.id}
            reportsQuery={reportsQuery}
            created={created}
            canManageReports={canManageReports}
            registryRecord={
              statementSubmission?.externalId ? (
                <RegistryRecordLink
                  facilityId={statement.facilityId}
                  externalId={statementSubmission.externalId}
                  version={statementSubmission.version}
                  isProduction={isProduction}
                  kind="ghgStatement"
                />
              ) : undefined
            }
            canGenerate={canManageReports && canGenerate}
            autoGenerationReady={remote?.status === "DRAFT" && rollupReady}
            generationUnavailableReason={reportManagementUnavailableReason}
            verifierStep={verifierStep}
            onSubmit={canSubmit ? () => setSubmitOpen(true) : undefined}
            submitLabel={isResubmit ? "Resubmit" : "Submit"}
          />
        </section>

        <Accordion.Root className="gap-8" multiple>
          <Accordion.Item value="linked-removals" className={ACCORDION_ITEM}>
            <Accordion.Header>
              <Accordion.Trigger
                className={ACCORDION_TRIGGER}
                labelClassName={ACCORDION_LABEL}
              >
                <span className="flex w-full items-center justify-between gap-12">
                  <span>Linked Removals</span>
                  <span className="body-caption font-normal text-[var(--color-text-tertiary)]">
                    {linkedRemovals.length}
                  </span>
                </span>
              </Accordion.Trigger>
            </Accordion.Header>
            <Accordion.Panel className="[&>div]:p-12">
              {linkedRemovals.length === 0 ? (
                <p className="body-small text-[var(--color-text-tertiary)]">
                  No Removals linked yet.
                </p>
              ) : (
                <RemovalBatchesAccordion
                  facilityId={statement.facilityId}
                  entries={linkedRemovals.map(
                    ({ removal, submission, creditBatches }) => ({
                      removalId: removal.id,
                      label:
                        submission?.externalId ??
                        `${removal.id.slice(0, SHORT_ID)}…`,
                      completedOn: removal.completedOn,
                      creditBatches,
                      badge: (
                        <SubmissionStatusBadge
                          latest={submission}
                          isLockedInFlight={
                            submission ? isLockedInFlight(submission) : false
                          }
                        />
                      ),
                    }),
                  )}
                />
              )}
            </Accordion.Panel>
          </Accordion.Item>

          {recentSyncEvents.length > 0 && (
            <Accordion.Item
              value="submission-history"
              className={ACCORDION_ITEM}
            >
              <Accordion.Header>
                <Accordion.Trigger
                  className={ACCORDION_TRIGGER}
                  labelClassName={ACCORDION_LABEL}
                >
                  <span className="flex w-full items-center justify-between gap-12">
                    <span>Submission history</span>
                    <span className="body-caption font-normal text-[var(--color-text-tertiary)]">
                      {recentSyncEvents.length}
                    </span>
                  </span>
                </Accordion.Trigger>
              </Accordion.Header>
              <Accordion.Panel className="[&>div]:p-16">
                <SyncEventList events={recentSyncEvents} />
              </Accordion.Panel>
            </Accordion.Item>
          )}

          <Accordion.Item value="technical-details" className={ACCORDION_ITEM}>
            <Accordion.Header>
              <Accordion.Trigger
                className={ACCORDION_TRIGGER}
                labelClassName={ACCORDION_LABEL}
              >
                Technical details
              </Accordion.Trigger>
            </Accordion.Header>
            <Accordion.Panel className="[&>div]:p-16">
              <GhgStatementTechnicalDetails
                statement={statement}
                statementSubmission={statementSubmission}
                remote={remote}
                isLockedInFlight={locked}
                mode={mode}
                latestReport={reportsQuery.data?.[0] ?? null}
              />
            </Accordion.Panel>
          </Accordion.Item>
        </Accordion.Root>
      </SlideOverPanel.Body>

      <GhgStatementSubmitDialog
        ghgStatementId={statement.id}
        isOpen={submitOpen}
        onClose={() => setSubmitOpen(false)}
        isProduction={isProduction}
        isResubmit={isResubmit}
        approvedReportId={approvedReport?.id ?? null}
      />

      <SlideOverPanel.Footer className="justify-stretch">
        {statementSubmission && (
          <Button
            variant="default"
            className="flex-1"
            onClick={handleRefresh}
            busy={refreshMutation.isPending}
          >
            {!refreshMutation.isPending && (
              <ArrowsClockwiseIcon size={ICON_SIZE} />
            )}
            Refresh
          </Button>
        )}
        <SlideOverPanel.Close>
          <Button variant="primary" className="flex-1">
            Close
          </Button>
        </SlideOverPanel.Close>
      </SlideOverPanel.Footer>
    </>
  );
}

function CloseFooter() {
  return (
    <SlideOverPanel.Footer className="justify-stretch">
      <SlideOverPanel.Close>
        <Button variant="primary" className="flex-1">
          Close
        </Button>
      </SlideOverPanel.Close>
    </SlideOverPanel.Footer>
  );
}
