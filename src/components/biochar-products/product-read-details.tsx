"use client";

import { useState } from "react";
import { FormDetailToggle, type FormDetailLevel } from "@/components/forms/form-detail-toggle";
import { OutputStockHistory } from "@/components/storage-locations/output-stock-history";
import { TransportLegsSummary } from "@/components/transport-legs";
import { DetailSpine } from "@/components/ui/detail-panel";
import { EntityDetailValue } from "@/components/ui/entity-detail-value";
import { PURE_BIOCHAR_LABEL } from "@/config/product-labels";
import type { BiocharProductWithRelations } from "@/data-access/biochar-products";
import { deriveSourceBiocharDryMassKg, deriveSourceBiocharMassKg, fromCompositionJsonb } from "@/lib/biochar-composition";
import { MASS_KG_STORAGE_DECIMALS } from "@/config/numeric-storage";
import { formatDate, formatMassKg } from "@/lib/format-utils";
import { formatMoisturePercent, MOISTURE_FIELD_LABEL, qualifyMassLabel } from "@/lib/mass-moisture";
import { sumNullable } from "@/lib/nullable-sum";
import { CompositionCard, ingredientComponents, type CompositionComponent } from "./composition-card";
import { ZeroSourceBiocharWarning } from "./zero-source-biochar-warning";

const formatSavedMassKg = (mass: number | null | undefined) => formatMassKg(mass, { digits: MASS_KG_STORAGE_DECIMALS });

/** Saved measurements and allocations only; current bin ratios never rewrite this view. */
export function savedProductComposition(product: BiocharProductWithRelations) {
  const ingredients = fromCompositionJsonb(product.composition);
  const sourceWetKg = deriveSourceBiocharMassKg(product.massKg, ingredients);
  const sourceDryKg = product.sourceAllocatedDryMassKg ?? deriveSourceBiocharDryMassKg(product.massKg, product.moistureContentPercent, ingredients);
  const waterKg = product.waterAddedKg;
  const sourceTotalKg = sourceWetKg === null ? null : sumNullable([sourceWetKg, waterKg]);
  const productTotalKg = product.massKg === null ? null : sumNullable([product.massKg, waterKg]);
  const sourceComponents: CompositionComponent[] = [
    { label: "Biochar (dry)", massKg: sourceDryKg, kind: "biochar" },
    { label: "Water in biochar", massKg: sourceWetKg !== null && sourceDryKg !== null && sourceDryKg <= sourceWetKg ? sourceWetKg - sourceDryKg : null, kind: "water" },
    { label: "Added water", massKg: waterKg, kind: "addedWater" },
  ];
  return { ingredients, sourceWetKg, sourceDryKg, sourceTotalKg, productTotalKg, sourceComponents, productComponents: [...sourceComponents, ...ingredients.flatMap(ingredient => ingredientComponents(ingredient, true))] };
}

export function ProductReadDetails({ product }: { product: BiocharProductWithRelations }) {
  const [detailLevel, setDetailLevel] = useState<FormDetailLevel>("simple");
  const detailed = detailLevel === "detailed";
  const composition = savedProductComposition(product);
  const sourceBinName = product.sourceBiocharStorageLocation?.name ?? product.linkedProductionRun?.biocharStorageLocationName;
  return <div className="space-y-20">
    <div className="flex justify-end"><FormDetailToggle value={detailLevel} onChange={setDetailLevel} /></div>
    <DetailSpine numbered sections={[
      { title: "Placement", fields: [{ label: "Mixing and placement date", value: formatDate(product.placedAt) }] },
      {
        title: "Source",
        fields: [
          { label: "Source biochar bin", value: sourceBinName },
          { label: "Source biochar wet mass (kg)", value: formatSavedMassKg(composition.sourceWetKg) },
          { label: qualifyMassLabel(MOISTURE_FIELD_LABEL, "Biochar"), value: formatMoisturePercent(product.moistureContentPercent) },
          { label: "Water added (kg)", value: formatSavedMassKg(product.waterAddedKg) },
          { label: "Density (kg/m³)", value: product.densityKgM3 != null ? `${product.densityKgM3} kg/m³` : null },
        ],
        content: <ZeroSourceBiocharWarning sourceBiocharMassKg={composition.sourceWetKg} />,
      },
      {
        title: "Formulation & ingredients",
        fields: [{ label: "Formulation", value: product.formulation?.name ?? PURE_BIOCHAR_LABEL }, ...composition.ingredients.flatMap(ingredient => [
          { label: `${ingredient.feedstockTypeName} wet mass (kg)`, value: ingredient.massKg != null ? formatSavedMassKg(ingredient.massKg) : null },
          { label: `${ingredient.feedstockTypeName} source bin`, value: <EntityDetailValue entityType="storageLocation" id={ingredient.storageLocationId} /> },
        ])],
      },
      {
        title: "Product",
        fields: [{ label: "Product bin", value: product.storageLocation?.name }, { label: "Wet product", value: formatSavedMassKg(composition.productTotalKg) }, { label: "Dry biochar", value: formatSavedMassKg(composition.sourceDryKg) }],
        content: detailed && <CompositionCard title="Product composition" totalKg={composition.productTotalKg} components={composition.productComponents} details={<>
          <p>{product.sourceAllocatedDryMassKg !== null ? "Dry biochar uses the recorded source allocation. Later moisture edits do not change it." : "Dry biochar is derived from the recorded source wet mass and moisture."} Ingredient dry solids come from the saved snapshot, not current bin moisture.</p>
          {product.storageLocation && <OutputStockHistory storageLocationId={product.storageLocation.id} facilityId={product.facilityId} />}
        </>} />,
      },
      { title: "Derived transport", fields: [], content: <TransportLegsSummary entityType="biochar" entityId={product.id} emptyMessage="Transport legs are derived from this product's deliveries. Record a delivery to a destination with a distance from the facility." /> },
    ]} />
  </div>;
}
