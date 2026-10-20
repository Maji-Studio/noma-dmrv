/**
 * CompositionCard — a derived block in a form or read view: a caption naming
 * what is derived, one headline figure, the picture, and one action row
 * underneath.
 *
 * Not a card any more. The block sits flat under the inputs that produce it,
 * the way the moisture split sits under wet mass and moisture, so the reader
 * moves from cause to consequence without crossing a tinted frame. The
 * caption is quiet and sentence case and the content carries the hierarchy.
 * `actions` holds the block's own controls (a history dialog, a link, a fix
 * like "Balance to 100%") in one row at the bottom, so they never scatter
 * across the block.
 *
 * There is one view. Everything the block needs to be read stays visible:
 * caption, headline, the picture and any short line the caller puts in
 * `children`. Explanation (a ledger, the figures behind a movement, a
 * calculation) opens from one (i) beside the caption, in `explanation`. The
 * `hint` definition leads that panel, so a block never carries two (i)s. A
 * block with only a `hint` keeps the plain `InfoHint`.
 *
 * `explanation` is arithmetic or provenance the operator cannot already read
 * off the block; if it would only restate the visible numbers, omit it and no
 * (i) renders for it.
 */
"use client";

import type { ReactNode } from "react";
import { ExplanationInfo } from "@/components/ui/explanation-info";
import { InfoHint } from "@/components/ui/tooltip";

export function CompositionCard({
  title,
  hint,
  headline,
  children,
  explanation,
  actions,
}: {
  title: string;
  /** One sentence defining the block. An InfoHint beside the caption, or the lead of the explanation panel when there is one. */
  hint?: string;
  /** The block's one figure, usually a `DerivedHeadline`. */
  headline?: ReactNode;
  /** The picture: a bar and its key, or the figures the block is made of, plus any short line that must stay visible. */
  children?: ReactNode;
  /** Ledgers and arithmetic, shown in the panel of the caption's (i). */
  explanation?: ReactNode;
  /** Other controls for this block, in the action row. */
  actions?: ReactNode;
}) {
  const hasExplanation = explanation != null && explanation !== false;
  return (
    <section aria-label={title} className="flex flex-col gap-12">
      <h3 className="flex min-w-0 items-center gap-4 body-caption text-[var(--color-text-secondary)]">
        <span>{title}</span>
        {hasExplanation
          ? <ExplanationInfo title={title} hint={hint}>{explanation}</ExplanationInfo>
          : hint && <InfoHint label={`About ${title.toLowerCase()}`}>{hint}</InfoHint>}
      </h3>
      {headline}
      {children != null && children !== false && (
        <div className="flex flex-col gap-12">
          {children}
        </div>
      )}
      {actions && (
        <div className="flex flex-wrap items-center gap-x-8 gap-y-4 border-t border-[var(--color-border-tertiary)] pt-8">
          {actions}
        </div>
      )}
    </section>
  );
}
