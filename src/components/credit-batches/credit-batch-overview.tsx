import Link from "next/link";
import { ArrowRightIcon, StackIcon } from "@phosphor-icons/react/dist/ssr";
import { InfoHint } from "@/components/ui/tooltip";
import type {
  CreditBatchProductionRunOption,
  CreditBatchWithRelations,
} from "@/data-access/credit-batches";
import { formatDate, formatTonnes } from "@/lib/format-utils";

interface CreditBatchOverviewProps {
  creditBatch: CreditBatchWithRelations;
  productionRuns: CreditBatchProductionRunOption[];
  isLoadingRuns: boolean;
}

function OverviewValue({
  label,
  value,
  hint,
}: {
  label: string;
  value: React.ReactNode;
  hint?: React.ReactNode;
}) {
  return (
    <div className="flex min-w-0 flex-col gap-3">
      <span className="inline-flex items-center gap-5 label-micro text-[var(--color-text-tertiary)]">
        {label}
        {hint && <InfoHint label={`More about ${label}`}>{hint}</InfoHint>}
      </span>
      <span className="body-medium font-medium text-[var(--color-text-primary)]">
        {value}
      </span>
    </div>
  );
}

function durabilityLabel(value: CreditBatchWithRelations["durabilityOption"]) {
  return value === "200_year" ? "200 years" : "1,000 years";
}

function ProductionRunCard({
  run,
  facilityId,
}: {
  run: CreditBatchProductionRunOption;
  facilityId: string;
}) {
  return (
    <Link
      href={`/production-runs?facility=${facilityId}&run=${run.id}`}
      className="group flex min-w-0 items-center justify-between gap-12 border border-[var(--color-border-tertiary)] bg-[var(--color-background-white)] px-12 py-10 hover:border-[var(--color-border-primary)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-interaction)]"
    >
      <span className="flex min-w-0 flex-col gap-2">
        <span className="body-small font-medium text-[var(--color-text-primary)]">
          {run.code}
        </span>
        <span className="body-caption text-[var(--color-text-tertiary)]">
          {formatDate(run.date)}
        </span>
      </span>
      <span className="flex shrink-0 items-center gap-10">
        <span className="text-right">
          <span className="block label-micro text-[var(--color-text-tertiary)]">
            Dry output
          </span>
          <span className="block body-small tabular-nums text-[var(--color-text-secondary)]">
            {run.biocharDryMassKg == null
              ? "—"
              : formatTonnes(run.biocharDryMassKg / 1000)}
          </span>
        </span>
        <ArrowRightIcon
          size={14}
          className="text-[var(--color-text-quaternary)] group-hover:text-[var(--color-text-secondary)]"
          aria-hidden
        />
      </span>
    </Link>
  );
}

export function CreditBatchOverview({
  creditBatch,
  productionRuns,
  isLoadingRuns,
}: CreditBatchOverviewProps) {
  const co2eStored = creditBatch.co2eStoredPreview?.co2eStoredTonnes ?? null;

  return (
    <section
      id="batch-details"
      className="flex flex-col gap-20 bg-[var(--panel-bg)] [border:var(--panel-border)] p-24 scroll-mt-24"
    >
      <div className="grid grid-cols-2 gap-x-20 gap-y-16 lg:grid-cols-4">
        <OverviewValue
          label="Feedstock"
          value={creditBatch.feedstockTypeName ?? "—"}
        />
        <OverviewValue
          label="Applied biochar"
          value={formatTonnes(creditBatch.appliedWeightTons)}
        />
        <OverviewValue
          label="CO₂e stored"
          value={
            co2eStored == null
              ? "Pending inputs"
              : formatTonnes(co2eStored, { unit: "t CO₂e" })
          }
        />
        <OverviewValue
          label="Durability"
          value={durabilityLabel(creditBatch.durabilityOption)}
          hint="Inherited from the facility's certification settings. It cannot be changed per credit batch."
        />
      </div>

      {creditBatch.siteManagementNotes?.trim() && (
        <div className="border-t border-[var(--color-border-tertiary)] pt-14">
          <OverviewValue label="Notes" value={creditBatch.siteManagementNotes} />
        </div>
      )}

      <div className="flex flex-col gap-10 border-t border-[var(--color-border-tertiary)] pt-14">
        <div className="flex items-center justify-between gap-12">
          <h2 className="inline-flex items-center gap-7 body-small font-medium text-[var(--color-text-primary)]">
            <StackIcon size={16} weight="bold" aria-hidden />
            Production runs
          </h2>
          <span className="body-caption text-[var(--color-text-tertiary)]">
            {creditBatch.productionRunCount} linked
          </span>
        </div>

        {isLoadingRuns ? (
          <span className="body-caption text-[var(--color-text-tertiary)]" aria-busy>
            Loading production runs…
          </span>
        ) : productionRuns.length > 0 ? (
          <div className="grid grid-cols-1 gap-8 lg:grid-cols-2 2xl:grid-cols-3">
            {productionRuns.map((run) => (
              <ProductionRunCard
                key={run.id}
                run={run}
                facilityId={creditBatch.facilityId}
              />
            ))}
          </div>
        ) : (
          <span className="body-caption text-[var(--color-text-tertiary)]">
            No production runs linked.
          </span>
        )}
      </div>
    </section>
  );
}
