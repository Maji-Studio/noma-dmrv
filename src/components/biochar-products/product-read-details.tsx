"use client";

import { useState } from "react";
import { FormDetailToggle, type FormDetailLevel } from "@/components/forms/form-detail-toggle";
import { BinMovementHistoryModal } from "@/components/storage-locations/bin-movement-history-modal";
import { OutputStockHistory } from "@/components/storage-locations/output-stock-history";
import { TransportLegsSummary } from "@/components/transport-legs";
import { DetailSpine } from "@/components/ui/detail-panel";
import { EntityDetailValue } from "@/components/ui/entity-detail-value";
import { BLEND_WET_MASS_LABEL, PURE_BIOCHAR_LABEL } from "@/config/product-labels";
import type { BiocharProductWithRelations } from "@/data-access/biochar-products";
import { deriveSourceBiocharDryMassKg, deriveSourceBiocharMassKg, fromCompositionJsonb } from "@/lib/biochar-composition";
import { MASS_KG_STORAGE_DECIMALS } from "@/config/numeric-storage";
import { formatDate, formatMassKg } from "@/lib/format-utils";
import { formatMoisturePercent, MOISTURE_FIELD_LABEL, qualifyMassLabel } from "@/lib/mass-moisture";
import { sumNullable } from "@/lib/nullable-sum";
import { CalculationFacts, CompositionCard, ingredientComponents, type CompositionComponent } from "./composition-card";
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
  const sourceBinId = product.sourceBiocharStorageLocation?.id ?? product.sourceBiocharStorageLocationId ?? product.linkedProductionRun?.biocharStorageLocationId;
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
          { label: BLEND_WET_MASS_LABEL, value: formatSavedMassKg(product.massKg) },
          { label: qualifyMassLabel(MOISTURE_FIELD_LABEL, "Biochar"), value: formatMoisturePercent(product.moistureContentPercent) },
          { label: "Water added (kg)", value: formatSavedMassKg(product.waterAddedKg) },
          { label: "Density (kg/m³)", value: product.densityKgM3 != null ? `${product.densityKgM3} kg/m³` : null },
        ],
        content: <div className="space-y-12">
          <ZeroSourceBiocharWarning sourceBiocharMassKg={composition.sourceWetKg} />
          {detailed && <CompositionCard title="Source composition" totalKg={composition.sourceTotalKg} components={composition.sourceComponents} details={<>
            <CalculationFacts facts={[{ label: "Source biochar (wet)", massKg: composition.sourceWetKg }, { label: "Dry biochar", massKg: composition.sourceDryKg }, { label: "Added water", massKg: product.waterAddedKg }]} />
            <p>{product.sourceAllocatedDryMassKg !== null ? "Dry biochar uses the recorded source allocation. Later moisture edits do not change it." : "Dry biochar is derived from the recorded source wet mass and moisture."}</p>
            {sourceBinId && <div className="space-y-8"><h4 className="body-small font-medium">{sourceBinName ?? "Source bin"}</h4><p className="body-caption">Bin history includes recorded movements. It is not a new allocation for this product.</p><OutputStockHistory storageLocationId={sourceBinId} facilityId={product.facilityId} /></div>}
          </>} />}
        </div>,
      },
      {
        title: "Formulation & ingredients",
        fields: [{ label: "Formulation", value: product.formulation?.name ?? PURE_BIOCHAR_LABEL }, ...composition.ingredients.flatMap((ingredient, index) => [
          { label: `Ingredient ${index + 1} · Blend material`, value: ingredient.feedstockTypeName },
          { label: `Ingredient ${index + 1} · Mass (kg)`, value: ingredient.massKg != null ? formatSavedMassKg(ingredient.massKg) : null },
          { label: `Ingredient ${index + 1} · Source bin`, value: <EntityDetailValue entityType="storageLocation" id={ingredient.storageLocationId} /> },
        ])],
        content: detailed && <div className="space-y-16">{composition.ingredients.map(ingredient => <CompositionCard key={ingredient.formulationIngredientId} title={`${ingredient.feedstockTypeName} composition`} totalKg={ingredient.massKg ?? null} components={ingredientComponents(ingredient, true)} details={<>
          <CalculationFacts facts={[{ label: `${ingredient.feedstockTypeName} (wet)`, massKg: ingredient.massKg ?? null }, { label: "Recorded dry solids", massKg: ingredient.massDryKg ?? null }]} />
          <p>Dry solids use the saved ingredient snapshot, not current bin moisture.</p>
          {ingredient.storageLocationId && <div className="space-y-8"><EntityDetailValue entityType="storageLocation" id={ingredient.storageLocationId} /><BinMovementHistoryModal storageLocationId={ingredient.storageLocationId} /></div>}
        </>} />)}</div>,
      },
      {
        title: "Product",
        fields: [{ label: "Product bin", value: product.storageLocation?.name }, { label: "Wet product", value: formatSavedMassKg(composition.productTotalKg) }, { label: "Dry biochar", value: formatSavedMassKg(composition.sourceDryKg) }],
        content: detailed && <CompositionCard title="Product composition" totalKg={composition.productTotalKg} components={composition.productComponents} details={<>
          <CalculationFacts facts={[{ label: "Source biochar (wet)", massKg: composition.sourceWetKg }, ...composition.ingredients.map(ingredient => ({ label: `${ingredient.feedstockTypeName} (wet)`, massKg: ingredient.massKg ?? null })), { label: "Added water", massKg: product.waterAddedKg }, { label: "Wet total", massKg: composition.productTotalKg }]} />
          <p>Wet total = recorded blend mass + added water. Dry biochar excludes ingredient solids and water.</p>
          {product.storageLocation && <div className="space-y-8"><h4 className="body-small font-medium">{product.storageLocation.name}</h4><OutputStockHistory storageLocationId={product.storageLocation.id} facilityId={product.facilityId} /></div>}
        </>} />,
      },
      { title: "Derived transport", fields: [], content: <TransportLegsSummary entityType="biochar" entityId={product.id} emptyMessage="Transport legs are derived from this product's deliveries. Record a delivery to a destination with a distance from the facility." /> },
    ]} />
  </div>;
}
