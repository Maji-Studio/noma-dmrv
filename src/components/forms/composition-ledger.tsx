import { MISSING_VALUE } from "@/lib/copy-utils";
import { formatPercent } from "@/lib/format-utils";
import { PERCENT_SCALE } from "@/lib/mass-moisture";
import { formatMassKg } from "@/lib/format-utils";

export type MassCategory = "dry-biochar" | "ingredient-solids" | "existing-water" | "added-water" | "dry-batch";
export type MassSegment = { label: string; mass: number | null; category: MassCategory };
const FILLS: Record<MassCategory, string> = {
  "dry-biochar": "bg-[var(--clr-dark-purple-80)]",
  "ingredient-solids": "bg-[var(--clr-dark-purple-40)]",
  "existing-water": "moisture-water-hatch",
  "added-water": "bg-[var(--color-moisture-added-water)]",
  "dry-batch": "bg-[var(--clr-dark-purple-80)]",
};
const MIN_DISPLAY_SHARE = 0.1;
const MIN_DISPLAY_MASS_KG = 0.1;

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
  return <div aria-hidden="true" className="h-8 w-full bg-[var(--color-surface-light)]">
    {total !== null && total > 0 && segment.mass !== null && <div className={`h-full ${FILLS[segment.category]}`} style={{ width: `${segment.mass / total * PERCENT_SCALE}%` }} />}
  </div>;
}

/** A complete, nonnegative mass basis is required before showing shares. */
export function CompositionLedger({ label, totalLabel, total, segments }: {
  label: string; totalLabel: string; total: number | null; segments: MassSegment[];
}) {
  const complete = total !== null && Number.isFinite(total) && total >= 0 && segments.length > 0 && segments.every(segment => segment.mass !== null && Number.isFinite(segment.mass) && segment.mass >= 0 && segment.mass <= total);
  const sum = segments.reduce((sum, segment) => sum + (segment.mass ?? 0), 0);
  const reconciled = total !== null && Math.abs(sum - total) <= Number.EPSILON * Math.max(1, total) * segments.length;
  const denominator = complete && reconciled ? total : null;
  return <table className="w-full table-fixed body-caption">
      <caption className="sr-only">{label}. Every mini bar uses the total mass as its scale.</caption>
      <thead><tr className="border-b border-[var(--color-border-primary)]"><th scope="col" className="w-1/2 pb-8 text-left font-normal">Component</th><th scope="col" className="pb-8 text-right font-normal">Mass</th><th scope="col" className="pb-8 text-right font-normal">% of total</th></tr></thead>
      <tbody>{segments.map((segment) => <tr key={segment.label}>
        <th scope="row" className="space-y-4 py-8 pr-12 text-left font-normal"><span>{segment.label}</span><MiniBar segment={segment} total={denominator} /></th>
        <td className="py-8 pr-8 text-right align-top tabular-nums">{formatCompositionMass(segment.mass)}</td>
        <td className="py-8 text-right align-top tabular-nums">{share(segment.mass, denominator)}</td>
      </tr>)}</tbody>
      <tfoot className="border-t border-[var(--color-border-secondary)]"><tr><th scope="row" className="pt-8 text-left font-medium">{totalLabel}</th><td className="pt-8 pr-8 text-right align-top tabular-nums">{formatCompositionMass(total)}</td><td className="pt-8 text-right align-top tabular-nums">{share(denominator, denominator)}</td></tr></tfoot>
    </table>;
}
