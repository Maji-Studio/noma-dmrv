"use client";

import { useFormDetailLevel, CompositionCard, CompositionLedger } from "@/components/forms";
import type { ApplicationAllocationShare } from "@/data-access/delivery-allocation-provenance";

const MASS_DECIMALS = 3;

/** Dry kilograms, one precision for the ledger and the per-run breakdown alike. */
function formatDryMass(kg: number): string {
  return `${kg.toLocaleString(undefined, { maximumFractionDigits: MASS_DECIMALS })} kg`;
}

/**
 * Which production runs the applied batches came from.
 *
 * The ledger above already totals each batch, so the disclosure carries the one
 * thing it cannot: the run-level split inside each batch. Rows, not prose.
 */
function SourceRunBreakdown({ shares, products }: { shares: ApplicationAllocationShare[]; products: string[] }) {
  return <div className="space-y-12" aria-label="Source production runs per applied batch">
    {products.map(productId => {
      const runs = shares.filter(share => share.biocharProductId === productId);
      return <div key={productId} className="space-y-4">
        <p className="body-caption text-[var(--color-text-tertiary)]">{runs[0].productCode}</p>
        <dl className="body-caption tabular-nums">
          {runs.map(run => <div key={run.productionRunId} className="flex items-baseline justify-between gap-12 border-b border-[var(--color-border-secondary)] py-8 last:border-b-0">
            <dt>{run.productionRunCode}</dt>
            <dd>{formatDryMass(run.dryMassKg)}</dd>
          </div>)}
        </dl>
      </div>;
    })}
  </div>;
}

export function ApplicationAllocationShares({ shares }: { shares: ApplicationAllocationShare[] }) {
  const level = useFormDetailLevel();
  const total = shares.reduce((sum, share) => sum + share.dryMassKg, 0);
  const products = [...new Set(shares.map(share => share.biocharProductId))];
  if (!products.length) return null;
  if (level === "simple") return null;
  return <CompositionCard
    title="Applied batches"
    hint="Dry biochar is traced back to the product batches this application drew from."
    calculation={<SourceRunBreakdown shares={shares} products={products} />}
  >
    <CompositionLedger label="Applied batches" totalLabel="Applied dry biochar" total={total} segments={products.map(productId => ({ label: shares.find(share => share.biocharProductId === productId)!.productCode, mass: shares.filter(share => share.biocharProductId === productId).reduce((sum, share) => sum + share.dryMassKg, 0), category: "dry-batch" }))} />
  </CompositionCard>;
}
