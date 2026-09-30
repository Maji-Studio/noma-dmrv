import { MISSING_VALUE } from "@/lib/copy-utils";
import { formatPercent } from "@/lib/format-utils";
import { PERCENT_SCALE } from "@/lib/mass-moisture";
import { formatMassKg } from "@/lib/format-utils";

export type MassCategory = "dry-biochar" | "ingredient-solids" | "existing-water" | "added-water" | "dry-batch";
/**
 * `fill` overrides the category fill for one segment. Peer parts of the same
 * substance (batches in a delivery, batches in an application) all carry one
 * category, so without it a bar of four batches draws as one undivided block;
 * see `BATCH_ACCENT_FILLS` in the segment bar.
 */
export type MassSegment = { label: string; mass: number | null; category: MassCategory; fill?: string };
/** Fill per mass category, shared by the ledger mini bars and the segment bar. */
export const MASS_CATEGORY_FILLS: Record<MassCategory, string> = {
  "dry-biochar": "bg-[var(--clr-dark-purple-80)]",
  "ingredient-solids": "bg-[var(--clr-dark-purple-40)]",
  "existing-water": "moisture-water-hatch",
  "added-water": "bg-[var(--color-moisture-added-water)]",
  "dry-batch": "bg-[var(--clr-dark-purple-80)]",
};
const MIN_DISPLAY_SHARE = 0.1;
const MIN_DISPLAY_MASS_KG = 0.1;
const ROW = "border-b border-[var(--color-border-secondary)]";

/** Preserve positive quantities below the displayed precision instead of showing zero. */
export function formatCompositionMass(mass: number | null | undefined) {
  if (mass == null || !Number.isFinite(mass) || mass < 0) return MISSING_VALUE.notAvailable;
  return mass > 0 && mass < MIN_DISPLAY_MASS_KG
    ? `<${formatMassKg(MIN_DISPLAY_MASS_KG)}`
    : formatMassKg(mass);
}

function share(mass: number | null, total: number | null) {
  if (mass === null || total === null || total <= 0) return MISSING_VALUE.notAvailable;
  const percent = mass / total * PERCENT_SCALE;
  return percent > 0 && percent < MIN_DISPLAY_SHARE ? `<${formatPercent(MIN_DISPLAY_SHARE)}` : formatPercent(percent);
}

function MiniBar({ segment, total }: { segment: MassSegment; total: number | null }) {
  return <div aria-hidden="true" className="mt-4 h-4 w-full bg-[var(--color-border-secondary)]">
    {total !== null && total > 0 && segment.mass !== null && <div className={`h-full ${segment.fill ? "" : MASS_CATEGORY_FILLS[segment.category]}`} style={{ width: `${segment.mass / total * PERCENT_SCALE}%`, background: segment.fill }} />}
  </div>;
}

/**
 * A complete, nonnegative mass basis is required before showing shares.
 *
 * `hideZero` drops segments carrying no mass — a FIFO breakdown should not list
 * layers it never touched — but keeps them when every segment is zero, so an
 * all-empty ledger still names its components rather than collapsing to a total.
 */
export function CompositionLedger({ label, totalLabel, total, segments, hideZero = false }: {
  label: string; totalLabel: string; total: number | null; segments: MassSegment[]; hideZero?: boolean;
}) {
  const complete = total !== null && Number.isFinite(total) && total >= 0 && segments.length > 0 && segments.every(segment => segment.mass !== null && Number.isFinite(segment.mass) && segment.mass >= 0 && segment.mass <= total);
  const sum = segments.reduce((sum, segment) => sum + (segment.mass ?? 0), 0);
  const reconciled = total !== null && Math.abs(sum - total) <= Number.EPSILON * Math.max(1, total) * segments.length;
  const denominator = complete && reconciled ? total : null;
  const carrying = segments.filter(segment => segment.mass !== 0);
  const rows = hideZero && carrying.length > 0 ? carrying : segments;
  return <table className="w-full body-caption tabular-nums">
      <caption className="sr-only">{label}. Every mini bar uses the total mass as its scale.</caption>
      <thead><tr className={ROW}><th scope="col" className="w-auto py-8 text-left font-normal">Component</th><th scope="col" className="py-8 pl-12 text-right font-normal whitespace-nowrap">Mass</th><th scope="col" className="py-8 pl-12 text-right font-normal whitespace-nowrap">% of total</th></tr></thead>
      <tbody>{rows.map((segment) => <tr key={segment.label} className={ROW}>
        <th scope="row" className="w-auto py-8 text-left font-normal"><span>{segment.label}</span><MiniBar segment={segment} total={denominator} /></th>
        <td className="py-8 pl-12 text-right align-top whitespace-nowrap">{formatCompositionMass(segment.mass)}</td>
        <td className="py-8 pl-12 text-right align-top whitespace-nowrap">{share(segment.mass, denominator)}</td>
      </tr>)}</tbody>
      <tfoot><tr><th scope="row" className="py-8 text-left font-medium">{totalLabel}</th><td className="py-8 pl-12 text-right align-top whitespace-nowrap">{formatCompositionMass(total)}</td><td className="py-8 pl-12 text-right align-top whitespace-nowrap">{share(denominator, denominator)}</td></tr></tfoot>
    </table>;
}
