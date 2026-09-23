/**
 * Biochar product side-sheet view mode: the sections config for
 * EntitySideSheet, in the product form's section order.
 *
 * The read view shows what was saved, never what the bins say today. Dry
 * biochar is the source allocation recorded at save; ingredient dry solids are
 * the snapshot frozen with the product. Only a product saved before allocations
 * were recorded falls back to deriving its dry biochar from the saved wet mass
 * and moisture.
 *
 * Simple keeps every saved field and the product composition picture (the
 * total, the bar and its key). Detailed adds the dry figures as rows, the
 * composition ledger, the arithmetic behind Show calculation, and the derived
 * transport legs. Masses read at save precision.
 */
"use client";

import type { ReactNode } from "react";
import { CompositionCard } from "@/components/forms/composition-card";
import {
  CompositionLedger,
  type MassCategory,
  type MassSegment,
} from "@/components/forms/composition-ledger";
import { DerivedHeadline } from "@/components/forms/derived-headline";
import { StockRows } from "@/components/storage-locations/stock-figures";
import { TransportLegsSummary } from "@/components/transport-legs";
import type { DetailPanelSection } from "@/components/ui/detail-panel";
import { EntityDetailValue } from "@/components/ui/entity-detail-value";
import { SegmentBar, SegmentKey, batchAccentFill } from "@/components/ui/segment-bar";
import { MASS_KG_STORAGE_DECIMALS } from "@/config/numeric-storage";
import { PURE_BIOCHAR_LABEL } from "@/config/product-labels";
import type { BiocharProductWithRelations } from "@/data-access/biochar-products";
import {
  deriveSourceBiocharDryMassKg,
  deriveSourceBiocharMassKg,
  fromCompositionJsonb,
  type IngredientBin,
} from "@/lib/biochar-composition";
import { MISSING_VALUE } from "@/lib/copy-utils";
import { formatDate, formatMassKg } from "@/lib/format-utils";
import {
  formatMoisturePercent,
  MASS_MOISTURE_LABELS,
  MOISTURE_FIELD_LABEL,
  qualifyMassLabel,
} from "@/lib/mass-moisture";
import { sumNullable } from "@/lib/nullable-sum";
import { ZeroSourceBiocharWarning } from "./zero-source-biochar-warning";

const COMPOSITION_TITLE = "Product composition";
const WET_PRODUCT_LABEL = "Wet product";
/** Same definition the form's composition block carries. */
const COMPOSITION_HINT =
  "Dry biochar comes from the tracked source record. The remainder is ingredients and water.";
const ALLOCATED_BASIS =
  "Dry biochar is the source allocation saved with the product. Editing the moisture later does not change it.";
const DERIVED_BASIS =
  "No source allocation was saved with this product, so dry biochar comes from its saved wet mass and moisture.";
const INGREDIENT_BASIS =
  "Ingredient dry solids come from the snapshot saved with the product, not from today's bin moisture.";
const TRANSPORT_EMPTY =
  "Transport legs are derived from this product's deliveries. Record a delivery to a destination with a distance from the facility.";

export interface CompositionComponent {
  label: string;
  massKg: number | null;
  kind: "biochar" | "ingredient" | "water" | "addedWater";
}

const CATEGORIES: Record<CompositionComponent["kind"], MassCategory> = {
  biochar: "dry-biochar",
  ingredient: "ingredient-solids",
  water: "existing-water",
  addedWater: "added-water",
};

export function formatSavedMassKg(mass: number | null | undefined): string {
  return formatMassKg(mass, { digits: MASS_KG_STORAGE_DECIMALS });
}

/** A composition part is derived, so a missing one is not available rather than not recorded. */
function formatSavedPart(mass: number | null): string {
  return mass === null ? MISSING_VALUE.notAvailable : formatSavedMassKg(mass);
}

/**
 * One ingredient's dry solids and water from its saved snapshot. A missing or
 * impossible snapshot reads as missing; it is never rebuilt from today's bin.
 */
