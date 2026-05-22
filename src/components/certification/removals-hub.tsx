/**
 * RemovalsHub — the Isometric Certify Removals management page
 * (route: /certification). A Removal is the submission unit: N credit
 * batches map into one Removal (ADR 0003). Lists every removal for the
 * selected facility with its member credit batches and status, lets the
 * user group ungrouped batches into removals, and submits a removal.
 */
"use client";

import { ArrowsClockwise } from "@phosphor-icons/react";
import { useState } from "react";
import { Button } from "@/components/ui";
import { useToast } from "@/components/ui/toast";
import { useFacilityContext } from "@/hooks/use-facility-context";
import {
  useAssignCreditBatchToRemoval,
  useEnsureRemovalForCreditBatch,
  useRemovalsForFacility,
  useSubmitRemoval,
} from "@/hooks/use-certification";
import type {
  RemovalHubEntry,
  MemberCreditBatch,
} from "@/fn/certification/certify-context";
import { isLockedInFlight } from "@/lib/isometric/utils/lock";
import { SubmissionStatusBadge } from "./submission-status-badge";
import { SubmitConfirmDialog } from "./submit-confirm-dialog";

const ICON_SIZE = 14;
const NEW_REMOVAL = "__new__";

export function RemovalsHub() {
  const { facilityId } = useFacilityContext();

  return (
    <div className="flex flex-col gap-24 p-24">
      <header className="flex flex-col gap-4">
        <span className="title-chapter-title text-[var(--color-text-tertiary)]">
          Isometric Certify
        </span>
        <h1 className="title-heading-2">Removals</h1>
        <p className="body-medium text-[var(--color-text-secondary)]">
          A Removal is the Isometric submission unit. One credit batch maps to
          one Removal by default; group several into one when they share a
          reporting period.
        </p>
      </header>

      {!facilityId ? (
        <p className="body-medium text-[var(--color-text-tertiary)]">
          Select a facility to view its removals.
        </p>
      ) : (
        <HubBody facilityId={facilityId} />
      )}
    </div>
  );
}

function HubBody({ facilityId }: { facilityId: string }) {
  const query = useRemovalsForFacility(facilityId);

  if (query.isLoading) {
    return (
      <p className="body-medium text-[var(--color-text-tertiary)]">
        Loading removals…
      </p>
    );
  }
  if (query.error || !query.data) {
    return (
      <p className="body-medium text-[var(--clr-red)]">
        Unable to load removals. Try refreshing the page.
      </p>
    );
  }

  const { removals, ungroupedBatches, isProduction } = query.data;

  return (
    <div className="flex flex-col gap-32">
      <section className="flex flex-col gap-16">
        <h2 className="title-heading-3">
          Removals{" "}
          <span className="body-small text-[var(--color-text-tertiary)]">
            ({removals.length})
          </span>
        </h2>
        {removals.length === 0 ? (
          <p className="body-medium text-[var(--color-text-tertiary)]">
            No removals yet. Group a credit batch below to create one.
          </p>
        ) : (
          <div className="flex flex-col gap-16">
            {removals.map((entry) => (
              <RemovalCard
                key={entry.removal.id}
                entry={entry}
                isProduction={isProduction}
              />
            ))}
          </div>
        )}
      </section>

      <UngroupedSection
        batches={ungroupedBatches}
        removals={removals}
      />
    </div>
  );
}

