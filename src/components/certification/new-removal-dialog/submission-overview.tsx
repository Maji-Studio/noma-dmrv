import Link from "next/link";
import { ArrowSquareOutIcon } from "@phosphor-icons/react/dist/ssr";
import type { MemberCreditBatch } from "@/fn/certification/certify-context";
import { formatDateRange, formatTonnes } from "@/lib/format-utils";
import { creditBatchDeepLinkHref } from "@/lib/credit-batch-links";
import { formatDurabilityOption } from "@/schemas/credit-batches";

interface SubmissionOverviewProps {
  memberBatches: MemberCreditBatch[];
  facilityId: string;
}

function total(
  batches: MemberCreditBatch[],
  value: (batch: MemberCreditBatch) => number,
): number {
  return batches.reduce((sum, batch) => sum + value(batch), 0);
}

function ManifestFact({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex min-w-0 flex-col justify-center gap-4 px-16 py-6">
      <span className="label-micro text-[var(--color-text-tertiary)]">
        {label}
      </span>
      <span className="body-medium font-medium text-[var(--color-text-primary)]">
        {value}
      </span>
    </div>
  );
}

function BatchFact({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex min-w-0 flex-col gap-2">
      <span className="body-caption text-[var(--color-text-tertiary)]">
        {label}
      </span>
      <span className="body-small text-[var(--color-text-primary)]">
        {value}
      </span>
    </div>
  );
}

function countLabel(count: number, singular: string): string {
  return `${count} ${singular}${count === 1 ? "" : "s"}`;
}

function BatchCard({
  batch,
  facilityId,
}: {
  batch: MemberCreditBatch;
  facilityId: string;
}) {
  return (
    <Link
      href={creditBatchDeepLinkHref(batch.id, facilityId)}
      target="_blank"
      rel="noopener noreferrer"
      aria-label={`Open credit batch ${batch.code} in a new tab`}
      className="group flex flex-col border border-[var(--color-border-secondary)] bg-[var(--color-background-white)] transition-colors hover:border-[var(--color-interaction)] hover:bg-[var(--color-background-light)] focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-interaction)]"
    >
      <div className="flex flex-wrap items-start justify-between gap-16 px-16 py-8">
        <div className="flex min-w-0 flex-col gap-4">
          <span className="label-micro text-[var(--color-text-tertiary)]">
            Credit batch
          </span>
          <span className="title-heading-3 font-mono text-[var(--color-text-primary)]">
            {batch.code}
          </span>
          <span className="body-small text-[var(--color-text-secondary)]">
            Crediting window · {formatDateRange(batch.startDate, batch.endDate)}
          </span>
        </div>
        <div className="flex items-start gap-24">
          <div className="flex flex-col items-end gap-4">
            <span className="label-micro text-[var(--color-text-tertiary)]">
              Stored removal
            </span>
            <span className="title-heading-3 font-mono text-[var(--color-text-primary)]">
              {formatTonnes(
                batch.co2eStoredPreview?.co2eStoredTonnes,
                { digits: 1, unit: "t CO₂e" },
              )}
            </span>
          </div>
          <span className="inline-flex shrink-0 items-center gap-4 body-small font-medium text-[var(--color-interaction)]">
            Inspect
            <ArrowSquareOutIcon size={14} aria-hidden />
          </span>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-x-16 gap-y-12 border-t border-[var(--color-border-tertiary)] bg-[var(--color-background-light)] px-16 py-12 sm:grid-cols-[0.8fr_1.5fr_0.75fr_1fr_1fr]">
        <BatchFact
          label="Submitted biochar (dry)"
          value={formatTonnes(batch.appliedDryWeightTons, { digits: 1 })}
        />
        <BatchFact
          label="Durability"
          value={formatDurabilityOption(batch.durabilityOption)}
        />
        <BatchFact
          label="Sampling"
          value={batch.sampling === "sampled" ? "Sampled" : "Unsampled"}
        />
        <BatchFact
          label="Production"
          value={countLabel(batch.productionRunCount, "production run")}
        />
        <BatchFact
          label="Applications"
          value={countLabel(batch.applicationCount, "application")}
        />
      </div>
    </Link>
  );
}

export function SubmissionOverview({
  memberBatches,
  facilityId,
}: SubmissionOverviewProps) {
  const batchCount = memberBatches.length;
  const appliedDryWeightTons = total(
    memberBatches,
    (batch) => batch.appliedDryWeightTons,
  );
  const hasCompleteCo2ePreview = memberBatches.every(
    (batch) => typeof batch.co2eStoredPreview?.co2eStoredTonnes === "number",
  );
  const co2eStoredTonnes = hasCompleteCo2ePreview
    ? total(
        memberBatches,
        (batch) => batch.co2eStoredPreview?.co2eStoredTonnes ?? 0,
      )
    : null;
  const productionRunCount = total(
    memberBatches,
    (batch) => batch.productionRunCount,
  );

  return (
    <section
      className="flex flex-col gap-12"
      aria-labelledby="submission-overview-heading"
    >
      <div className="flex flex-col gap-8">
        <h4
          id="submission-overview-heading"
          className="label-micro text-[var(--color-text-tertiary)]"
        >
          Submission overview
        </h4>
        <div className="grid overflow-hidden border border-[var(--color-border-primary)] sm:grid-cols-[minmax(0,1.25fr)_minmax(0,1fr)]">
          <div className="flex flex-col justify-center gap-6 bg-[var(--color-background-dark-strong)] px-20 py-16">
            <span className="label-micro text-[var(--color-text-white-secondary)]">
              Stored CO₂e estimate in this submission
            </span>
            <div className="flex items-baseline gap-8 text-[var(--color-text-white-primary)]">
              <span className="title-heading-1 font-mono">
                {co2eStoredTonnes === null
                  ? "—"
                  : co2eStoredTonnes.toFixed(1)}
              </span>
              <span className="body-medium font-medium">t CO₂e</span>
            </div>
          </div>
          <div className="grid grid-cols-2 divide-x divide-[var(--color-border-tertiary)] bg-[var(--color-background-white)]">
            <ManifestFact
              label="Contents"
              value={countLabel(batchCount, "credit batch")}
            />
            <ManifestFact
              label="Lineage"
              value={countLabel(productionRunCount, "production run")}
            />
            <div className="col-span-2 border-t border-[var(--color-border-tertiary)]">
              <ManifestFact
                label="Submitted biochar (dry)"
                value={formatTonnes(appliedDryWeightTons, { digits: 1 })}
              />
            </div>
          </div>
        </div>
      </div>

      <div className="flex flex-col gap-8">
        <span className="label-micro text-[var(--color-text-tertiary)]">
          Credit batch details
        </span>
        {memberBatches.map((batch) => (
          <BatchCard key={batch.id} batch={batch} facilityId={facilityId} />
        ))}
      </div>
    </section>
  );
}