function savedIngredientComponents(ingredient: IngredientBin): CompositionComponent[] {
  const wet = ingredient.massKg ?? null;
  const dry = wet === 0 ? 0 : ingredient.massDryKg ?? null;
  const valid = wet !== null && Number.isFinite(wet) && wet >= 0
    && dry !== null && Number.isFinite(dry) && dry >= 0 && dry <= wet;
  return [
    { label: `${ingredient.feedstockTypeName} (dry)`, massKg: valid ? dry : null, kind: "ingredient" },
    { label: `Water in ${ingredient.feedstockTypeName.toLowerCase()}`, massKg: valid ? wet - dry : null, kind: "water" },
  ];
}

/** Display grouping only: each dry ingredient stays a part, existing water is one part. */
function productCompositionComponents(
  source: CompositionComponent[],
  ingredients: CompositionComponent[],
): CompositionComponent[] {
  const water = [...source, ...ingredients].filter(component => component.kind === "water");
  const existingWater = water.every(component => component.massKg !== null && Number.isFinite(component.massKg) && component.massKg >= 0)
    ? water.reduce((total, component) => total + (component.massKg ?? 0), 0)
    : null;
  return [
    ...source.filter(component => component.kind === "biochar"),
    ...ingredients.filter(component => component.kind === "ingredient"),
    { label: "Existing water", massKg: existingWater, kind: "water" },
    ...source.filter(component => component.kind === "addedWater"),
  ];
}

/** Saved measurements and allocations only; current bin ratios never rewrite this view. */
export function savedProductComposition(product: BiocharProductWithRelations) {
  const ingredients = fromCompositionJsonb(product.composition);
  const sourceWetKg = deriveSourceBiocharMassKg(product.massKg, ingredients);
  const sourceDryKg = product.sourceAllocatedDryMassKg
    ?? deriveSourceBiocharDryMassKg(product.massKg, product.moistureContentPercent, ingredients);
  const waterKg = product.waterAddedKg;
  const sourceTotalKg = sourceWetKg === null ? null : sumNullable([sourceWetKg, waterKg]);
  const productTotalKg = product.massKg === null ? null : sumNullable([product.massKg, waterKg]);
  const sourceComponents: CompositionComponent[] = [
    { label: "Dry biochar", massKg: sourceDryKg, kind: "biochar" },
    {
      label: "Water in biochar",
      massKg: sourceWetKg !== null && sourceDryKg !== null && sourceDryKg <= sourceWetKg ? sourceWetKg - sourceDryKg : null,
      kind: "water",
    },
    { label: MASS_MOISTURE_LABELS.waterAdded, massKg: waterKg, kind: "addedWater" },
  ];
  return {
    ingredients,
    sourceWetKg,
    sourceDryKg,
    sourceTotalKg,
    productTotalKg,
    sourceComponents,
    productComponents: productCompositionComponents(
      sourceComponents,
      ingredients.flatMap(savedIngredientComponents),
    ),
  };
}

/** Blend materials are peers, so each takes an entity accent instead of the one ingredient fill. */
function toSegments(components: CompositionComponent[]): MassSegment[] {
  let ingredientIndex = 0;
  return components.map(component => ({
    label: component.label,
    mass: component.massKg,
    category: CATEGORIES[component.kind],
    ...(component.kind === "ingredient" ? { fill: batchAccentFill(ingredientIndex++) } : {}),
  }));
}

