/**
 * Applied batches — which product batches this application's dry biochar came
 * from, and which production runs are behind each batch.
 *
 * The bar is the answer: one proportional block per batch, with a key line
 * naming each batch and its dry mass. Simple stops there, because the bar and
 * the key are what the saved shares mean. Detailed adds the ledger with each
 * batch's percentage of the total, and the action row's `Show calculation`
 * holds the run-level split the ledger cannot show.
 */
"use client";

import { CompositionCard, CompositionLedger } from "@/components/forms";
import { SourceRunGroups, type SourceRunGroup } from "@/components/forms/source-run-groups";
import { SegmentBar, SegmentKey, batchAccentFill } from "@/components/ui/segment-bar";
import type { MassSegment } from "@/components/forms/composition-ledger";
import type { ApplicationAllocationShare } from "@/data-access/delivery-allocation-provenance";

const APPLIED_BATCHES_HINT =
  "Dry biochar is traced back to the product batches this application drew from.";
/** Names the whole in the bar's accessible name and in the ledger's total row. */
const TOTAL_LABEL = "Applied dry biochar";

export function ApplicationAllocationShares({ shares }: { shares: ApplicationAllocationShare[] }) {
  const products = [...new Set(shares.map(share => share.biocharProductId))];
  if (!products.length) return null;
  const total = shares.reduce((sum, share) => sum + share.dryMassKg, 0);
  const segments: MassSegment[] = products.map((productId, index) => ({
    label: shares.find(share => share.biocharProductId === productId)!.productCode,
    mass: shares.filter(share => share.biocharProductId === productId).reduce((sum, share) => sum + share.dryMassKg, 0),
    category: "dry-batch",
    fill: batchAccentFill(index),
  }));
  const groups: SourceRunGroup[] = products.map(productId => {
    const runs = shares.filter(share => share.biocharProductId === productId);
    return {
      label: runs[0].productCode,
      runs: runs.map(run => ({ id: run.productionRunId, code: run.productionRunCode, dryMassKg: run.dryMassKg })),
    };
  });
  return <CompositionCard
    title="Applied batches"
    hint={APPLIED_BATCHES_HINT}
    simple="picture"
    detail={<CompositionLedger label="Applied batches" totalLabel={TOTAL_LABEL} total={total} segments={segments} />}
    calculation={<SourceRunGroups label="Source production runs per applied batch" groups={groups} />}
  >
    <div className="space-y-8">
      <SegmentBar label={TOTAL_LABEL} segments={segments} />
      <SegmentKey segments={segments} />
    </div>
  </CompositionCard>;
}
