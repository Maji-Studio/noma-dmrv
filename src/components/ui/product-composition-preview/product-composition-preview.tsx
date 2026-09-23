/**
 * ProductCompositionPreview — what a wet biochar product is made of: the dry
 * biochar carbon accounting is paid on, the blend ingredients, the water, and
 * any water added afterwards.
 *
 * It is the product-level counterpart of `MoistureSplit` and follows the same
 * rules. The bar sits flat under the inputs that produce it, inside the same
 * form section, with one key line of swatches beneath it. No card, no tint, no
 * frame: the hierarchy comes from the bar and its key, never from a background.
 * Simple keeps the bar and its key, because those are what the fields mean;
 * Detailed adds the composition ledger and the arithmetic behind `Show
 * calculation`.
 *
 * Three levels of knowledge, one component, most specific first:
 * - `components`: the surface already split every part into solids and water
 *   (`productCompositionComponents` in `@/components/biochar-products`), so an
 *   ingredient's own water joins the water part instead of counting as solids.
 *   Missing parts read "Not available" and the bar stays unresolved. The form
 *   passes live parts; the product read view passes the saved snapshot with
 *   its total as `headline`, `formatMass` at save precision and the saved
 *   basis under the arithmetic.
 * - `ingredients`: blend masses as received, one segment each, with the rest
 *   of the wet mass filed as water in biochar.
 * - neither: the surface only knows the tracked dry biochar (an application
 *   reads it off its delivery), so the rest stays one "Ingredients + water".
 */
"use client";

import type { ReactNode } from "react";
import { CompositionCard } from "@/components/forms/composition-card";
import {
  CompositionLedger,
  formatCompositionMass,
  type MassSegment,
} from "@/components/forms/composition-ledger";
import {
  SegmentBar,
  SegmentKey,
  batchAccentFill,
  type SegmentFormat,
} from "@/components/ui/segment-bar";
import { formatMoisturePercent, MASS_MOISTURE_LABELS } from "@/lib/mass-moisture";

/**
 * What the parts mean. A definition, not arithmetic, so it rides on the caption
 * as an InfoHint instead of taking a line of its own.
 */
const COMPOSITION_HINT =
  "Dry biochar comes from the tracked source record. The remainder is ingredients and water.";
const BLOCK_TITLE = "Product composition";
/** Ingredient masses are as received, so their own water is not in this part. */
const BIOCHAR_WATER_LABEL = "Water in biochar";
const DEFAULT_REMAINDER_LABEL = "Ingredients + water";
const UNRESOLVED_COPY = "Record the masses above to see the product composition.";
/** Float slack when checking that the named parts fit inside the wet total. */
const MASS_EPSILON_KG = 1e-6;

export interface ProductCompositionIngredient {
  label: string;
  /** Mass as received, water included. */
  massKg: number | null | undefined;
}

/** What a part of the product is, which decides its fill and its place in the bar. */
export type ProductCompositionPartKind = "biochar" | "ingredient" | "water" | "addedWater";

/**
 * One part of the product, already split. `massKg` is null when the part
 * cannot be derived, and the key then reads "Not available" for it.
 */
export interface ProductCompositionPart {
  label: string;
  massKg: number | null;
  kind: ProductCompositionPartKind;
}

interface ProductCompositionPreviewProps {
  wetMassKg: number | null | undefined;
  dryBiocharKg?: number | null | undefined;
  /** Every part, already split into solids and water. Wins over `ingredients`. */
  components?: readonly ProductCompositionPart[];
  /** Blend masses as received, one segment and one ledger row each. */
  ingredients?: readonly ProductCompositionIngredient[];
  /** Water added after the biochar was weighed. */
  addedWaterKg?: number | null;
  /** Recorded moisture, shown as evidence beside the arithmetic. */
  moisturePercent?: number | null;
  wetLabel?: string;
  dryLabel?: string;
  /** Names the single part standing for everything that is not dry biochar. */
  remainderLabel?: string;
  /** One sentence defining the block, in place of the default hint. */
  note?: string;
  /** The block's one figure, usually the wet total as a `DerivedHeadline`. */
  headline?: ReactNode;
  /** Mass formatter for the bar, its key and the arithmetic. Defaults to kilograms at display precision. */
  formatMass?: SegmentFormat;
  /** Where the figures come from, shown under the arithmetic behind Show calculation. */
  basis?: ReactNode;
  /** Other controls for the block's action row, such as a stock history. */
  actions?: ReactNode;
  className?: string;
  testId?: string;
}

