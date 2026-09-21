import { MISSING_VALUE } from "@/lib/copy-utils";
import { formatPercent } from "@/lib/format-utils";
import { PERCENT_SCALE } from "@/lib/mass-moisture";
import type { Variant } from "./variant-layout";
import { derivedMass } from "./mass-format";

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
const SEGMENT_SEPARATOR = "inset -1px 0 var(--paper)";

function share(mass: number | null, total: number | null) {
  if (mass === null || total === null || total <= 0) return MISSING_VALUE.notAvailable;
  const percent = mass / total * PERCENT_SCALE;
  return percent > 0 && percent < MIN_DISPLAY_SHARE ? `<${formatPercent(MIN_DISPLAY_SHARE)}` : formatPercent(percent);
}

function Swatch({ category }: { category: MassCategory }) {
  return <span aria-hidden="true" className={`inline-block size-12 shrink-0 border border-[var(--color-border-secondary)] ${FILLS[category]}`} />;
}

function SegmentLabel({ segment }: { segment: MassSegment }) {
  return <span className="inline-flex items-center gap-8"><Swatch category={segment.category} />{segment.label}</span>;
}

function Strip({ segments, total, tall = false }: { segments: MassSegment[]; total: number; tall?: boolean }) {
  return <div aria-hidden="true" className={`flex overflow-hidden ${tall ? "h-32" : "h-16"}`}>
    {segments.map((segment) => <span key={segment.label} className={`shrink-0 ${FILLS[segment.category]}`} style={{ width: `${(segment.mass ?? 0) / total * PERCENT_SCALE}%`, boxShadow: SEGMENT_SEPARATOR }} />)}
  </div>;
}

function MiniBar({ segment, total }: { segment: MassSegment; total: number | null }) {
  return <div aria-hidden="true" className="h-8 w-full bg-[var(--color-surface-light)]">
    {total !== null && total > 0 && segment.mass !== null && <div className={`h-full ${FILLS[segment.category]}`} style={{ width: `${segment.mass / total * PERCENT_SCALE}%` }} />}
  </div>;
}

function Labels({ segments, total }: { segments: MassSegment[]; total: number | null }) {
  return <dl className="grid grid-cols-1 gap-x-24 gap-y-8 sm:grid-cols-2 body-small">
    {segments.map((segment) => <div key={segment.label}>
      <dt><SegmentLabel segment={segment} /></dt>
      <dd className="pl-20 tabular-nums">{derivedMass(segment.mass)} <span className="text-[var(--color-text-secondary)]">({share(segment.mass, total)})</span></dd>
    </div>)}
  </dl>;
}

function Envelope({ segments, total, dryOnly }: { segments: MassSegment[]; total: number; dryOnly: boolean }) {
  const groups = dryOnly
    ? [{ label: "Dry batches", segments }]
    : [
      { label: "Total dry solids", segments: segments.filter((s) => s.category === "dry-biochar" || s.category === "ingredient-solids") },
      { label: "Total water", segments: segments.filter((s) => s.category === "existing-water" || s.category === "added-water") },
    ];
  return <div className="space-y-8">
    <div className="space-y-8 border border-[var(--color-border-primary)] p-8">
      <p className="body-caption">{dryOnly ? "Available dry stock" : "Wet total"}: {derivedMass(total)} · {formatPercent(PERCENT_SCALE)}</p>
      <div aria-hidden="true" className="flex">
        {groups.map((group) => {
          const mass = group.segments.reduce((sum, s) => sum + (s.mass ?? 0), 0);
          return <div key={group.label} className="min-w-0 border-b border-[var(--color-border-primary)] pb-4" style={{ width: `${mass / total * PERCENT_SCALE}%` }}>
            {mass > 0 && <Strip segments={group.segments} total={mass} tall />}
          </div>;
        })}
      </div>
    </div>
    {!dryOnly && groups.some((group) => group.segments.length > 1) && <dl className="flex flex-wrap gap-x-24 gap-y-8 body-caption">
      {groups.map((group) => {
        const mass = group.segments.reduce((sum, s) => sum + (s.mass ?? 0), 0);
        return <div key={group.label}><dt>{group.label}</dt><dd className="tabular-nums">{derivedMass(mass)} ({share(mass, total)})</dd></div>;
      })}
    </dl>}
  </div>;
}

