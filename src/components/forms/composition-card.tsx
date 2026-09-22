/**
 * CompositionCard — a derived block in a form or read view: a caption naming
 * what is derived, the visual itself, and one action row underneath.
 *
 * Not a card any more. The block sits flat under the inputs that produce it,
 * the way the moisture split sits under wet mass and moisture, so the reader
 * moves from cause to consequence without crossing a tinted frame. The
 * caption is quiet and sentence case, the content carries the hierarchy, and
 * every action the block offers lives in one row at the bottom: `Show
 * calculation` reveals arithmetic the content cannot show, and `actions` holds
 * the block's other controls (a history dialog, a link) so they never scatter
 * across the block.
 *
 * `hint` is the one-sentence definition behind an InfoHint beside the caption.
 * `calculation` is arithmetic the operator cannot already read off the block;
 * if the hidden content would only restate the visible numbers, pass neither
 * and the row disappears.
 */
"use client";

import { useId, useState, type ReactNode } from "react";
import { CaretDownIcon, CaretUpIcon } from "@phosphor-icons/react/dist/ssr";
import { Button } from "@/components/ui/button";
import { InfoHint } from "@/components/ui/tooltip";

const CARET_ICON_PX = 14;

export function CompositionCard({ title, hint, children, calculation, actions }: {
  title: string;
  /** One sentence defining the block. Rendered as an InfoHint beside the caption. */
  hint?: string;
  children: ReactNode;
  /** Arithmetic the block does not already show. Omit and no control renders. */
  calculation?: ReactNode;
  /** Other controls for this block, rendered in the action row after Show calculation. */
  actions?: ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const id = useId();
  const CaretIcon = open ? CaretUpIcon : CaretDownIcon;
  const hasActions = Boolean(calculation) || Boolean(actions);
  return (
    <section aria-label={title} className="space-y-12">
      <h3 className="flex min-w-0 items-center gap-4 body-caption text-[var(--color-text-secondary)]">
        <span>{title}</span>
        {hint && <InfoHint label={`About ${title.toLowerCase()}`}>{hint}</InfoHint>}
      </h3>
      {children}
      {hasActions && (
        <div className="flex flex-wrap items-center gap-x-8 gap-y-4 border-t border-[var(--color-border-tertiary)] pt-8">
          {calculation && (
            <Button
              data-presentation-control
              type="button"
              variant="noOutline"
              className="min-h-44 shrink-0 gap-6 px-8 normal-case"
              aria-expanded={open}
              aria-controls={id}
              aria-label={`${open ? "Hide" : "Show"} calculation for ${title.toLowerCase()}`}
              onClick={() => setOpen(!open)}
            >
              <span className="body-caption normal-case">{open ? "Hide calculation" : "Show calculation"}</span>
              <CaretIcon size={CARET_ICON_PX} className="shrink-0" aria-hidden="true" />
            </Button>
          )}
          {actions}
        </div>
      )}
      {calculation && (
        <div id={id} hidden={!open} className="space-y-12">
          {calculation}
        </div>
      )}
    </section>
  );
}
