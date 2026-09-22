/**
 * SegmentBar — one proportional bar and its key line, for any mass that
 * partitions into parts: dry biochar and ingredient solids and water in a
 * product, batches in a bin, shares in a blend.
 *
 * It is the general form of the moisture split bar and follows its rules: a
 * 10px bar with a hairline border, segments filled by mass category so the
 * same substance looks the same everywhere, a minimum visible width for small
 * parts, and a key line of "Label N kg" swatches in bar order. It sits flat
 * under the inputs that produce it; put it inside a `CompositionCard` when it
 * needs a caption, a hint or a calculation.
 *
 * `MoistureSplit` stays the component for a plain wet and dry split because it
 * owns the moisture arithmetic and the unresolved state; reach for this one
 * when the segments are already masses.
 */
import { MASS_CATEGORY_FILLS, formatCompositionMass, type MassSegment } from "@/components/forms/composition-ledger";
import { MIN_VISIBLE_SEGMENT_PERCENT, PERCENT_SCALE } from "@/lib/mass-moisture";

const BAR_HEIGHT = "h-10";
const SWATCH = "inline-block h-12 w-12 shrink-0 border border-[var(--color-border-secondary)]";

/** Widths that keep every non-zero part visible and still sum to the bar. */
export function segmentWidths(segments: readonly MassSegment[]): number[] {
  const masses = segments.map((segment) => Math.max(0, segment.mass ?? 0));
  const total = masses.reduce((sum, mass) => sum + mass, 0);
  if (total <= 0) return masses.map(() => 0);
  const raw = masses.map((mass) => (mass / total) * PERCENT_SCALE);
  const small = raw.filter((width) => width > 0 && width < MIN_VISIBLE_SEGMENT_PERCENT);
  const scalable = raw.filter((width) => width >= MIN_VISIBLE_SEGMENT_PERCENT).reduce((sum, width) => sum + width, 0);
  const remaining = PERCENT_SCALE - small.length * MIN_VISIBLE_SEGMENT_PERCENT;
  return raw.map((width) => {
    if (width <= 0) return 0;
    if (width < MIN_VISIBLE_SEGMENT_PERCENT) return MIN_VISIBLE_SEGMENT_PERCENT;
    return scalable > 0 ? (width / scalable) * remaining : width;
  });
}

function describe(segments: readonly MassSegment[]): string {
  return segments
    .filter((segment) => (segment.mass ?? 0) > 0)
    .map((segment) => `${segment.label} ${formatCompositionMass(segment.mass)}`)
    .join(", ");
}

export function SegmentBar({ segments, label, className = "" }: {
  segments: readonly MassSegment[];
  /** Names the whole the bar partitions, for the image's accessible name. */
  label: string;
  className?: string;
}) {
  const widths = segmentWidths(segments);
  const drawn = segments.map((segment, index) => ({ segment, width: widths[index] })).filter(({ width }) => width > 0);
  return (
    <div
      role="img"
      aria-label={`${label}: ${describe(segments) || "nothing recorded"}`}
      className={`flex w-full overflow-hidden border border-[var(--color-border-secondary)] ${BAR_HEIGHT} ${className}`}
    >
      {drawn.map(({ segment, width }, index) => (
        <div
          key={segment.label}
          aria-hidden="true"
          data-segment={segment.category}
          className={`${MASS_CATEGORY_FILLS[segment.category]} ${index > 0 ? "border-l border-[var(--color-border-secondary)]" : ""}`}
          style={{ width: `${width}%` }}
        />
      ))}
    </div>
  );
}

/** The line under the bar: a swatch and "Label N kg" per segment, in bar order. Zero parts stay listed so an empty part is a fact, not an omission. */
export function SegmentKey({ segments, className = "" }: { segments: readonly MassSegment[]; className?: string }) {
  return (
    <p className={`flex flex-wrap gap-x-16 gap-y-4 body-caption text-[var(--color-text-secondary)] ${className}`}>
      {segments.map((segment) => (
        <span key={segment.label} className="inline-flex items-center gap-6">
          <span aria-hidden="true" className={`${SWATCH} ${MASS_CATEGORY_FILLS[segment.category]}`} />
          {segment.label} {formatCompositionMass(segment.mass)}
        </span>
      ))}
    </p>
  );
}
