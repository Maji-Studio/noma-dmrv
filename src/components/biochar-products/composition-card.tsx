"use client";


import type { ReactNode } from "react";
import { CompositionCard as InlineCompositionCard } from "@/components/forms/composition-card";
import { CompositionLedger, formatCompositionMass, type MassCategory } from "@/components/forms/composition-ledger";
import { splitWetMass } from "@/lib/mass-moisture";
import { GRAMS_PER_KILOGRAM, type IngredientBin } from "@/lib/biochar-composition";
import type { AffectedStockPreview } from "@/types/output-stock";

export interface CompositionComponent {
  label: string;
  massKg: number | null;
  kind: "biochar" | "ingredient" | "water" | "addedWater";
}
export { formatCompositionMass } from "@/components/forms/composition-ledger";

const CATEGORIES: Record<CompositionComponent["kind"], MassCategory> = {
  biochar: "dry-biochar", ingredient: "ingredient-solids", water: "existing-water", addedWater: "added-water",
};

/** Display grouping only: retain each dry ingredient and combine existing water. */
export function productCompositionComponents(source: CompositionComponent[], ingredients: CompositionComponent[]): CompositionComponent[] {
  const water = [...source, ...ingredients].filter(component => component.kind === "water");
  const existingWater = water.every(component => component.massKg !== null && Number.isFinite(component.massKg) && component.massKg >= 0)
    ? water.reduce((total, component) => total + component.massKg!, 0) : null;
  return [
    ...source.filter(component => component.kind === "biochar"),
    ...ingredients.filter(component => component.kind === "ingredient"),
    { label: "Existing water", massKg: existingWater, kind: "water" },
    ...source.filter(component => component.kind === "addedWater"),
  ];
}

export function CalculationFacts({ facts }: { facts: { label: string; massKg: number | null }[] }) {
  return <dl className="space-y-8 body-small">{facts.map((fact, index) => <div key={`${fact.label}-${index}`} className="flex flex-wrap justify-between gap-8"><dt className="text-[var(--color-text-secondary)]">{fact.label}</dt><dd className="tabular-nums">{formatCompositionMass(fact.massKg)}</dd></div>)}</dl>;
}

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
  return <InlineCompositionCard title={title} details={details}>
    <CompositionLedger label={title} totalLabel="Wet total" total={totalKg} segments={components.map(component => ({ label: component.label, mass: component.massKg, category: CATEGORIES[component.kind] }))} />
  </InlineCompositionCard>;
}