export function Composition({ variant, label, totalLabel, total, segments, dryOnly = false }: {
  variant: Variant; label: string; totalLabel: string; total: number | null; segments: MassSegment[]; dryOnly?: boolean;
}) {
  const complete = total !== null && Number.isFinite(total) && total >= 0 && segments.every((s) => s.mass !== null && Number.isFinite(s.mass) && s.mass >= 0);
  const denominator = complete ? total : null;
  const drawable = denominator !== null && denominator > 0;
  return <div className="space-y-12">
    <div className="space-y-4">
      <h3 className="body-small font-medium">{label}</h3>
      {variant !== "E" && variant !== "D" && !(variant === "B" && drawable) && <p className="body-small tabular-nums">{totalLabel}: <strong className="font-medium">{derivedMass(total)}</strong></p>}
      <p className="body-caption text-[var(--color-text-secondary)]">{dryOnly ? "Shares of available dry stock" : "Shares of wet total"}</p>
    </div>
    {!drawable && <p className="body-small text-[var(--color-text-secondary)]">{total === 0 ? "No mass entered" : `Composition: ${MISSING_VALUE.notAvailable}`}</p>}
    {variant === "A" && <>
      {drawable && <Strip segments={segments} total={denominator} />}
      <Labels segments={segments} total={denominator} />
    </>}
    {variant === "B" && <>
      {drawable && <Envelope segments={segments} total={denominator} dryOnly={dryOnly} />}
      <Labels segments={segments} total={denominator} />
    </>}
    {variant === "C" && <>
      <p className="body-caption text-[var(--color-text-secondary)]">{total === null ? "A common scale appears when total mass is available." : `Each bar runs from 0 to ${derivedMass(total)}.`}</p>
      <dl className="space-y-12">
        {segments.map((segment) => <div key={segment.label} className="space-y-4">
          <div className="flex flex-wrap justify-between gap-x-12 gap-y-4 body-small"><dt><SegmentLabel segment={segment} /></dt><dd className="tabular-nums">{derivedMass(segment.mass)} ({share(segment.mass, denominator)})</dd></div>
          <MiniBar segment={segment} total={denominator} />
        </div>)}
      </dl>
    </>}
    {variant === "D" && <>
      <p className="body-caption text-[var(--color-text-secondary)]">Add the masses. Bar lengths show each share of the total.</p>
      <div className="grid grid-cols-1 gap-8 sm:grid-cols-2">
        {segments.map((segment, index) => <div key={segment.label} className="flex gap-8">
          <span className="w-16 shrink-0 body-large" aria-label={index ? "plus" : undefined}>{index ? "+" : ""}</span>
          <div className="min-w-0 flex-1 space-y-4 border-b border-[var(--color-border-tertiary)] pb-8 body-small">
            <SegmentLabel segment={segment} />
            <p className="tabular-nums">{derivedMass(segment.mass)} ({share(segment.mass, denominator)})</p>
            <MiniBar segment={segment} total={denominator} />
          </div>
        </div>)}
      </div>
      <p className="border-t border-[var(--color-border-primary)] pt-8 body-small tabular-nums">= {derivedMass(total)} {totalLabel.toLowerCase()}</p>
    </>}
    {variant === "E" && <table className="w-full table-fixed body-caption">
      <caption className="sr-only">{label}. Every mini bar uses the total mass as its scale.</caption>
      <thead><tr className="border-b border-[var(--color-border-primary)]"><th scope="col" className="w-1/2 pb-8 text-left font-normal">Component</th><th scope="col" className="pb-8 text-right font-normal">Mass</th><th scope="col" className="pb-8 text-right font-normal">Share</th></tr></thead>
      <tbody>{segments.map((segment) => <tr key={segment.label} className="border-b border-[var(--color-border-tertiary)]">
        <th scope="row" className="space-y-4 py-8 pr-12 text-left font-normal"><SegmentLabel segment={segment} /><MiniBar segment={segment} total={denominator} /></th>
        <td className="py-8 pr-8 text-right align-top tabular-nums">{derivedMass(segment.mass)}</td>
        <td className="py-8 text-right align-top tabular-nums">{share(segment.mass, denominator)}</td>
      </tr>)}</tbody>
      <tfoot><tr><th scope="row" className="pt-8 text-left font-medium">{totalLabel}</th><td className="pt-8 pr-8 text-right align-top tabular-nums">{derivedMass(total)}</td><td className="pt-8 text-right align-top tabular-nums">{share(denominator, denominator)}</td></tr></tfoot>
    </table>}
  </div>;
}
