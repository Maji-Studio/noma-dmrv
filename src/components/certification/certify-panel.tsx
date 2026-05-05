/**
 * CertifyPanel
 * Isometric Certify context inside the credit-batch side sheet — read-only
 * project + template + blueprints surface (Phase 2) plus the submit-to-Isometric
 * footer (Phase 3).
 */
"use client";

import { CaretDown } from "@phosphor-icons/react";
import { useState } from "react";
import { Button } from "@/components/ui";
import { useDialog } from "@/hooks/use-dialog";
import { useToast } from "@/components/ui/toast";
import {
  useCertifyContextForCreditBatch,
  useCreditBatchSubmissionState,
  useSubmitCreditBatch,
} from "@/hooks/use-certification";
import { BlueprintList } from "./blueprint-list";
import { Field, Section } from "./panel-layout";
import { SubmissionStatusBadge } from "./submission-status-badge";
import { SyncEventLog } from "./sync-event-log";

interface CertifyPanelProps {
  creditBatchId: string;
}

export function CertifyPanel({ creditBatchId }: CertifyPanelProps) {
  const { data, isLoading, error } =
    useCertifyContextForCreditBatch(creditBatchId);

  return (
    <Section>
      <details className="group">
        <summary className="flex cursor-pointer items-center justify-between gap-12 list-none [&::-webkit-details-marker]:hidden">
          <div className="flex flex-col gap-4">
            <h3 className="title-chapter-title">Isometric Certify</h3>
            <p className="body-caption text-[var(--color-text-tertiary)]">
              {data?.isProduction === true
                ? "Isometric · production"
                : data?.isProduction === false
                  ? "Isometric · sandbox"
                  : "Isometric"}
            </p>
          </div>
          <CaretDown
            size={18}
            weight="bold"
            className="shrink-0 text-[var(--color-text-tertiary)] transition-transform duration-150 group-open:rotate-180"
          />
        </summary>

        <div className="mt-16">
          <PanelBody
            creditBatchId={creditBatchId}
            data={data}
            isLoading={isLoading}
            error={error ?? null}
          />
        </div>
      </details>
    </Section>
  );
}

function PanelBody({
  creditBatchId,
  data,
  isLoading,
  error,
}: {
  creditBatchId: string;
  data: ReturnType<typeof useCertifyContextForCreditBatch>["data"];
  isLoading: boolean;
  error: Error | null;
}) {
  if (isLoading) {
    return (
      <p className="body-small text-[var(--color-text-tertiary)]">
        Loading certification context…
      </p>
    );
  }

  if (error || !data) {
    if (error) {
      console.error("CertifyPanel: failed to load context", error);
    }
    return (
      <p className="body-small text-[var(--color-signal-red)]">
        Unable to load certification information. Please try again.
      </p>
    );
  }

  const {
    mapping,
    project,
    defaultTemplate,
    missingDefaultTemplateId,
    blueprintsForTemplate,
    unresolvedBlueprintKeys,
    isProduction,
  } = data;

  if (!mapping) {
    return (
      <p className="body-small text-[var(--color-text-secondary)]">
        This facility isn&apos;t linked to an Isometric project. Open the
        facility settings to set up registry submission.
      </p>
    );
  }

  const projectLabel = project?.name ?? mapping.externalProjectId;
  const submitReady =
    !!defaultTemplate &&
    !missingDefaultTemplateId &&
    unresolvedBlueprintKeys.length === 0;

  return (
    <div className="flex flex-col gap-20">
      <dl className="grid grid-cols-2 gap-x-16 gap-y-12">
        <Field label="Project">
          <span className="body-small">{projectLabel}</span>
          <span className="body-caption text-[var(--color-text-tertiary)]">
            {mapping.externalProjectId}
          </span>
        </Field>
        <Field label="Default removal template">
          {defaultTemplate ? (
            <>
              <span className="body-small">
                {defaultTemplate.display_name}
              </span>
              <span className="body-caption text-[var(--color-text-tertiary)]">
                {defaultTemplate.id}
              </span>
            </>
          ) : missingDefaultTemplateId ? (
            <span className="body-small text-[var(--color-text-tertiary)]">
              {missingDefaultTemplateId}
            </span>
          ) : (
            <span className="body-small text-[var(--color-text-tertiary)]">
              Not set
            </span>
          )}
        </Field>
      </dl>

      {missingDefaultTemplateId && (
        <Warning>
          Default removal template{" "}
          <code className="font-mono">{missingDefaultTemplateId}</code> is no
          longer available in Certify for this project. Pick a new default in
          the facility&apos;s Isometric link.
        </Warning>
      )}

      {!defaultTemplate && !missingDefaultTemplateId && (
        <p className="body-small text-[var(--color-text-secondary)]">
          Default removal template not selected. Set one in the facility&apos;s
          Isometric link to enable submission previews.
        </p>
      )}

      {defaultTemplate && (
        <div className="flex flex-col gap-12">
          <h4 className="body-caption uppercase tracking-wide text-[var(--color-text-tertiary)]">
            Component blueprints required by this template
          </h4>
          {unresolvedBlueprintKeys.length > 0 && (
            <Warning>
              {unresolvedBlueprintKeys.length} blueprint
              {unresolvedBlueprintKeys.length === 1 ? "" : "s"} referenced by
              this template{" "}
              {unresolvedBlueprintKeys.length === 1 ? "is" : "are"} no longer
              in Certify&apos;s catalog:{" "}
              <code className="font-mono">
                {unresolvedBlueprintKeys.join(", ")}
              </code>
            </Warning>
          )}
          <BlueprintList blueprints={blueprintsForTemplate} />
        </div>
      )}

      {submitReady && (
        <SubmitFooter
          creditBatchId={creditBatchId}
          isProduction={isProduction}
        />
      )}
    </div>
  );
}

