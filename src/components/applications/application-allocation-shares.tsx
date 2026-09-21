"use client";

import { useFormDetailLevel } from "@/components/forms/form-detail-context";
import type { ApplicationAllocationShare } from "@/data-access/delivery-allocation-provenance";

const PERCENT_SCALE = 100;
const MASS_DECIMALS = 3;
const SHARE_DECIMALS = 3;

export function ApplicationAllocationShares({ shares }: { shares: ApplicationAllocationShare[] }) {
  const level = useFormDetailLevel();
  const total = shares.reduce((sum, share) => sum + share.dryMassKg, 0);
  const products = [...new Set(shares.map(share => share.biocharProductId))];
  if (!products.length) return null;
  const mass = (kg: number) => `${kg.toLocaleString(undefined, { maximumFractionDigits: MASS_DECIMALS })} kg dry`;
  if (level === "simple") return <p className="body-caption">{products.length} saved {products.length === 1 ? "batch" : "batches"} · {mass(total)}</p>;
  return <div className="flex flex-col gap-12" aria-label="Applied batch and source-run shares">
    {products.map(productId => {
      const runs = shares.filter(share => share.biocharProductId === productId);
      const dry = runs.reduce((sum, share) => sum + share.dryMassKg, 0);
      return <div key={productId} className="body-small">
        <p>{runs[0].productCode}: {mass(dry)} · {total > 0 ? (dry / total * PERCENT_SCALE).toFixed(SHARE_DECIMALS) : "0"}%</p>
        <ul className="body-caption text-[var(--color-text-secondary)]">
          {runs.map(run => <li key={run.productionRunId}>{run.productionRunCode}: {mass(run.dryMassKg)}</li>)}
        </ul>
      </div>;
    })}
  </div>;
}
