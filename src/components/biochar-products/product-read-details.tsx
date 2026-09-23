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
 * The composition is the form's `ProductCompositionPreview` fed the saved
 * parts, so one split rule serves both. Simple keeps every saved field and the
 * composition picture (the total, the bar and its key). Detailed adds the dry
 * figures as rows, the ledger and arithmetic behind Show calculation, and the
 * derived transport legs. Masses read at save precision.
 */
"use client";

import { DerivedHeadline } from "@/components/forms/derived-headline";
import { TransportLegsSummary } from "@/components/transport-legs";
import type { DetailPanelSection } from "@/components/ui/detail-panel";
import { EntityDetailValue } from "@/components/ui/entity-detail-value";
import { ProductCompositionPreview } from "@/components/ui/product-composition-preview";
import { MASS_KG_STORAGE_DECIMALS } from "@/config/numeric-storage";
import { PURE_BIOCHAR_LABEL } from "@/config/product-labels";
import type { BiocharProductWithRelations } from "@/data-access/biochar-products";
import {
  deriveSourceBiocharDryMassKg,
  deriveSourceBiocharMassKg,
  fromCompositionJsonb,
} from "@/lib/biochar-composition";
import { MISSING_VALUE } from "@/lib/copy-utils";
import { formatDate, formatMassKg } from "@/lib/format-utils";
import {
  formatMoisturePercent,
  MOISTURE_FIELD_LABEL,
  qualifyMassLabel,
} from "@/lib/mass-moisture";
import { sumNullable } from "@/lib/nullable-sum";
import {
  ingredientComponents,
  productCompositionComponents,
  sourceComponents,
} from "./product-composition-components";
import { ZeroSourceBiocharWarning } from "./zero-source-biochar-warning";

/** The same name the form's composition block gives the total. */
const WET_PRODUCT_LABEL = "Wet biochar product";
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

export function formatSavedMassKg(mass: number | null | undefined): string {
  return formatMassKg(mass, { digits: MASS_KG_STORAGE_DECIMALS });
}

/** A composition part is derived, so a missing one is not available rather than not recorded. */
function formatSavedPart(mass: number | null): string {
  return mass === null ? MISSING_VALUE.notAvailable : formatSavedMassKg(mass);
}

/**
 * Saved measurements and allocations only; current bin ratios never rewrite
 * this view. The split rule is the form's (`product-composition-components`),
 * with every ingredient frozen at the dry snapshot saved with the product.
 */
export function savedProductComposition(product: BiocharProductWithRelations) {
  const ingredients = fromCompositionJsonb(product.composition);
  const sourceWetKg = deriveSourceBiocharMassKg(product.massKg, ingredients);
  const sourceDryKg = product.sourceAllocatedDryMassKg
    ?? deriveSourceBiocharDryMassKg(product.massKg, product.moistureContentPercent, ingredients);
  const waterKg = product.waterAddedKg;
  const sourceTotalKg = sourceWetKg === null ? null : sumNullable([sourceWetKg, waterKg]);
  const productTotalKg = product.massKg === null ? null : sumNullable([product.massKg, waterKg]);
  return {
    ingredients,
    sourceWetKg,
    sourceDryKg,
    sourceTotalKg,
    productTotalKg,
    productComponents: productCompositionComponents(
      sourceComponents({ wetKg: sourceWetKg, dryKg: sourceDryKg, addedWaterKg: waterKg }),
      ingredients.flatMap(ingredient => ingredientComponents(ingredient, { frozen: true })),
    ),
  };
}

function SavedProductComposition({ product, composition }: {
  product: BiocharProductWithRelations;
  composition: ReturnType<typeof savedProductComposition>;
}) {
  const total = composition.productTotalKg;
  return (
    <ProductCompositionPreview
      testId="saved-product-composition"
      wetMassKg={total}
      components={composition.productComponents}
      wetLabel={WET_PRODUCT_LABEL}
      note={COMPOSITION_HINT}
      formatMass={formatSavedPart}
      headline={<DerivedHeadline label={WET_PRODUCT_LABEL} value={total === null ? null : formatSavedMassKg(total)} />}
      basis={
        <p className="body-caption text-[var(--color-text-tertiary)]">
          {product.sourceAllocatedDryMassKg !== null ? ALLOCATED_BASIS : DERIVED_BASIS}
          {composition.ingredients.length > 0 && ` ${INGREDIENT_BASIS}`}
        </p>
      }
    />
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
