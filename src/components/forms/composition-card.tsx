/**
 * CompositionCard — one tinted card holding a mass breakdown, with an optional
 * reveal for a real calculation.
 *
 * Two slots, two different jobs. `hint` is the one-sentence definition of what
 * the card shows; it lives behind an InfoHint beside the title so the prose
 * takes no layout space. `calculation` is arithmetic the operator cannot
 * already read off the card — a before/after, a batch breakdown, a FIFO draw —
 * and it gets the disclosure. If the hidden content would only restate the
 * visible numbers, pass neither and the control disappears.
 */
"use client";

import { useId, useState, type ReactNode } from "react";
import { CaretDownIcon, CaretUpIcon } from "@phosphor-icons/react/dist/ssr";
import { Button } from "@/components/ui/button";
import { InfoHint } from "@/components/ui/tooltip";

export function CompositionCard({ title, hint, children, calculation }: {
  title: string;
  /** One sentence defining the card. Rendered as an InfoHint beside the title. */
  hint?: string;
  children: ReactNode;
  /** Arithmetic the card does not already show. Omit and no control renders. */
  calculation?: ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const id = useId();
  const revealed = calculation;
  const CaretIcon = open ? CaretUpIcon : CaretDownIcon;
  return <section aria-label={title} className="space-y-12 bg-[var(--color-surface-light)] p-16">
    {/* A long bin name wraps rather than squeezing the control: the title takes
        the row and the disclosure drops to its own line only when it has to. */}
    <div className="flex flex-wrap items-center justify-between gap-x-12 gap-y-8">
      <h3 className="flex min-w-0 flex-1 items-center gap-4 body-small font-medium">
        <span className="min-w-0">{title}</span>
        {hint && <InfoHint label={`About ${title.toLowerCase()}`}>{hint}</InfoHint>}
      </h3>
      {revealed && <Button data-presentation-control type="button" variant="noOutline" className="min-h-44 shrink-0 gap-6 px-8 normal-case" aria-expanded={open} aria-controls={id} aria-label={`${open ? "Hide" : "Show"} calculation for ${title.toLowerCase()}`} onClick={() => setOpen(!open)}>
        <span className="body-caption normal-case">{open ? "Hide calculation" : "Show calculation"}</span><CaretIcon size={14} className="shrink-0" aria-hidden="true" />
      </Button>}
    </div>
    {children}
    {revealed && <div id={id} hidden={!open} className="space-y-12 border-t border-[var(--color-border-secondary)] pt-12">{revealed}</div>}
  </section>;
}
