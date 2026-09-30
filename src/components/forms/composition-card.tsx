/**
 * CompositionCard — a derived block in a form or read view: a caption naming
 * what is derived, one headline figure, the picture, and one action row
 * underneath.
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
 * Simple and Detailed show the same block: caption, headline, picture
 * and the block's own `actions` (a stock history, a fix like "Balance to
 * 100%") render at both levels. Detailed adds only explanation: the `detail`
 * rows and Show calculation, both marked with `DETAIL_EXPLANATION_ATTR`.
 * Outside a detail provider the level is Detailed. Explanation parts stay
 * mounted behind `hidden`, so an open disclosure survives a level switch.
 *
 * `hint` is the one-sentence definition behind an InfoHint beside the caption.
 * `calculation` is arithmetic the operator cannot already read off the block;
 * if the hidden content would only restate the visible numbers, pass neither
 * and the row disappears.
 */
"use client";

import { cn } from "@/lib/utils";
import { useId, useState, type ReactNode } from "react";
import { CaretDownIcon, CaretUpIcon } from "@phosphor-icons/react/dist/ssr";
import { Button } from "@/components/ui/button";
import { InfoHint } from "@/components/ui/tooltip";
import { DETAIL_EXPLANATION_ATTR, useFormDetailLevel } from "./form-detail-context";

const CARET_ICON_PX = 14;

export function CompositionCard({
  title,
  hint,
  headline,
  children,
  detail,
  calculation,
  actions,
}: {
  title: string;
  /** One sentence defining the block. Rendered as an InfoHint beside the caption. */
  hint?: string;
  /** The block's one figure, usually a `DerivedHeadline`. Shown whenever the block is. */
  headline?: ReactNode;
  /** The picture: a bar and its key, or the figures the block is made of. */
  children?: ReactNode;
  /** Explanation rows Detailed shows in place under the picture, such as a ledger. Never decision info. */
  detail?: ReactNode;
  /** Arithmetic the block does not already show. Omit and no control renders. */
  calculation?: ReactNode;
  /** Other controls for this block, rendered in the action row after Show calculation. */
  actions?: ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const id = useId();
  const detailed = useFormDetailLevel() === "detailed";
  const explanation = { [DETAIL_EXPLANATION_ATTR]: true };
  const CaretIcon = open ? CaretUpIcon : CaretDownIcon;
  const hasActions = Boolean(calculation) || Boolean(actions);
  const showActionRow = detailed || Boolean(actions);
  // Flex gap rather than space-y: a part hidden by the level leaves no margin
  // behind, so Simple ends on its last visible part.
  return (
    <section aria-label={title} className="flex flex-col gap-12">
      <h3 className="flex min-w-0 items-center gap-4 body-caption text-[var(--color-text-secondary)]">
        <span>{title}</span>
        {hint && <InfoHint label={`About ${title.toLowerCase()}`}>{hint}</InfoHint>}
      </h3>
      {headline}
      {children != null && children !== false && (
        <div className="flex flex-col gap-12">
          {children}
        </div>
      )}
      {detail != null && detail !== false && (
        <div {...explanation} hidden={!detailed} className="flex flex-col gap-12">
          {detail}
        </div>
      )}
      {hasActions && (
        <div
          hidden={!showActionRow}
          className={cn(
            "flex flex-wrap items-center gap-x-8 gap-y-4",
            // The rule divides the picture from the calculation control, so it
            // only shows with that control (Detailed). Actions alone need none.
            calculation && detailed && "border-t border-[var(--color-border-tertiary)] pt-8",
          )}
        >
          {calculation && (
            <Button
              {...explanation}
              hidden={!detailed}
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
        <div {...explanation} id={id} hidden={!open || !detailed} className="flex flex-col gap-12">
          {calculation}
        </div>
      )}
    </section>
  );
}
