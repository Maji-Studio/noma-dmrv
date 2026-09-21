"use client";

import { useId, useState, type ReactNode } from "react";
import { CaretDownIcon, CaretRightIcon } from "@phosphor-icons/react/dist/ssr";
import { Button } from "@/components/ui/button";
import { MISSING_VALUE } from "@/lib/copy-utils";
import { derivedMass } from "./mass-format";
import { formatMoisturePercent, type MassSplit } from "@/lib/mass-moisture";
import { Composition, type MassCategory } from "./composition-visuals";
import type { Variant } from "./variant-layout";

export function Disclosure({ label, children }: { label: string; children: ReactNode }) {
  return <details className="border-t border-[var(--hair-2)]">
    <summary className="min-h-44 cursor-pointer py-12 body-small focus-visible:outline-2 focus-visible:outline-[var(--color-interaction)]">{label}</summary>
    <div className="space-y-8 pb-12 body-small">{children}</div>
  </details>;
}

export function CalculationDisclosure({ context, children }: { context: string; children: ReactNode }) {
  const [open, setOpen] = useState(false);
  const id = useId();
  const label = open ? "Hide calculation" : "View calculation";
  const Chevron = open ? CaretDownIcon : CaretRightIcon;
  return <div>
    <Button type="button" variant="noOutline" className="min-h-44 w-full justify-start px-0" aria-expanded={open} aria-controls={id} aria-label={`${label} for ${context}`} onClick={() => setOpen(!open)}>
      <Chevron aria-hidden="true" size={16} />{label}
    </Button>
    <div id={id} hidden={!open} className="space-y-8 border-l-2 border-[var(--color-border-secondary)] pb-12 pl-12 body-small">
      {children}
      <p className="body-caption text-[var(--color-text-secondary)]">Displayed masses and percentages are rounded; equations are approximate.</p>
    </div>
  </div>;
}

type Fact = { label: string; mass: number | null };
export function Facts({ facts }: { facts: Fact[] }) {
  return <dl className="flex flex-wrap gap-x-24 gap-y-8 body-small">
    {facts.map(({ label, mass }) => <div key={label}>
      <dt className="text-[var(--color-text-secondary)]">{label}</dt><dd className="tabular-nums">{derivedMass(mass)}</dd>
    </div>)}
  </dl>;
}

export function Calculation({ split, label }: { split: MassSplit | null; label: string }) {
  return <div className="space-y-8">
    <p>{label}: {split ? `${derivedMass(split.wetKg)} × (1 − ${formatMoisturePercent(split.moisturePercent)}) ≈ ${derivedMass(split.dryKg)}` : MISSING_VALUE.notAvailable}</p>
    <p>Water: {split ? `${derivedMass(split.wetKg)} − ${derivedMass(split.dryKg)} ≈ ${derivedMass(split.waterKg)}` : MISSING_VALUE.notAvailable}</p>
  </div>;
}

export function MaterialReadout({ variant, wet, split, dryLabel, category, context }: {
  variant: Variant; wet: number | null; split: MassSplit | null; dryLabel: string;
  category: Extract<MassCategory, "dry-biochar" | "ingredient-solids">; context: string;
}) {
  return <div>
    <Composition variant={variant} label={`${context} composition`} totalLabel="Wet total" total={wet} segments={[
      { label: dryLabel, mass: split?.dryKg ?? null, category },
      { label: "Water", mass: split?.waterKg ?? null, category: "existing-water" },
    ]} />
    <CalculationDisclosure context={context.toLowerCase()}><Calculation split={split} label={dryLabel} /></CalculationDisclosure>
  </div>;
}