function RemovalCard({
  entry,
  isProduction,
}: {
  entry: RemovalHubEntry;
  isProduction: boolean;
}) {
  const { removal, memberBatches, latestSubmission } = entry;
  const submitMutation = useSubmitRemoval();
  const toast = useToast();
  const [confirmOpen, setConfirmOpen] = useState(false);

  const lockedInFlight = latestSubmission
    ? isLockedInFlight(latestSubmission)
    : false;
  const submitDisabled = lockedInFlight || submitMutation.isPending;
  const buttonLabel = (() => {
    if (submitMutation.isPending) return "Submitting…";
    if (lockedInFlight) return "In progress";
    return latestSubmission?.externalId ? "Resubmit" : "Submit";
  })();

  const fireSubmit = (confirmProduction = false) => {
    submitMutation.mutate(
      { removalId: removal.id, confirmProduction },
      {
        onSuccess: (result) =>
          toast.success(`Submitted Removal ${result.externalId}.`),
        onError: (err) =>
          toast.error(
            `Submission failed: ${
              err instanceof Error ? err.message : String(err)
            }`,
          ),
      },
    );
  };

  // Production writes go through an explicit confirmation, matching the
  // credit-batch side-sheet — without it the server rejects every
  // production submit for a missing confirmProduction flag.
  const handleClick = () => {
    if (isProduction) {
      setConfirmOpen(true);
      return;
    }
    fireSubmit();
  };

  const headingId = `removal-${removal.id}`;

  return (
    <article
      aria-labelledby={headingId}
      className="flex flex-col gap-12 border border-[var(--color-border-secondary)] bg-[var(--color-background-white)] p-20"
    >
      <div className="flex items-start justify-between gap-12">
        <div className="flex flex-col gap-2 min-w-0">
          <span className="body-caption uppercase tracking-wide text-[var(--color-text-tertiary)]">
            Removal
          </span>
          <span
            id={headingId}
            className="body-small font-mono text-[var(--color-text-secondary)] truncate"
          >
            {removal.id}
          </span>
          <span className="body-caption text-[var(--color-text-tertiary)]">
            {removal.startedOn && removal.completedOn
              ? `${removal.startedOn} → ${removal.completedOn}`
              : "Reporting window set on submit"}
          </span>
        </div>
        <SubmissionStatusBadge
          latest={latestSubmission}
          isLockedInFlight={lockedInFlight}
        />
      </div>

      <div className="flex flex-col gap-4">
        <span className="body-caption uppercase tracking-wide text-[var(--color-text-tertiary)]">
          Credit batches ({memberBatches.length})
        </span>
        <span className="body-small font-mono text-[var(--color-text-secondary)]">
          {memberBatches.map((b) => b.code).join(", ") || "—"}
        </span>
      </div>

      {latestSubmission?.externalId && (
        <span className="body-caption font-mono text-[var(--color-text-tertiary)] truncate">
          {latestSubmission.externalId} · v{latestSubmission.version}
        </span>
      )}

      <div className="flex items-center justify-end gap-8 border-t border-[var(--color-border-tertiary)] pt-12">
        <Button
          variant="primary"
          size="small"
          onClick={handleClick}
          disabled={submitDisabled}
        >
          {!lockedInFlight && submitMutation.isPending && (
            <ArrowsClockwise size={ICON_SIZE} className="animate-spin" />
          )}
          {buttonLabel}
        </Button>
      </div>

      <SubmitConfirmDialog
        isOpen={confirmOpen}
        onClose={() => setConfirmOpen(false)}
        onConfirm={() => {
          setConfirmOpen(false);
          fireSubmit(true);
        }}
        isPending={submitMutation.isPending}
        artifact="removal"
        isProduction={isProduction}
      />
    </article>
  );
}

function UngroupedSection({
  batches,
  removals,
}: {
  batches: MemberCreditBatch[];
  removals: RemovalHubEntry[];
}) {
  return (
    <section className="flex flex-col gap-16">
      <h2 className="title-heading-3">
        Ungrouped credit batches{" "}
        <span className="body-small text-[var(--color-text-tertiary)]">
          ({batches.length})
        </span>
      </h2>
      {batches.length === 0 ? (
        <p className="body-medium text-[var(--color-text-tertiary)]">
          Every credit batch in this facility is assigned to a removal.
        </p>
      ) : (
        <div className="flex flex-col gap-8">
          {batches.map((batch) => (
            <UngroupedBatchRow
              key={batch.id}
              batch={batch}
              removals={removals}
            />
          ))}
        </div>
      )}
    </section>
  );
}

function UngroupedBatchRow({
  batch,
  removals,
}: {
  batch: MemberCreditBatch;
  removals: RemovalHubEntry[];
}) {
  const ensureMutation = useEnsureRemovalForCreditBatch();
  const assignMutation = useAssignCreditBatchToRemoval();
  const toast = useToast();
  const [choice, setChoice] = useState("");

  const isPending = ensureMutation.isPending || assignMutation.isPending;

  const apply = (value: string) => {
    if (!value) return;
    if (value === NEW_REMOVAL) {
      ensureMutation.mutate(batch.id, {
        onSuccess: () =>
          toast.success(`Started a removal for ${batch.code}.`),
        onError: (err) =>
          toast.error(
            err instanceof Error ? err.message : "Could not start removal.",
          ),
      });
      return;
    }
    assignMutation.mutate(
      { creditBatchId: batch.id, removalId: value },
      {
        onSuccess: () =>
          toast.success(`Added ${batch.code} to the removal.`),
        onError: (err) =>
          toast.error(
            err instanceof Error ? err.message : "Could not group batch.",
          ),
      },
    );
  };

  return (
    <div className="flex items-center justify-between gap-12 border border-[var(--color-border-secondary)] bg-[var(--color-background-white)] px-16 py-12">
      <span className="body-small font-mono">{batch.code}</span>
      <div className="flex items-center gap-8">
        {isPending && (
          <ArrowsClockwise
            size={ICON_SIZE}
            className="animate-spin text-[var(--color-text-tertiary)]"
          />
        )}
        <select
          aria-label={`Group credit batch ${batch.code} into a removal`}
          className="body-small border border-[var(--color-border-primary)] bg-[var(--color-background-white)] px-12 py-8"
          value={choice}
          disabled={isPending}
          onChange={(e) => {
            const value = e.target.value;
            setChoice("");
            apply(value);
          }}
        >
          <option value="">Group into…</option>
          <option value={NEW_REMOVAL}>＋ New removal</option>
          {removals.map((entry) => (
            <option key={entry.removal.id} value={entry.removal.id}>
              Removal {entry.removal.id.slice(0, 8)}… (
              {entry.memberBatches.length})
            </option>
          ))}
        </select>
      </div>
    </div>
  );
}
