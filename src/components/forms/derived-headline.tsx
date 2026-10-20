/**
 * DerivedHeadline — the one figure a derived block leads with.
 *
 * A caption line naming the figure, the figure itself, and an optional caption
 * line under it for the entry that produced it ("310 kg wet mass removed at 22.7%
 * moisture"). Pass `before` to show a change: the old value muted, an arrow,
 * then the new value. One per block at most; everything else in the block is a
 * picture, a key line or a calculation row.
 *
 * Unit and approximation belong in the figure ("≈ 1,110 kg"), so the label stays
 * a plain name. A figure that cannot be derived yet passes `null` and is left
 * out: the label stays with `sub` saying why ("Needs hydrogen and organic
 * carbon"), and with no `sub` either the headline renders nothing.
 */
import type { ReactNode } from "react";
import { ArrowRightIcon } from "@phosphor-icons/react/dist/ssr";
import { SecondaryFigure } from "@/components/ui/secondary-figure";

const ARROW_ICON_PX = 18;

export function DerivedHeadline({ label, value, before, secondary, sub, figureLabel }: {
  /** Names the figure. Caption style, above it. */
  label?: ReactNode;
  /** The figure, or the value after the change when `before` is set. Null when it cannot be derived, and then left out. */
  value: ReactNode;
  /** The value before the change, muted and followed by an arrow. */
  before?: ReactNode;
  /**
   * A second figure under the headline, such as the dry stock under a wet
   * estimate. Data, so it shows at both detail levels. A null value leaves the
   * line out.
   */
  secondary?: { label: ReactNode; value: ReactNode; };
  /** One caption line under the figure, such as the entry behind it, or why there is no figure. */
  sub?: ReactNode;
  /**
   * Accessible name for the figure row, read as one phrase instead of the
   * separate values (for example "Dry biochar in bin: 350 kg before, 280 kg after").
   */
  figureLabel?: string;
}) {
  const hasFigure = value != null || before != null;
  if (!hasFigure && sub == null) return null;
  return (
    <div className="flex flex-col gap-2">
      {label != null && (
        <div className="flex items-center gap-8 body-caption text-[var(--color-text-secondary)]">
          {label}
        </div>
      )}
      {hasFigure && <div
        className="flex flex-wrap items-center gap-x-8 body-large font-medium tabular-nums"
        role={figureLabel ? "group" : undefined}
        aria-label={figureLabel}
      >
        {before != null && (
          <>
            <span className="text-[var(--color-text-tertiary)]">{before}</span>
            <ArrowRightIcon
              size={ARROW_ICON_PX}
              aria-hidden="true"
              className="shrink-0 text-[var(--color-icon-secondary)]"
            />
            {!figureLabel && <span className="sr-only">to</span>}
          </>
        )}
        {value != null && <span>{value}</span>}
      </div>}
      {secondary && secondary.value != null && (
        <SecondaryFigure label={secondary.label} value={secondary.value} />
      )}
      {sub != null && (
        <div className="body-caption text-[var(--color-text-secondary)]">{sub}</div>
      )}
    </div>
  );
}
