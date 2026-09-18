"use client";

import { useState, type ReactNode } from "react";
import { Button } from "@/components/ui/button";
import { FormSection } from "@/components/forms/form-section";

export const VARIANTS = {
  A: { name: "Compact overview", description: "Fill in the complete form, then explore composition and stock details below the summary." },
  B: { name: "At the source", description: "See quantities and stock beside the input groups that control them." },
  C: { name: "Expandable sections", description: "Scan the summaries. Open any section to edit it in place." },
  D: { name: "Guided inline steps", description: "Complete one step at a time. Earlier steps stay here so you can edit them." },
  E: { name: "Review on demand", description: "Focus on the inputs. Select Review to reveal a live summary and stock details below." },
} as const;
export type Variant = keyof typeof VARIANTS;
export function readVariant(value: string | null): Variant {
  return value && Object.hasOwn(VARIANTS, value) ? value as Variant : "A";
}
export interface PrototypeSection {
  id: string;
  title: string;
  summary: string;
  fields: string[];
  content: ReactNode;
  hasError: boolean;
}

export function VariantSwitcher({ variant, onChange }: { variant: Variant; onChange: (variant: Variant) => void }) {
  return <section aria-label="Layout variants" className="space-y-12">
    <h2 className="body-large font-medium">Choose an inline layout</h2>
    <div className="flex flex-wrap gap-8">
      {(Object.keys(VARIANTS) as Variant[]).map((key) => <Button key={key} type="button" variant={variant === key ? "primary" : "default"} className="min-h-44 h-auto whitespace-normal text-left" aria-pressed={variant === key} onClick={() => onChange(key)}>{key}. {VARIANTS[key].name}</Button>)}
    </div>
    <p className="body-small text-[var(--color-text-secondary)]" aria-live="polite">{VARIANTS[variant].description}</p>
  </section>;
}

function EditableSection({ section, expanded = false, step }: { section: PrototypeSection; expanded?: boolean; step?: number }) {
  const [open, setOpen] = useState(expanded);
  return <details open={open || section.hasError} onToggle={(event) => {
    if (section.hasError && !event.currentTarget.open) {
      event.currentTarget.open = true;
      return;
    }
    setOpen(event.currentTarget.open);
  }} className="border-b border-[var(--hair-2)]">
    <summary className="min-h-44 cursor-pointer py-16 focus-visible:outline-2 focus-visible:outline-[var(--color-interaction)]">
      <span className="body-medium font-medium">{step !== undefined ? `${step + 1}. ` : ""}{section.title}</span>
      <span className="mt-4 block body-small text-[var(--color-text-secondary)]">{section.hasError ? "Check the fields in this section." : section.summary}</span>
    </summary>
    <div className="space-y-16 pb-20">{section.content}</div>
  </details>;
}

export function VariantSections({ variant, sections, step }: { variant: Variant; sections: PrototypeSection[]; step: number }) {
  return <div className="space-y-20">
    {sections.map((section, index) => {
      if (variant === "C") return <EditableSection key={section.id} section={section} />;
      if (variant === "D" && index < step) return <EditableSection key={`${section.id}-complete`} section={section} step={index} />;
      if (variant === "D" && index > step && !section.hasError) return null;
      return <FormSection key={section.id} title={variant === "D" ? `${index + 1}. ${section.title}` : section.title} divider={index > 0}>{section.content}</FormSection>;
    })}
  </div>;
}
