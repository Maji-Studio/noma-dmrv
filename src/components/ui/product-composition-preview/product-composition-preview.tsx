/**
 * ProductCompositionPreview — what a wet biochar product is made of: the dry
 * biochar carbon accounting is paid on, the blend ingredients as received, the
 * water already in the biochar, and any water added afterwards.
 *
 * It is the product-level counterpart of `MoistureSplit` and follows the same
 * rules. The bar sits flat under the inputs that produce it, inside the same
 * form section, with one key line of swatches beneath it. No card, no tint, no
 * frame: the hierarchy comes from the bar, the key line and the total, never
 * from a background.
 *
 * Two surfaces, one component:
 * - `variant="detail"` (default) — the block a form shows under its mass and
 *   ingredient fields. Simple keeps the bar and its key, because those are what
 *   the fields mean; Detailed adds the composition ledger and the arithmetic
 *   behind `Show calculation`.
 * - `variant="compact"` — the total, a bar and one key line, for a nested
 *   readout such as the destination bin in the transfer preview.
 *
 * Pass `ingredients` where the surface knows the individual blend masses and
 * each part becomes its own segment and ledger row. Where it only knows the
 * tracked dry biochar (an application reads it off its delivery), the rest of
 * the wet mass stays one honest "Ingredients + water" part.
 */
"use client";

import { useFormDetailLevel } from "@/components/forms/form-detail-context";
import { CompositionCard } from "@/components/forms/composition-card";
import {
  CompositionLedger,
  formatCompositionMass,
  type MassSegment,
} from "@/components/forms/composition-ledger";
import { SegmentBar, SegmentKey, batchAccentFill } from "@/components/ui/segment-bar";
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

interface ProductCompositionPreviewProps {
  variant?: "detail" | "compact";
  followFormDetail?: boolean;
  wetMassKg: number | null | undefined;
  dryBiocharKg: number | null | undefined;
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
  className?: string;
  testId?: string;
}

function resolvedMass(mass: number | null | undefined): number | null {
  return typeof mass === "number" && Number.isFinite(mass) && mass >= 0 ? mass : null;
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
): string {
  const parts = segments.map((segment) => formatCompositionMass(segment.mass)).join(" + ");
  return `${wetLabel} is the sum of its parts: ${parts} = ${formatCompositionMass(resolvedMass(wetMassKg))}.`;
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
  variant = "detail",
  followFormDetail = false,
  wetMassKg,
  dryBiocharKg,
  ingredients,
  addedWaterKg,
  moisturePercent,
  wetLabel = "Wet biochar product",
  dryLabel = "Dry biochar",
  remainderLabel = DEFAULT_REMAINDER_LABEL,
  note,
  className = "",
  testId = "product-composition-preview",
}: ProductCompositionPreviewProps) {
  const level = useFormDetailLevel();
  const segments = resolveSegments({
    wetMassKg,
    dryBiocharKg,
    ingredients,
    addedWaterKg,
    dryLabel,
    remainderLabel,
  });

  const visual = segments ? (
    <div className="flex flex-col gap-8">
      <SegmentBar segments={segments} label={`${wetLabel} composition`} />
      <SegmentKey segments={segments} className="tabular-nums" />
    </div>
  ) : (
    // Dry biochar drives certification, so a known dry mass stays visible while
    // the rest of the product is still missing.
    <div className="flex flex-col gap-6">
      <UnresolvedBar />
      {resolvedMass(dryBiocharKg) !== null && (
        <p className="body-caption tabular-nums text-[var(--color-text-secondary)]">
          {dryLabel} {formatCompositionMass(resolvedMass(dryBiocharKg))}
        </p>
      )}
      <p className="body-caption text-[var(--color-text-tertiary)]">{UNRESOLVED_COPY}</p>
    </div>
  );

  if (variant === "compact") {
    return (
      <div data-testid={testId} className={`flex flex-col gap-8 ${className}`.trim()} aria-live="polite">
        <p className="body-small text-[var(--color-text-secondary)]">
          {wetLabel}: <span className="font-mono">{formatCompositionMass(resolvedMass(wetMassKg))}</span>
        </p>
        {visual}
        {moisturePercent !== undefined && (
          <p className="body-caption text-[var(--color-text-tertiary)]">
            Measured moisture: {formatMoisturePercent(moisturePercent)}
          </p>
        )}
      </div>
    );
  }

  // The bar and its key are what the fields above mean, so they stay in Simple.
  // The ledger and the addition behind the total are what Detailed adds.
  const showCalculation = segments !== null && (!followFormDetail || level === "detailed");

  return (
    <div data-testid={testId} className={className} aria-live="polite">
      <CompositionCard
        title={BLOCK_TITLE}
        hint={note ?? COMPOSITION_HINT}
        calculation={showCalculation && segments ? (
          <div className="flex flex-col gap-8">
            <CompositionLedger
              label={BLOCK_TITLE}
              totalLabel={wetLabel}
              total={resolvedMass(wetMassKg)}
              segments={segments}
            />
            <p className="body-caption text-[var(--color-text-tertiary)]">
              {formatCompositionArithmetic(wetLabel, wetMassKg, segments)}
            </p>
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
