/**
 * SubmitStep — the final "Confirm & submit" step of the New-Removal wizard. It
 * folds in what used to be a separate "Requirements" step: the facility/registry-
 * level checks (project mapping, default template, cross-batch transport
 * uniformity) are shown inline as a confirmation checklist with smart fix links,
 * and the submit button is gated on the shared `deriveRemovalReadiness` verdict.
 * Per-batch concerns (carbon, production lineage, transport-leg presence, and the
 * batch's own entity certifier fields) were already resolved at selection — only
 * ready batches got grouped — so this screen is a true confirmation, not a place
 * to discover new blockers.
 *
 * Reuses the same single-phase `submitRemoval` (via `useSubmitRemoval`) and
 * production confirmation gate as the standalone Review flow, so the two submit
 * paths behave identically. On success it shows the resulting registry record.
 */
"use client";

import { useState } from "react";
import { ArrowSquareOutIcon, CheckCircleIcon } from "@phosphor-icons/react/dist/ssr";
import { ServerError } from "@/components/forms";
import { Button, buttonVariants } from "@/components/ui";
import { Tooltip } from "@/components/ui/tooltip";
import { useToast } from "@/components/ui/toast";
import { useSubmitRemoval } from "@/hooks/use-certification";
import type { RemovalCertifyContext } from "@/fn/certification/certify-context";
import {
  buildRemovalRequirementsChecklist,
  deriveRemovalReadiness,
  type RemovalRequirementKey,
} from "@/lib/certification/readiness";
import { toRemovalReadinessFacts } from "@/lib/certification/readiness-facts";
import { certificationSettingsHref } from "@/lib/certification/links";
import { formatTonnes } from "@/lib/format-utils";
import { isometricRegistry } from "@/lib/isometric/links";
import { CheckRow } from "../check-row";
import { EnvBanner } from "../env-banner";
import { SubmitConfirmDialog } from "../submit-confirm-dialog";

const REJECTED_IN_ISOMETRIC_MSG =
  "This removal was rejected in Isometric. Resolve the registry record before retrying from noma.";

interface SubmitStepProps {
  removalId: string;
  ctx: RemovalCertifyContext;
  facilityId: string;
  onDone: () => void;
}

function totalCo2e(ctx: RemovalCertifyContext): number {
  return ctx.memberBatches.reduce(
    (sum, b) => sum + (b.co2eStoredPreview?.co2eStoredTonnes ?? 0),
    0,
  );
}

// Where each unmet facility-level requirement is fixed (design doc §6). All
// in-app, so plain Next <Link> navigation, facility-scoped.
function fixLinkFor(
  key: RemovalRequirementKey,
  facilityId: string,
): { label: string; href: string } | null {
  switch (key) {
    case "mapping":
    case "template":
      return {
        label: "Open settings",
        href: certificationSettingsHref(facilityId),
      };
    case "credentials":
      // Only a Platform Admin can manage organization credentials, so an
      // operator-facing wizard must not link to an inaccessible admin route.
      return null;
    case "transportUniformity":
      return {
        label: "Review transport",
        href: `/deliveries?facility=${facilityId}`,
      };
    case "durability":
      // Sampling/eligibility blockers are fixed by adding replicate samples or
      // correcting chemistry on the offending runs.
      return {
        label: "Review samples",
        href: `/samples?facility=${facilityId}`,
      };
    case "entityReadiness":
    case "evidence":
      return null;
  }
}

export function SubmitStep({
  removalId,
  ctx,
  facilityId,
  onDone,
}: SubmitStepProps) {
  const submitMutation = useSubmitRemoval();
  const toast = useToast();
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);

  const externalId = ctx.latestSubmission?.externalId ?? null;
  const rejectedWithExternal =
    ctx.latestSubmission?.status === "rejected" && externalId !== null;
  const batchCount = ctx.memberBatches.length;

  const facts = toRemovalReadinessFacts(ctx);
  const checklist = buildRemovalRequirementsChecklist(facts);
  const readiness = deriveRemovalReadiness(facts);
  const requirementsMet = readiness.state === "ready";

  const fireSubmit = (confirmProduction = false) => {
    if (rejectedWithExternal) {
      setSubmitError(REJECTED_IN_ISOMETRIC_MSG);
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
          <CheckCircleIcon
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
              <ArrowSquareOutIcon size={16} aria-hidden />
            </a>
          )}
          <Button variant="primary" onClick={onDone}>
            Done
          </Button>
        </div>
      </div>
    );
  }

  const submitButton = (
    <Button
      variant="primary"
      onClick={handleSubmit}
      busy={submitMutation.isPending}
      disabled={rejectedWithExternal || !requirementsMet}
    >
      {externalId ? "Resubmit removal" : "Submit removal"}
    </Button>
  );

  return (
    <div className="flex flex-col gap-16">
      <div className="flex flex-col gap-4">
        <h3 className="title-heading-3">Confirm &amp; submit</h3>
        <p className="body-small text-[var(--color-text-secondary)]">
          {batchCount} {batchCount === 1 ? "batch" : "batches"} ·{" "}
          {formatTonnes(totalCo2e(ctx), { digits: 1, unit: "t CO₂e" })}
        </p>
      </div>

      <ul className="flex flex-col border border-[var(--color-border-secondary)] bg-[var(--color-background-white)]">
        {checklist.map((check, index) => (
          <CheckRow
            key={check.key}
            status={check.status}
            // The one plain-language requirement string every readiness surface
            // renders (Phase 0/2) — never the affirmative "…complete" label,
            // which reads as a contradiction next to an unmet warning icon. Raw
            // protocol vocabulary stays tucked behind the ⓘ "Why?".
            label={check.requirementLabel}
            detail={check.detail}
            whyDetail={check.whyDetail}
            isFirst={index === 0}
            fix={
              check.status === "unmet"
                ? fixLinkFor(check.key, facilityId)
                : null
            }
          />
        ))}
      </ul>

      <EnvBanner isProduction={ctx.isProduction} variant="inline" />

      {(rejectedWithExternal || submitError) && (
        <ServerError
          message={
            rejectedWithExternal
              ? REJECTED_IN_ISOMETRIC_MSG
              : submitError ?? undefined
          }
        />
      )}

      <div className="flex justify-end">
        {requirementsMet ? (
          submitButton
        ) : (
          <Tooltip content="Finish the outstanding items above before this removal can be submitted.">
            <span className="inline-flex" tabIndex={0}>
              {submitButton}
            </span>
          </Tooltip>
        )}
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
