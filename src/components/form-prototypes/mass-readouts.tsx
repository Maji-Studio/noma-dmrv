import type { ReactNode } from "react";
import { MISSING_VALUE } from "@/lib/copy-utils";
import { formatMassKg } from "@/lib/format-utils";
import { type MassSplit } from "@/lib/mass-moisture";
import type { Variant } from "./variant-layout";

export function derivedMass(value: number | null) {
  return value === null ? MISSING_VALUE.notAvailable : formatMassKg(value);
}

export function Disclosure({ label, children }: { label: string; children: ReactNode }) {
  return <details className="border-t border-[var(--hair-2)]">
    <summary className="min-h-44 cursor-pointer py-12 body-small focus-visible:outline-2 focus-visible:outline-[var(--color-interaction)]">{label}</summary>
    <div className="space-y-8 pb-12 body-small">{children}</div>
  </details>;
}

type Fact = { label: string; mass: number | null };
export function Facts({ facts, paired = false, quiet = false }: { facts: Fact[]; paired?: boolean; quiet?: boolean }) {
  return <dl className={paired ? "grid grid-cols-1 gap-12 sm:grid-cols-2" : `flex flex-wrap gap-x-24 gap-y-8 ${quiet ? "body-caption" : "body-small"}`}>
    {facts.map(({ label, mass }) => <div key={label} className={paired ? "border-l-2 border-[var(--hair-2)] pl-12 body-small" : ""}>
      <dt className="text-[var(--color-text-secondary)]">{label}</dt><dd className="tabular-nums">{derivedMass(mass)}</dd>
    </div>)}
  </dl>;
}

type Segment = Fact & { className: string };
export const BIOCHAR_FILL = "bg-[var(--clr-dark-purple-80)]";
export const INGREDIENT_FILL = "bg-[var(--clr-dark-purple-40)]";
export const ADDED_WATER_FILL = "bg-[var(--color-moisture-added-water)]";
export const WATER_FILL = "moisture-water-hatch";
export function Composition({ label, segments }: { label: string; segments: Segment[] }) {
  const total = segments.reduce((sum, segment) => sum + (segment.mass ?? 0), 0);
  const valid = segments.every((segment) => segment.mass !== null && segment.mass >= 0);
  return <div className="space-y-8">
    <p className="body-caption font-medium">{label}</p>
    {valid && total > 0 && <div aria-hidden="true" className="flex h-12 overflow-hidden border border-[var(--hair-2)]">
      {segments.map((segment) => <span key={segment.label} className={segment.className} style={{ flexGrow: segment.mass ?? 0, flexBasis: 0 }} />)}
    </div>}
    <Facts facts={segments} quiet />
  </div>;
}

export function Calculation({ split, label }: { split: MassSplit | null; label: string }) {
  return <p>{label}: {split ? `${formatMassKg(split.wetKg)} × (1 − ${split.moisturePercent} / 100) = ${formatMassKg(split.dryKg)}` : MISSING_VALUE.notAvailable}</p>;
}

export function MaterialReadout({ variant, wet, split, dryLabel }: { variant: Variant; wet: number | null; split: MassSplit | null; dryLabel: string }) {
  const dry = split?.dryKg ?? null;
  if (variant === "E") return null;
  if (variant === "C") return <Composition label="Material composition" segments={[{ label: dryLabel, mass: dry, className: dryLabel === "Dry biochar" ? BIOCHAR_FILL : INGREDIENT_FILL }, { label: "Water", mass: split?.waterKg ?? null, className: WATER_FILL }]} />;
  return <div className="space-y-8">
    <Facts facts={variant === "B" ? [{ label: "Wet", mass: wet }, { label: dryLabel, mass: dry }] : [{ label: dryLabel, mass: dry }]} paired={variant === "B"} quiet={variant === "A"} />
    {variant === "D" && <Disclosure label="How this is calculated"><Calculation split={split} label={dryLabel} /></Disclosure>}
  </div>;
}

export function Ledger({ rows }: { rows: { label: string; wet: number | null; dry: number | null }[] }) {
  return <table className="w-full body-small">
    <caption className="sr-only">Material wet and dry masses</caption>
    <thead><tr><th scope="col" className="pb-8 text-left font-normal">Material</th><th scope="col" className="pb-8 text-right font-normal">Wet</th><th scope="col" className="pb-8 pl-12 text-right font-normal">Dry</th></tr></thead>
    <tbody>{rows.map((row) => <tr key={row.label} className="border-t border-[var(--hair-3)]"><th scope="row" className="py-8 text-left font-normal">{row.label}</th><td className="py-8 text-right tabular-nums">{derivedMass(row.wet)}</td><td className="py-8 pl-12 text-right tabular-nums">{derivedMass(row.dry)}</td></tr>)}</tbody>
  </table>;
}
