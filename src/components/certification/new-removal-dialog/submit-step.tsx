/**
 * SubmitStep — step 3 of the New-Removal wizard. Reuses the same single-phase
 * `submitRemoval` (via `useSubmitRemoval`) and production confirmation gate as
 * the standalone Review flow, so the two submit paths behave identically. On
 * success it shows the resulting registry record; the "View on Isometric" link
 * is wired in a later step once the registry URL is verified (design doc §7).
 */
"use client";

import { useState } from "react";
import { ArrowSquareOut, CheckCircle } from "@phosphor-icons/react/dist/ssr";
import { ServerError } from "@/components/forms";
import { Button, buttonVariants } from "@/components/ui";
import { useToast } from "@/components/ui/toast";
import { useSubmitRemoval } from "@/hooks/use-certification";
import type { RemovalCertifyContext } from "@/fn/certification/certify-context";
import { formatTonnes } from "@/lib/format-utils";
import { isometricRegistry } from "@/lib/isometric/links";
import { EnvBanner } from "../env-banner";
import { SubmitConfirmDialog } from "../submit-confirm-dialog";

interface SubmitStepProps {
  removalId: string;
  ctx: RemovalCertifyContext;
  onDone: () => void;
}

function totalCo2e(ctx: RemovalCertifyContext): number {
  return ctx.memberBatches.reduce(
    (sum, b) => sum + (b.co2eStoredPreview?.co2eStoredTonnes ?? 0),
    0,
  );
}

export function SubmitStep({ removalId, ctx, onDone }: SubmitStepProps) {
  const submitMutation = useSubmitRemoval();
  const toast = useToast();
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);

  const externalId = ctx.latestSubmission?.externalId ?? null;
  const rejectedWithExternal =
    ctx.latestSubmission?.status === "rejected" && externalId !== null;
  const batchCount = ctx.memberBatches.length;

  const fireSubmit = (confirmProduction = false) => {
    if (rejectedWithExternal) {
      setSubmitError(
        "This removal was rejected in Isometric. Resolve the registry record before retrying from noma.",
      );
      return;
    }
    setSubmitError(null);
    submitMutation.mutate(
      { removalId, confirmProduction },
      {
        onSuccess: (result) => {
          setSubmitError(null);
          toast.success(`Submitted removal ${result.externalId}.`);
        },
        onError: (err) => {
          setSubmitError(
            err instanceof Error ? err.message : "Submission failed",
          );
        },
      },
    );
  };

  const handleSubmit = () => {
    if (ctx.isProduction) {
      setConfirmOpen(true);
      return;
    }
    fireSubmit();
  };

  if (submitMutation.isSuccess && submitMutation.data) {
    // "View on Isometric" deep-links to the supplier's private Certify view of
    // this removal (project-scoped, environment-specific — see links.ts). Needs
    // the facility's mapped project id; omit the link if somehow unmapped.
    const projectId = ctx.mapping?.externalProjectId ?? null;
    const viewUrl = projectId
      ? isometricRegistry.removal({
          environment: ctx.isProduction ? "production" : "sandbox",
          externalProjectId: projectId,
          externalRemovalId: submitMutation.data.externalId,
        })
      : null;

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
        <div className="flex items-center justify-end gap-12">
          {viewUrl && (
            <a
              href={viewUrl}
              target="_blank"
              rel="noopener noreferrer"
              className={buttonVariants({ variant: "default" })}
            >
              View on Isometric
              <ArrowSquareOut size={16} aria-hidden />
            </a>
          )}
          <Button variant="primary" onClick={onDone}>
            Done
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-16">
      <div className="flex flex-col gap-4">
        <h3 className="title-heading-3">Submit</h3>
        <p className="body-small text-[var(--color-text-secondary)]">
          Ready to submit {batchCount} {batchCount === 1 ? "batch" : "batches"} ·{" "}
          {formatTonnes(totalCo2e(ctx), { digits: 1, unit: "t CO₂e" })}
        </p>
      </div>

      <EnvBanner isProduction={ctx.isProduction} variant="inline" />

      {(rejectedWithExternal || submitError) && (
        <ServerError
          message={
            rejectedWithExternal
              ? "This removal was rejected in Isometric. Resolve the registry record before retrying from noma."
              : submitError ?? undefined
          }
        />
      )}

      <div className="flex justify-end">
        <Button
          variant="primary"
          onClick={handleSubmit}
          busy={submitMutation.isPending}
          disabled={rejectedWithExternal}
        >
          {externalId ? "Resubmit removal" : "Submit removal"}
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
        isProduction={ctx.isProduction}
      />
    </div>
  );
}
