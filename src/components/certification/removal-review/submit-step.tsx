/**
 * SubmitStep — step 5 of the removal Review flow. The single-phase
 * `submitRemoval`, gated on the readiness verdict and (in production) an
 * explicit confirmation. Blocked removals route back to Pre-flight; in-flight
 * ones are disabled; a successful submit shows the resulting registry record.
 */
"use client";

import Link from "next/link";
import { CheckCircle } from "@phosphor-icons/react/dist/ssr";
import { useState } from "react";
import { Button } from "@/components/ui";
import { useToast } from "@/components/ui/toast";
import { useSubmitRemoval } from "@/hooks/use-certification";
import type { RemovalReadiness } from "@/lib/certification/readiness";
import { EnvBanner } from "../env-banner";
import { SubmitConfirmDialog } from "../submit-confirm-dialog";

interface SubmitStepProps {
  removalId: string;
  readiness: RemovalReadiness;
  isProduction: boolean;
  externalId: string | null;
  facilityId: string;
  onGoToPreflight: () => void;
}

export function SubmitStep({
  removalId,
  readiness,
  isProduction,
  externalId,
  facilityId,
  onGoToPreflight,
}: SubmitStepProps) {
  const submitMutation = useSubmitRemoval();
  const toast = useToast();
  const [confirmOpen, setConfirmOpen] = useState(false);

  const backHref = `/certification/removals?facility=${facilityId}`;
  const canSubmit =
    readiness.state === "ready" || readiness.state === "submitted";

  const fireSubmit = (confirmProduction = false) => {
    submitMutation.mutate(
      { removalId, confirmProduction },
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

  const handleSubmit = () => {
    if (isProduction) {
      setConfirmOpen(true);
      return;
    }
    fireSubmit();
  };

  // Successful submit this session — show the resulting registry record.
  if (submitMutation.isSuccess && submitMutation.data) {
    return (
      <div className="flex flex-col gap-24">
        <div className="flex items-start gap-12 border-l-2 border-[var(--color-signal-green)] pl-12 py-4">
          <CheckCircle
            size={20}
            weight="fill"
            aria-hidden
            className="mt-px shrink-0 text-[var(--color-signal-green)]"
          />
          <div className="flex flex-col gap-4">
            <span className="body-medium text-[var(--color-text-primary)]">
              Removal submitted to the registry.
            </span>
            <span className="body-caption font-mono text-[var(--color-text-tertiary)]">
              {submitMutation.data.externalId} · v{submitMutation.data.version}
            </span>
          </div>
        </div>
        <Link href={backHref}>
          <Button variant="primary">Back to Removals</Button>
        </Link>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-24">
      <div className="flex flex-col gap-8">
        <h2 className="title-heading-3">Submit</h2>
        <p className="body-medium text-[var(--color-text-secondary)] max-w-[680px]">
          Send this Removal to the registry. It can be resubmitted later, but a
          submitted Removal cannot be removed once a verifier has seen it.
        </p>
      </div>

      <EnvBanner isProduction={isProduction} variant="inline" />

      {readiness.state === "blocked" ? (
        <div className="flex flex-col gap-12">
          <p className="body-small text-[var(--color-text-primary)]">
            This removal isn&apos;t ready to submit yet — clear the blockers
            first.
          </p>
          <div>
            <Button variant="default" onClick={onGoToPreflight}>
              Back to Pre-flight
            </Button>
          </div>
        </div>
      ) : readiness.state === "inProgress" ? (
        <Button variant="primary" disabled>
          Submission in progress
        </Button>
      ) : (
        <div>
          <Button
            variant="primary"
            onClick={handleSubmit}
            disabled={!canSubmit}
            busy={submitMutation.isPending}
          >
            {externalId ? "Resubmit Removal" : "Submit Removal"}
          </Button>
        </div>
      )}

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
    </div>
  );
}
