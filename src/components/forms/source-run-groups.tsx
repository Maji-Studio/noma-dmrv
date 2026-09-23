/**
 * SourceRunGroups — the run-level split inside each batch of a partition.
 *
 * It is the calculation behind an applied or delivered batch bar: the bar and
 * its ledger already total each batch, so this carries the one thing they
 * cannot, which production runs the batch drew from. Rows, not prose, and the
 * batch code is a quiet lead-in rather than a heading, so the disclosure reads
 * as a continuation of the block above it.
 */
import { formatMassKg } from "@/lib/format-utils";

export interface SourceRunGroup {
  /** The batch the runs sit under, named as the ledger names it. */
  label: string;
  runs: { id: string; code: string; dryMassKg: number | null }[];
}

export function SourceRunGroups({ label, groups }: { label: string; groups: SourceRunGroup[] }) {
  return <div className="space-y-12" aria-label={label}>
    {groups.map(group => <div key={group.label} className="space-y-4">
      <p className="body-caption text-[var(--color-text-tertiary)]">{group.label}</p>
      <dl className="body-caption tabular-nums">
        {group.runs.map(run => <div key={run.id} className="flex items-baseline justify-between gap-12 border-b border-[var(--color-border-secondary)] py-8 last:border-b-0">
          <dt>{run.code}</dt>
          <dd>{formatMassKg(run.dryMassKg)}</dd>
        </div>)}
      </dl>
    </div>)}
  </div>;
}
