"use client";

import type { ReactNode } from "react";
import { Button } from "@/components/ui/button";
import { FormSection } from "@/components/forms/form-section";

export const VARIANTS = {
  A: { name: "Quiet captions" },
  B: { name: "Paired readouts" },
  C: { name: "Visual composition" },
  D: { name: "Inline calculation" },
  E: { name: "Compact ledger" },
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
      {(Object.keys(VARIANTS) as Variant[]).map((key) => <Button key={key} type="button" variant={variant === key ? "primary" : "default"} className="min-h-44 h-auto whitespace-normal text-left" aria-pressed={variant === key} onClick={() => onChange(key)}>{key}. {VARIANTS[key].name}</Button>)}
    </div>
  </section>;
}

export function VariantSections({ sections }: { sections: PrototypeSection[] }) {
  return <div className="space-y-20">
    {sections.map((section, index) => <FormSection key={section.id} title={section.title} divider={index > 0}>{section.content}</FormSection>)}
  </div>;
}