function SavedProductComposition({ product, composition }: {
  product: BiocharProductWithRelations;
  composition: ReturnType<typeof savedProductComposition>;
}) {
  const segments = toSegments(composition.productComponents);
  // A bar drawn from some parts would show a product smaller than it is.
  const complete = composition.productTotalKg !== null && segments.every(segment => segment.mass !== null);
  const facts: { label: string; value: ReactNode }[] = [
    { label: "Source biochar (wet)", value: formatSavedMassKg(composition.sourceWetKg) },
    ...composition.ingredients.map(ingredient => ({
      label: `${ingredient.feedstockTypeName} (wet)`,
      value: formatSavedMassKg(ingredient.massKg),
    })),
    { label: MASS_MOISTURE_LABELS.waterAdded, value: formatSavedMassKg(product.waterAddedKg) },
    { label: WET_PRODUCT_LABEL, value: formatSavedMassKg(composition.productTotalKg) },
  ];
  return (
    <CompositionCard
      title={COMPOSITION_TITLE}
      hint={COMPOSITION_HINT}
      simple="picture"
      headline={<DerivedHeadline label={WET_PRODUCT_LABEL} value={composition.productTotalKg === null ? null : formatSavedMassKg(composition.productTotalKg)} />}
      detail={<CompositionLedger label={COMPOSITION_TITLE} totalLabel={WET_PRODUCT_LABEL} total={composition.productTotalKg} segments={segments} />}
      calculation={
        <div className="flex flex-col gap-8">
          <StockRows label={`${WET_PRODUCT_LABEL} is the sum of its saved parts`} rows={facts} />
          <p className="body-caption text-[var(--color-text-tertiary)]">
            {product.sourceAllocatedDryMassKg !== null ? ALLOCATED_BASIS : DERIVED_BASIS}
            {composition.ingredients.length > 0 && ` ${INGREDIENT_BASIS}`}
          </p>
        </div>
      }
    >
      <div className="flex flex-col gap-8">
        {complete && <SegmentBar segments={segments} label={`${WET_PRODUCT_LABEL} composition`} format={formatSavedPart} />}
        <SegmentKey segments={segments} format={formatSavedPart} className="tabular-nums" />
      </div>
    </CompositionCard>
  );
}

export function productSheetSections(product: BiocharProductWithRelations): DetailPanelSection[] {
  const composition = savedProductComposition(product);
  return [
    {
      title: "Placement",
      fields: [{ label: "Mixing and placement date", value: formatDate(product.placedAt) }],
    },
    {
      title: "Source",
      fields: [
        {
          label: "Source biochar bin",
          value: product.sourceBiocharStorageLocation?.name ?? product.linkedProductionRun?.biocharStorageLocationName,
        },
        { label: "Source biochar wet mass (kg)", value: formatSavedMassKg(composition.sourceWetKg) },
        { label: qualifyMassLabel(MOISTURE_FIELD_LABEL, "Biochar"), value: formatMoisturePercent(product.moistureContentPercent) },
        { label: "Dry biochar (kg)", detailedOnly: true, value: formatSavedMassKg(composition.sourceDryKg) },
        { label: "Water added (kg)", value: formatSavedMassKg(product.waterAddedKg) },
        { label: "Density (kg/m³)", value: product.densityKgM3 != null ? `${product.densityKgM3} kg/m³` : null },
      ],
      content: <ZeroSourceBiocharWarning sourceBiocharMassKg={composition.sourceWetKg} />,
    },
    {
      title: "Formulation & ingredients",
      fields: [
        { label: "Formulation", value: product.formulation?.name ?? PURE_BIOCHAR_LABEL },
        ...composition.ingredients.flatMap(ingredient => [
          { label: `${ingredient.feedstockTypeName} wet mass (kg)`, value: ingredient.massKg != null ? formatSavedMassKg(ingredient.massKg) : null },
          { label: `${ingredient.feedstockTypeName} source bin`, value: <EntityDetailValue entityType="storageLocation" id={ingredient.storageLocationId} /> },
          { label: `${ingredient.feedstockTypeName} dry solids (kg)`, detailedOnly: true, value: ingredient.massKg === 0 ? formatSavedMassKg(0) : formatSavedMassKg(ingredient.massDryKg) },
        ]),
      ],
    },
    {
      title: "Product",
      fields: [{ label: "Product bin", value: product.storageLocation?.name }],
      content: <SavedProductComposition product={product} composition={composition} />,
    },
    {
      title: "Derived transport",
      detailedOnly: true,
      fields: [],
      content: <TransportLegsSummary entityType="biochar" entityId={product.id} emptyMessage={TRANSPORT_EMPTY} />,
    },
  ];
}