function resolvedMass(mass: number | null | undefined): number | null {
  return typeof mass === "number" && Number.isFinite(mass) && mass >= 0 ? mass : null;
}

const PART_CATEGORIES: Record<ProductCompositionPartKind, MassSegment["category"]> = {
  biochar: "dry-biochar",
  ingredient: "ingredient-solids",
  water: "existing-water",
  addedWater: "added-water",
};

/**
 * Split parts as segments. Ingredient solids take the entity accents so two
 * materials never draw as one block; zero added water drops out, as it does
 * everywhere else, because it is the default and not a part of the product.
 */
function partSegments(parts: readonly ProductCompositionPart[]): MassSegment[] {
  let ingredientIndex = 0;
  return parts
    .filter((part) => !(part.kind === "addedWater" && part.massKg === 0))
    .map((part) => ({
      label: part.label,
      mass: resolvedMass(part.massKg),
      category: PART_CATEGORIES[part.kind],
      ...(part.kind === "ingredient" ? { fill: batchAccentFill(ingredientIndex++) } : {}),
    }));
}

/** Every part known, and together they make the wet total. */
function partsResolve(segments: readonly MassSegment[], wetKg: number | null): boolean {
  if (wetKg === null || wetKg <= 0 || segments.length === 0) return false;
  if (segments.some((segment) => segment.mass === null)) return false;
  const sum = segments.reduce((total, segment) => total + (segment.mass ?? 0), 0);
  return Math.abs(sum - wetKg) <= MASS_EPSILON_KG * Math.max(1, wetKg);
}

/**
 * The parts of the wet product, in bar order, or null while the two figures the
 * whole partition rests on are missing. Ingredients only become their own parts
 * when every one of them carries a mass and they still fit inside the total:
 * a half-entered blend would otherwise draw a product smaller than it is.
 */
function resolveSegments({
  wetMassKg,
  dryBiocharKg,
  ingredients,
  addedWaterKg,
  dryLabel,
  remainderLabel,
}: {
  wetMassKg: number | null | undefined;
  dryBiocharKg: number | null | undefined;
  ingredients?: readonly ProductCompositionIngredient[];
  addedWaterKg?: number | null;
  dryLabel: string;
  remainderLabel: string;
}): MassSegment[] | null {
  const wetKg = resolvedMass(wetMassKg);
  const dryKg = resolvedMass(dryBiocharKg);
  if (wetKg === null || dryKg === null || wetKg <= 0 || dryKg > wetKg) return null;

  const addedKg = resolvedMass(addedWaterKg) ?? 0;
  const dry: MassSegment = { label: dryLabel, mass: dryKg, category: "dry-biochar" };
  const added: MassSegment[] = addedKg > 0
    ? [{ label: MASS_MOISTURE_LABELS.waterAdded, mass: addedKg, category: "added-water" }]
    : [];

  const listed = (ingredients ?? []).map((ingredient) => resolvedMass(ingredient.massKg));
  const itemized = listed.length > 0 && listed.every((mass) => mass !== null);
  const ingredientKg = listed.reduce<number>((total, mass) => total + (mass ?? 0), 0);
  const waterKg = wetKg - dryKg - ingredientKg - addedKg;

  if (itemized && waterKg >= -MASS_EPSILON_KG) {
    return [
      dry,
      ...(ingredients ?? []).map((ingredient, index) => ({
        label: ingredient.label,
        mass: resolvedMass(ingredient.massKg),
        category: "ingredient-solids" as const,
        // Blend materials are peers of each other, so the one ingredient fill
        // would draw them as a single block; the entity accents keep adjacent
        // materials apart while biochar keeps the carbon plum.
        fill: batchAccentFill(index),
      })),
      { label: BIOCHAR_WATER_LABEL, mass: Math.max(0, waterKg), category: "existing-water" },
      ...added,
    ];
  }

  return [
    dry,
    { label: remainderLabel, mass: Math.max(0, wetKg - dryKg - addedKg), category: "existing-water" },
    ...added,
  ];
}

