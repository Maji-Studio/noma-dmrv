/**
 * AssembleStep — step 1 of the removal Review flow. Manages which credit
 * batches compose this Removal: detach members, or pull in ungrouped batches
 * from the same facility. Regrouping is frozen once the removal carries a live
 * submission (ADR 0003) — `canRegroup` gates the controls client-side, and the
 * server is authoritative either way.
 */
"use client";

import { ArrowsClockwise, Minus, Plus } from "@phosphor-icons/react/dist/ssr";
import { Button } from "@/components/ui";
import { useToast } from "@/components/ui/toast";
import {
  useAssignCreditBatchToRemoval,
  useRemovalsForFacility,
} from "@/hooks/use-certification";
import type { RemovalCertifyContext } from "@/fn/certification/certify-context";

const ICON_SIZE = 14;

function formatCo2eStored(
  preview: RemovalCertifyContext["memberBatches"][number]["co2eStoredPreview"],
) {
  if (!preview) return "CO2e pending";
  if (preview.co2eStoredTonnes != null) {
    return `${preview.co2eStoredTonnes.toFixed(2)} t CO2e stored`;
  }
  return "CO2e pending";
}

interface AssembleStepProps {
  ctx: RemovalCertifyContext;
  removalId: string;
  canRegroup: boolean;
}

export function AssembleStep({ ctx, removalId, canRegroup }: AssembleStepProps) {
  const assign = useAssignCreditBatchToRemoval();
  const removals = useRemovalsForFacility(ctx.facilityId);
  const toast = useToast();

  const members = ctx.memberBatches;
  const ungrouped = removals.data?.ungroupedBatches ?? [];

  const detach = (creditBatchId: string, code: string) => {
    assign.mutate(
      { creditBatchId, removalId: null },
      {
        onSuccess: () => toast.success(`Removed ${code} from this removal.`),
        onError: (err) =>
          toast.error(
            err instanceof Error ? err.message : "Could not detach batch.",
          ),
      },
    );
  };

  const attach = (creditBatchId: string, code: string) => {
    assign.mutate(
      { creditBatchId, removalId },
      {
        onSuccess: () => toast.success(`Added ${code} to this removal.`),
        onError: (err) =>
          toast.error(
            err instanceof Error ? err.message : "Could not add batch.",
          ),
      },
    );
  };

  return (
    <div className="flex flex-col gap-24">
      <div className="flex flex-col gap-8">
        <h2 className="title-heading-3">Assemble the removal</h2>
        <p className="body-medium text-[var(--color-text-secondary)] max-w-[680px]">
          A Removal submits one or more credit batches together. Group batches
          that share a reporting period; each batch can belong to only one
          removal.
        </p>
      </div>

      {!canRegroup && (
        <div className="border-l-2 border-[var(--color-signal-orange)] bg-[var(--color-surface-secondary)] pl-12 py-8">
          <p className="body-small text-[var(--color-text-primary)]">
            This removal has a live submission — its batches are frozen.
            Supersede it before regrouping.
          </p>
        </div>
      )}

      <section className="flex flex-col gap-8">
        <span className="body-caption uppercase tracking-wide text-[var(--color-text-tertiary)]">
          Member credit batches ({members.length})
        </span>
        {members.length === 0 ? (
          <p className="body-small text-[var(--color-text-tertiary)]">
            No credit batches in this removal.
          </p>
        ) : (
          <ul className="flex flex-col border border-[var(--color-border-secondary)] bg-[var(--color-background-white)]">
            {members.map((batch, index) => (
              <li
                key={batch.id}
                className={`flex items-center justify-between gap-12 px-16 py-12 ${
                  index > 0
                    ? "border-t border-[var(--color-border-tertiary)]"
                    : ""
                }`}
              >
                <div className="flex flex-col gap-2">
                  <span className="body-small font-mono text-[var(--color-text-primary)]">
                    {batch.code}
                  </span>
                  <span className="body-caption text-[var(--color-text-tertiary)]">
                    {formatCo2eStored(batch.co2eStoredPreview)}
                  </span>
                </div>
                {canRegroup && (
                  <Button
                    variant="default"
                    size="small"
                    onClick={() => detach(batch.id, batch.code)}
                    disabled={assign.isPending}
                  >
                    <Minus size={ICON_SIZE} weight="bold" />
                    Remove
                  </Button>
                )}
              </li>
            ))}
          </ul>
        )}
      </section>

      {canRegroup && ungrouped.length > 0 && (
        <section className="flex flex-col gap-8">
          <span className="body-caption uppercase tracking-wide text-[var(--color-text-tertiary)]">
            Add ungrouped batches ({ungrouped.length})
          </span>
          <ul className="flex flex-col border border-[var(--color-border-secondary)] bg-[var(--color-background-white)]">
            {ungrouped.map((batch, index) => (
              <li
                key={batch.id}
                className={`flex items-center justify-between gap-12 px-16 py-12 ${
                  index > 0
                    ? "border-t border-[var(--color-border-tertiary)]"
                    : ""
                }`}
              >
                <span className="body-small font-mono text-[var(--color-text-primary)]">
                  {batch.code}
                </span>
                <Button
                  variant="primary"
                  size="small"
                  onClick={() => attach(batch.id, batch.code)}
                  disabled={assign.isPending}
                >
                  {assign.isPending ? (
                    <ArrowsClockwise size={ICON_SIZE} className="animate-spin" />
                  ) : (
                    <Plus size={ICON_SIZE} weight="bold" />
                  )}
                  Add
                </Button>
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}
