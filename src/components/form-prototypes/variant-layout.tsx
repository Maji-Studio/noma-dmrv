"use client";

import type { ReactNode } from "react";
import { Button } from "@/components/ui/button";
import { FormSection } from "@/components/forms/form-section";

export const VARIANTS = {
  A: { name: "Composition strip", description: "One proportional strip with labeled masses. Recommended for scanning." },
  B: { name: "Wet envelope", description: "A total envelope contains the dry and water portions; orders contain dry batches." },
  C: { name: "Aligned bars", description: "Compare components from the same zero using one total-mass scale." },
  D: { name: "Mass equation", description: "Add labeled masses, with small bars showing their shares of the total." },
  E: { name: "Visual ledger", description: "Read component bars, masses and shares in a compact table." },
} as const;
export type Variant = keyof typeof VARIANTS;
export function readVariant(value: string | null): Variant {
  return value && Object.hasOwn(VARIANTS, value) ? value as Variant : "A";
}
export interface PrototypeSection {
  id: string;
  title: string;
  content: ReactNode;
}

export function VariantSwitcher({ variant, onChange }: { variant: Variant; onChange: (variant: Variant) => void }) {
  return <section aria-label="Wet/dry display variants" className="space-y-12">
    <h2 className="body-large font-medium">Choose a wet/dry display</h2>
    <div className="flex flex-wrap gap-8">
      {(Object.keys(VARIANTS) as Variant[]).map((key) => <Button key={key} type="button" variant={variant === key ? "primary" : "default"} className="min-h-44 h-auto whitespace-normal text-left" aria-pressed={variant === key} onClick={() => onChange(key)}>{key}. {VARIANTS[key].name}{key === "A" ? " (recommended)" : ""}</Button>)}
    </div>
    <p className="body-small text-[var(--color-text-secondary)]">{VARIANTS[variant].description}</p>
  </section>;
}

export function VariantSections({ sections }: { sections: PrototypeSection[] }) {
  return <div className="space-y-20">
    {sections.map((section, index) => <FormSection key={section.id} title={section.title} divider={index > 0}>{section.content}</FormSection>)}
  </div>;
}
