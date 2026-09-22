"use client";

import { useId, useState, type ReactNode } from "react";
import { SlidersHorizontalIcon } from "@phosphor-icons/react/dist/ssr";
import { Button } from "@/components/ui/button";

export function CompositionCard({ title, children, details }: { title: string; children: ReactNode; details: ReactNode }) {
  const [open, setOpen] = useState(false);
  const id = useId();
  return <section aria-label={title} className="space-y-12 bg-[var(--color-surface-light)] p-16">
    <div className="flex items-center justify-between gap-12">
      <h3 className="body-small font-medium">{title}</h3>
      <Button data-presentation-control type="button" variant="noOutline" className="min-h-44 min-w-44 shrink-0 gap-8 px-8 normal-case" aria-expanded={open} aria-controls={id} aria-label={`${open ? "Hide" : "Show"} details for ${title.toLowerCase()}`} onClick={() => setOpen(!open)}>
        <SlidersHorizontalIcon size={18} className="shrink-0" aria-hidden="true" /><span className="body-caption normal-case">{open ? "Hide details" : "Details"}</span>
      </Button>
    </div>
    {children}
    <div id={id} hidden={!open} className="space-y-16 border-t border-[var(--color-border-secondary)] pt-16">{details}</div>
  </section>;
}
