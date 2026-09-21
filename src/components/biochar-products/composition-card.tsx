"use client";

import { MISSING_VALUE } from "@/lib/copy-utils";

import { useId, useState, type ReactNode } from "react";
import { Button } from "@/components/ui/button";
import { formatMassKg, formatPercent } from "@/lib/format-utils";
import { PERCENT_SCALE, splitWetMass } from "@/lib/mass-moisture";
import { GRAMS_PER_KILOGRAM, type IngredientBin } from "@/lib/biochar-composition";
import type { AffectedStockPreview } from "@/types/output-stock";

export interface CompositionComponent {
  label: string;
  massKg: number | null;
  kind: "biochar" | "ingredient" | "water" | "addedWater";
}
const MIN_DISPLAY_MASS_KG = 0.1;
export function formatCompositionMass(mass: number | null | undefined) {
  if (mass == null || !Number.isFinite(mass) || mass < 0) return MISSING_VALUE.notAvailable;
  return mass > 0 && mass < MIN_DISPLAY_MASS_KG ? `<${formatMassKg(MIN_DISPLAY_MASS_KG)}` : formatMassKg(mass);
}


const FILLS = {
  biochar: "bg-[var(--clr-dark-purple-80)]",
  ingredient: "bg-[var(--clr-dark-purple-40)]",
  water: "moisture-water-hatch bg-[var(--paper)]",
  addedWater: "bg-[var(--color-moisture-added-water)]",
};

export function ingredientComponents(ingredient: Omit<IngredientBin, "massKg"> & { massKg?: unknown }, frozen = false, stock?: AffectedStockPreview): CompositionComponent[] {
  const split = splitWetMass(typeof ingredient.massKg === "number" ? ingredient.massKg : null, ingredient.moistureContentPercent);
  const weightedDry = typeof ingredient.massKg === "number" && stock?.lane === "ingredient" && stock.beforeDryKg !== null && stock.beforeEstimatedWetKg !== null && stock.beforeEstimatedWetKg > 0
    ? Math.round(ingredient.massKg * stock.beforeDryKg / stock.beforeEstimatedWetKg * GRAMS_PER_KILOGRAM) / GRAMS_PER_KILOGRAM
    : null;
  const dry = ingredient.massKg === 0 ? 0 : frozen ? ingredient.massDryKg ?? null : ingredient.moistureSource === "operator_override" ? split?.dryKg ?? null : weightedDry;
  const wet = ingredient.massKg;
  const valid = typeof wet === "number" && Number.isFinite(wet) && wet >= 0 && dry !== null && Number.isFinite(dry) && dry >= 0 && dry <= wet;
  return [
    { label: `${ingredient.feedstockTypeName} (dry)`, massKg: valid ? dry : null, kind: "ingredient" },
    { label: `Water in ${ingredient.feedstockTypeName.toLowerCase()}`, massKg: valid ? wet - dry : null, kind: "water" },
  ];
}

/** A presentation-only view: no rounded display values feed accounting. */
export function CompositionCard({ title, totalKg, components, details }: {
  title: string;
  totalKg: number | null;
  components: CompositionComponent[];
  details?: ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const id = useId();
  const complete = totalKg !== null && Number.isFinite(totalKg) && totalKg > 0 && components.every(component => component.massKg !== null && Number.isFinite(component.massKg) && component.massKg >= 0 && component.massKg <= totalKg);
  return <section aria-label={title} className="space-y-12 bg-[var(--color-surface-light)] p-16">
    <div className="flex items-center justify-between gap-12">
      <h3 className="body-small font-medium">{title}</h3>
      {details && <Button type="button" variant="noOutline" className="min-h-44 shrink-0 px-8" aria-expanded={open} aria-controls={id} aria-label={`${open ? "Hide" : "Show"} details for ${title.toLowerCase()}`} onClick={() => setOpen(!open)}>{open ? "Hide details" : "Details"}</Button>}
    </div>
    <table className="w-full table-fixed body-caption">
      <caption className="sr-only">{title}. Bars show each component as a share of total wet mass.</caption>
      <thead><tr className="border-b border-[var(--color-border-primary)]"><th scope="col" className="w-1/2 pb-8 text-left font-normal">Component</th><th scope="col" className="pb-8 text-right font-normal">Mass</th><th scope="col" className="pb-8 text-right font-normal">% of total</th></tr></thead>
      <tbody>{components.map((component, index) => <tr key={`${component.label}-${index}`}>
        <th scope="row" className="space-y-4 py-8 pr-12 text-left font-normal"><span>{component.label}</span><div aria-hidden="true" className="h-8 bg-[var(--color-background-medium)]">{complete && <div className={`h-full ${FILLS[component.kind]}`} style={{ width: `${component.massKg! / totalKg! * PERCENT_SCALE}%` }} />}</div></th>
        <td className="py-8 pr-8 text-right align-top tabular-nums">{formatCompositionMass(component.massKg)}</td>
        <td className="py-8 text-right align-top tabular-nums">{complete ? formatPercent(component.massKg! / totalKg! * PERCENT_SCALE) : MISSING_VALUE.notAvailable}</td>
      </tr>)}</tbody>
      <tfoot className="border-t border-[var(--color-border-secondary)]"><tr><th scope="row" className="pt-8 text-left font-medium">Wet total</th><td className="pt-8 pr-8 text-right tabular-nums">{formatCompositionMass(totalKg)}</td><td className="pt-8 text-right tabular-nums">{complete ? formatPercent(PERCENT_SCALE) : MISSING_VALUE.notAvailable}</td></tr></tfoot>
    </table>
    {details && <div id={id} hidden={!open} className="space-y-12 border-t border-[var(--color-border-secondary)] pt-16 body-small">{details}</div>}
  </section>;
}