function SubmitFooter({
  creditBatchId,
  isProduction,
}: {
  creditBatchId: string;
  isProduction: boolean;
}) {
  const { data: state, isLoading } =
    useCreditBatchSubmissionState(creditBatchId);
  const submitMutation = useSubmitCreditBatch();
  const toast = useToast();
  const [confirmOpen, setConfirmOpen] = useState(false);

  if (isLoading || !state) {
    return (
      <div className="border-t border-[var(--color-border-secondary)] pt-16">
        <p className="body-small text-[var(--color-text-tertiary)]">
          Loading submission state…
        </p>
      </div>
    );
  }

  const { latest, recentSyncEvents, isLockedInFlight } = state;
  const submitDisabled = isLockedInFlight || submitMutation.isPending;

  const fireSubmit = () => {
    submitMutation.mutate(creditBatchId, {
      onSuccess: (data) => {
        toast.success(
          `Submitted to Isometric: Removal ${data.externalId} (v${data.version}).`,
        );
      },
      onError: (err) => {
        toast.error(
          `Submission failed: ${err instanceof Error ? err.message : String(err)}`,
        );
      },
    });
  };

  const handleClick = () => {
    if (isProduction) {
      setConfirmOpen(true);
      return;
    }
    fireSubmit();
  };

  return (
    <div className="border-t border-[var(--color-border-secondary)] pt-16 flex flex-col gap-16">
      <div className="flex items-center justify-between gap-12">
        <div className="flex flex-col gap-4">
          <span className="body-caption uppercase tracking-wide text-[var(--color-text-tertiary)]">
            Submission status
          </span>
          <SubmissionStatusBadge
            latest={latest}
            isLockedInFlight={isLockedInFlight}
          />
          {latest?.externalId && (
            <span className="body-caption text-[var(--color-text-tertiary)] font-mono">
              {latest.externalId} · v{latest.version}
            </span>
          )}
        </div>
        <Button
          variant="primary"
          size="default"
          onClick={handleClick}
          disabled={submitDisabled}
        >
          {submitMutation.isPending
            ? "Submitting…"
            : isLockedInFlight
              ? "In progress"
              : latest?.status === "submitted" || latest?.status === "accepted"
                ? "Resubmit"
                : "Submit to Isometric"}
        </Button>
      </div>

      <SyncEventLog events={recentSyncEvents} />

      <SubmitConfirmDialog
        isOpen={confirmOpen}
        onClose={() => setConfirmOpen(false)}
        onConfirm={() => {
          setConfirmOpen(false);
          fireSubmit();
        }}
        isPending={submitMutation.isPending}
      />
    </div>
  );
}

function SubmitConfirmDialog({
  isOpen,
  onClose,
  onConfirm,
  isPending,
}: {
  isOpen: boolean;
  onClose: () => void;
  onConfirm: () => void;
  isPending: boolean;
}) {
  const dialogRef = useDialog(isOpen, onClose);
  if (!isOpen) return null;
  return (
    <dialog
      ref={dialogRef}
      className="p-32 border border-[var(--color-border-primary)] backdrop:bg-black/50"
      aria-labelledby="submit-confirm-title"
    >
      <div className="flex flex-col gap-24 min-w-[360px]">
        <h2 id="submit-confirm-title" className="title-heading-3">
          Submit to production Isometric
        </h2>
        <p className="body-medium text-[var(--color-text-secondary)]">
          This creates a real Removal in the Isometric production environment.
          Confirm before continuing.
        </p>
        <div className="flex gap-16 justify-end">
          <Button
            size="large"
            variant="default"
            onClick={onClose}
            disabled={isPending}
          >
            Cancel
          </Button>
          <Button
            size="large"
            variant="primary"
            onClick={onConfirm}
            disabled={isPending}
          >
            {isPending ? "Submitting…" : "Submit"}
          </Button>
        </div>
      </div>
    </dialog>
  );
}

function Warning({ children }: { children: React.ReactNode }) {
  return (
    <p className="body-small text-[var(--color-signal-orange)]">{children}</p>
  );
}
