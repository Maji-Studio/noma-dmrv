"use client";

import { useId } from "react";
import { cn } from "@/lib/utils";

export type FormDetailLevel = "simple" | "detailed";

const OPTIONS = [
  { value: "simple", label: "Simple" },
  { value: "detailed", label: "Detailed" },
] as const;

/** Controls optional explanations and previews; never hide required fields or errors. */
export function FormDetailToggle({ value, onChange }: {
  value: FormDetailLevel;
  onChange: (value: FormDetailLevel) => void;
}) {
  const name = useId();
  return <fieldset data-presentation-control className="inline-flex shrink-0 whitespace-nowrap gap-2 bg-[var(--color-surface-light)] p-2">
    <legend className="sr-only">Form detail</legend>
    {OPTIONS.map((option) => <label key={option.value} className="relative cursor-pointer">
      <input className="peer sr-only" type="radio" name={name} value={option.value} checked={value === option.value} onChange={() => onChange(option.value)} />
      <span className={cn(
        "flex min-h-32 items-center px-6 sm:px-10 body-caption peer-focus-visible:outline-2 peer-focus-visible:outline-[var(--color-interaction)]",
        value === option.value ? "bg-[var(--paper)] text-[var(--color-text-primary)]" : "text-[var(--color-text-secondary)]",
      )}>{option.label}</span>
    </label>)}
  </fieldset>;
}