/** The addition behind the total, for operators who want to check the figure. */
function formatCompositionArithmetic(
  wetLabel: string,
  wetMassKg: number | null | undefined,
  segments: readonly MassSegment[],
  format: SegmentFormat,
): string {
  const parts = segments.map((segment) => format(segment.mass)).join(" + ");
  return `${wetLabel} is the sum of its parts: ${parts} = ${format(resolvedMass(wetMassKg))}.`;
}

function UnresolvedBar() {
  return (
    <div
      aria-hidden="true"
      className="moisture-water-hatch h-10 w-full border border-dashed border-[var(--color-border-secondary)]"
    />
  );
}

export function ProductCompositionPreview({
  wetMassKg,
  dryBiocharKg,
  components,
  ingredients,
  addedWaterKg,
  moisturePercent,
  wetLabel = "Wet biochar product",
  dryLabel = "Dry biochar",
  remainderLabel = DEFAULT_REMAINDER_LABEL,
  note,
  headline,
  formatMass = formatCompositionMass,
  basis,
  actions,
  className = "",
  testId = "product-composition-preview",
}: ProductCompositionPreviewProps) {
  const split = components ? partSegments(components) : null;
  const segments = split
    ? (partsResolve(split, resolvedMass(wetMassKg)) ? split : null)
    : resolveSegments({ wetMassKg, dryBiocharKg, ingredients, addedWaterKg, dryLabel, remainderLabel });
  // A split with some parts known still names each part, so a missing one
  // reads "Not available" instead of vanishing from the product.
  const partlyKnown = split !== null && split.some((segment) => segment.mass !== null);

  const visual = segments ? (
    <div className="flex flex-col gap-8">
      <SegmentBar segments={segments} label={`${wetLabel} composition`} format={formatMass} />
      <SegmentKey segments={segments} format={formatMass} className="tabular-nums" />
    </div>
  ) : partlyKnown ? (
    <div className="flex flex-col gap-8">
      <UnresolvedBar />
      <SegmentKey segments={split} format={formatMass} className="tabular-nums" />
    </div>
  ) : (
    // Dry biochar drives certification, so a known dry mass stays visible while
    // the rest of the product is still missing.
    <div className="flex flex-col gap-6">
      <UnresolvedBar />
      {!split && resolvedMass(dryBiocharKg) !== null && (
        <p className="body-caption tabular-nums text-[var(--color-text-secondary)]">
          {dryLabel} {formatMass(resolvedMass(dryBiocharKg))}
        </p>
      )}
      <p className="body-caption text-[var(--color-text-tertiary)]">{UNRESOLVED_COPY}</p>
    </div>
  );

  const ledgerSegments = segments ?? (partlyKnown ? split : null);

  return (
    <div data-testid={testId} className={className} aria-live="polite">
      <CompositionCard
        title={BLOCK_TITLE}
        hint={note ?? COMPOSITION_HINT}
        simple="picture"
        headline={headline}
        actions={actions}
        calculation={ledgerSegments ? (
          <div className="flex flex-col gap-8">
            <CompositionLedger
              label={BLOCK_TITLE}
              totalLabel={wetLabel}
              total={resolvedMass(wetMassKg)}
              segments={ledgerSegments}
            />
            {segments && (
              <p className="body-caption text-[var(--color-text-tertiary)]">
                {formatCompositionArithmetic(wetLabel, wetMassKg, segments, formatMass)}
              </p>
            )}
            {basis}
            {moisturePercent !== undefined && (
              <p className="body-caption text-[var(--color-text-tertiary)]">
                Measured moisture: {formatMoisturePercent(moisturePercent)}
              </p>
            )}
          </div>
        ) : undefined}
      >
        {visual}
      </CompositionCard>
    </div>
  );
}
