import type { CreateBiocharProductInput } from "../../src/data-access/biochar-product-create";
import { deriveCompositionSourceBiocharMassKg } from "../../src/data-access/biochar-product-composition";
import { previewProductStock, type ProductStockPreviewInput } from "../../src/data-access/product-stock-preview";
import type { OrgContext } from "../../src/lib/auth/server";

type FixtureProductInput = Omit<CreateBiocharProductInput, "basisFingerprint"> & { basisFingerprint?: string };

/** Convert the writer's pre-water blend mass to the public preview's source wet mass. */
export async function withProductStockFingerprint(ctx: OrgContext, data: FixtureProductInput): Promise<CreateBiocharProductInput> {
  const massKg = deriveCompositionSourceBiocharMassKg(data.massKg, data.composition);
  if (massKg == null || !data.sourceBiocharStorageLocationId || !data.storageLocationId || data.waterAddedKg == null || data.moistureContentPercent == null) {
    throw new Error("Product fixture requires source mass, source and destination bins, added water, and source moisture");
  }
  const previews = await previewProductStock(ctx, {
    facilityId: data.facilityId,
    formulationId: data.formulationId,
    placedAt: data.placedAt,
    sourceBiocharStorageLocationId: data.sourceBiocharStorageLocationId,
    storageLocationId: data.storageLocationId,
    massKg,
    moistureContentPercent: data.moistureContentPercent,
    waterAddedKg: data.waterAddedKg,
    ingredientBins: data.composition?.ingredients as ProductStockPreviewInput["ingredientBins"],
  });
  return { ...data, basisFingerprint: data.basisFingerprint ?? previews[0].basisFingerprint };
}
