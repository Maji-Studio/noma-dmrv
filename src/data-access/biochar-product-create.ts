import { and, eq, isNull } from "drizzle-orm";
import type { OrgContext } from "@/lib/auth/server";
import { db } from "@/db";
import {
  biocharProducts,
  facilities,
  formulations,
  productionRuns,
  storageLocations,
  type BiocharProduct,
} from "@/db/schema";
import { parseLocalDateString } from "@/lib/date-utils";
import { computeClampedDryMass } from "@/lib/calculations/mass-dry";
import { SafeError } from "@/lib/errors";
import {
  SOURCE_BIOCHAR_MASS_ERROR,
  ZERO_SOURCE_BIOCHAR_ERROR,
} from "@/lib/biochar-composition";
import { COMPLETED_PRODUCTION_RUN_STATUS } from "@/lib/production-runs/lifecycle";
import {
  assertCompositionIngredientDrawsWithinStock,
  deriveCompositionSourceBiocharMassKg,
  getCompositionIngredientDraws,
  resolveCompositionIngredientMassBasis,
  validateCompositionIngredientBins,
} from "./biochar-product-composition";
import { assertBiocharDrawWithinStock } from "./bin-stock-guards";
import { lockBinStocks } from "./lock-bin-stocks";
import {
  buildBiocharProductSourceAllocationPlan,
  insertBiocharProductSourceAllocations,
} from "./biochar-product-source-allocations";
import { productionRunDateExpr } from "./production-runs/date-expr";
import { requireOrgScope } from "./utils";

export interface CreateBiocharProductInput {
  code: string;
  facilityId: string;
  formulationId?: string | null;
  status?: "draft" | "testing" | "ready" | "sold";
  sourceBiocharStorageLocationId?: string | null;
  linkedProductionRunId?: string | null;
  storageLocationId?: string | null;
  massKg?: number | null;
  moistureContentPercent?: number | null;
  densityKgM3?: number | null;
  waterAddedKg?: number | null;
  composition?: Record<string, unknown>;
}

/**
 * The product production date is when its oldest allocated biochar lot was
 * produced, not when the blend was mixed.
 */
function runDateToProductionDate(runDate: string | Date): Date {
  return runDate instanceof Date
    ? runDate
    : parseLocalDateString(runDate);
}

export async function createBiocharProduct(
  ctx: OrgContext,
  data: CreateBiocharProductInput,
): Promise<BiocharProduct> {
  requireOrgScope(ctx);

  const formulationId = data.formulationId ?? null;
  const [[facility], formulationRows] = await Promise.all([
    db
      .select({ id: facilities.id })
      .from(facilities)
      .where(
        and(
          eq(facilities.id, data.facilityId),
          eq(facilities.organizationId, ctx.organizationId),
          isNull(facilities.archivedAt),
        ),
      ),
    formulationId
      ? db
          .select({ id: formulations.id })
          .from(formulations)
          .where(
            and(
              eq(formulations.id, formulationId),
              eq(formulations.organizationId, ctx.organizationId),
            ),
          )
      : Promise.resolve([] as { id: string }[]),
  ]);

  if (!facility) {
    throw new SafeError("Facility not found or archived");
  }
  if (formulationId && formulationRows.length === 0) {
    throw new SafeError("Formulation not found");
  }

  const sourceBiocharStorageLocationId =
    data.sourceBiocharStorageLocationId ?? null;
  if (
    sourceBiocharStorageLocationId &&
    data.linkedProductionRunId
  ) {
    throw new SafeError(
      "Select a source biochar bin instead of a production run",
    );
  }
  if (!sourceBiocharStorageLocationId && !data.linkedProductionRunId) {
    throw new SafeError("Source biochar bin is required");
  }
  if (!data.storageLocationId) {
    throw new SafeError("Product bin is required");
  }
  const massKg = data.massKg;
  if (massKg == null || !Number.isFinite(massKg) || massKg <= 0) {
    throw new SafeError("Wet mass must be greater than 0.");
  }
  const moistureContentPercent = data.moistureContentPercent;
  if (
    moistureContentPercent == null ||
    !Number.isFinite(moistureContentPercent) ||
    moistureContentPercent < 0 ||
    moistureContentPercent > 100
  ) {
    throw new SafeError(
      "Moisture content must be between 0 and 100",
    );
  }
  const waterAddedKg = data.waterAddedKg;
  if (
    waterAddedKg == null ||
    !Number.isFinite(waterAddedKg) ||
    waterAddedKg < 0
  ) {
    throw new SafeError("Water added must be 0 or more.");
  }

  const [run] = data.linkedProductionRunId
    ? await db
        .select({
          id: productionRuns.id,
          facilityId: productionRuns.facilityId,
          date: productionRunDateExpr(),
          biocharStorageLocationId:
            productionRuns.biocharStorageLocationId,
        })
        .from(productionRuns)
        .where(
          and(
            eq(productionRuns.id, data.linkedProductionRunId),
            eq(productionRuns.organizationId, ctx.organizationId),
          ),
        )
    : [];

  if (!sourceBiocharStorageLocationId) {
    if (!run) {
      throw new SafeError("Linked production run not found");
    }
    if (run.facilityId !== data.facilityId) {
      throw new SafeError(
        "Linked production run belongs to a different facility",
      );
    }
  }

  const [formulationRatioRow] = formulationId
    ? await db
        .select({ biocharRatio: formulations.biocharRatio })
        .from(formulations)
        .where(
          and(
            eq(formulations.id, formulationId),
            eq(formulations.organizationId, ctx.organizationId),
          ),
        )
    : [];
  const biocharRatio = formulationRatioRow?.biocharRatio ?? null;
  const destinationBinId = data.storageLocationId;
  const ingredientDraws = getCompositionIngredientDraws(data.composition);
  const sourceBiocharMassKg = deriveCompositionSourceBiocharMassKg(
    massKg,
    data.composition,
  );
  if (sourceBiocharMassKg === null || sourceBiocharMassKg < 0) {
    throw new SafeError(SOURCE_BIOCHAR_MASS_ERROR);
  }
  if (sourceBiocharMassKg === 0) {
    throw new SafeError(ZERO_SOURCE_BIOCHAR_ERROR);
  }
  // The operator's moisture reading is a fresh measurement of the drawn
  // biochar, so it, not the bin's stored wet/dry ratio, fixes the dry mass
  // withdrawn from the source bin.
  const sourceBiocharDryMassKg = computeClampedDryMass(
    sourceBiocharMassKg,
    moistureContentPercent,
  );

  return db.transaction(async (tx) => {
    const sourceBinId =
      sourceBiocharStorageLocationId ??
      run?.biocharStorageLocationId ??
      null;
    await lockBinStocks(ctx, tx, [
      massKg > 0 ? destinationBinId : null,
      sourceBinId,
      ...ingredientDraws.map((draw) => draw.storageLocationId),
    ]);
    await validateCompositionIngredientBins(
      ctx,
      tx,
      data.composition,
      formulationId,
      data.facilityId,
    );
    const resolvedComposition =
      await resolveCompositionIngredientMassBasis(
        ctx,
        tx,
        data.composition,
      );

    let productionDate: Date;
    let linkedProductionRunId: string | null;
    let sourceAllocationPlan:
      | Awaited<
          ReturnType<
            typeof buildBiocharProductSourceAllocationPlan
          >
        >
      | null = null;

    if (sourceBiocharStorageLocationId) {
      sourceAllocationPlan =
        await buildBiocharProductSourceAllocationPlan(ctx, tx, {
          sourceStorageLocationId:
            sourceBiocharStorageLocationId,
          facilityId: data.facilityId,
          requestedWetMassKg: sourceBiocharMassKg,
          requestedDryMassKg: sourceBiocharDryMassKg,
        });
      productionDate =
        sourceAllocationPlan.productionDate ?? new Date();
      const [sourceAllocation] = sourceAllocationPlan.allocations;
      if (!sourceAllocation && sourceBiocharMassKg > 0) {
        throw new SafeError(
          "A positive product mass requires traceable biochar in the source bin.",
        );
      }
      // The legacy column can only represent a genuinely single-run product.
      // Commingled-bin products derive their complete provenance from the
      // allocation rows and deliberately leave this compatibility link empty.
      linkedProductionRunId =
        sourceAllocationPlan.allocations.length === 1
          ? sourceAllocation?.productionRunId ?? null
          : null;
    } else {
      if (!run) {
        throw new SafeError("Linked production run not found");
      }
      const [lockedRun] = await tx
        .select({
          id: productionRuns.id,
          facilityId: productionRuns.facilityId,
          status: productionRuns.status,
          date: productionRunDateExpr(),
          biocharStorageLocationId:
            productionRuns.biocharStorageLocationId,
        })
        .from(productionRuns)
        .where(
          and(
            eq(productionRuns.id, run.id),
            eq(productionRuns.organizationId, ctx.organizationId),
          ),
        )
        .for("update");
      if (!lockedRun) {
        throw new SafeError("Linked production run not found");
      }
      if (
        lockedRun.biocharStorageLocationId !==
        run.biocharStorageLocationId
      ) {
        throw new SafeError(
          "Stock changed while this operation was being prepared. Refresh and retry.",
        );
      }
      if (lockedRun.facilityId !== data.facilityId) {
        throw new SafeError(
          "Linked production run belongs to a different facility",
        );
      }
      if (
        lockedRun.status !==
        COMPLETED_PRODUCTION_RUN_STATUS
      ) {
        throw new SafeError(
          "Biochar products can only link to complete production runs",
        );
      }
      productionDate = runDateToProductionDate(lockedRun.date);
      linkedProductionRunId = data.linkedProductionRunId ?? null;
    }

    await assertCompositionIngredientDrawsWithinStock(
      ctx,
      tx,
      resolvedComposition,
    );

    const [storage] = await tx
      .select({
        id: storageLocations.id,
        facilityId: storageLocations.facilityId,
        type: storageLocations.type,
        formulationId: storageLocations.formulationId,
      })
      .from(storageLocations)
      .where(
        and(
          eq(storageLocations.id, destinationBinId),
          eq(storageLocations.organizationId, ctx.organizationId),
          isNull(storageLocations.archivedAt),
        ),
      )
      .for("update");

    if (!storage) {
      throw new SafeError("Storage bin not found");
    }
    if (storage.facilityId !== data.facilityId) {
      throw new SafeError(
        "Storage bin belongs to a different facility",
      );
    }
    if (storage.type !== "product_bin") {
      throw new SafeError("Storage bin must be a product bin");
    }
    if (
      storage.formulationId !== null &&
      storage.formulationId !== formulationId
    ) {
      throw new SafeError(
        "Product bin is reserved for a different formulation. Pick a matching or empty bin.",
      );
    }

    if (sourceBinId) {
      await assertBiocharDrawWithinStock(ctx, tx, {
        biocharStorageLocationId: sourceBinId,
        requestedBiocharKg: sourceBiocharMassKg,
        binLockAlreadyHeld: true,
      });
    }

    const [inserted] = await tx
      .insert(biocharProducts)
      .values({
        organizationId: ctx.organizationId,
        code: data.code,
        facilityId: data.facilityId,
        formulationId,
        biocharRatio: formulationId ? biocharRatio ?? 1 : null,
        productionDate,
        status: data.status ?? "testing",
        sourceBiocharStorageLocationId,
        linkedProductionRunId,
        storageLocationId: destinationBinId,
        massKg,
        moistureContentPercent,
        densityKgM3: data.densityKgM3 ?? null,
        waterAddedKg,
        composition: resolvedComposition,
      })
      .returning();

    if (
      sourceAllocationPlan &&
      sourceBiocharStorageLocationId
    ) {
      await insertBiocharProductSourceAllocations(ctx, tx, {
        biocharProductId: inserted.id,
        sourceStorageLocationId:
          sourceBiocharStorageLocationId,
        allocations: sourceAllocationPlan.allocations,
      });
    }

    if (formulationId && storage.formulationId === null) {
      await tx
        .update(storageLocations)
        .set({ formulationId, updatedAt: new Date() })
        .where(
          and(
            eq(storageLocations.id, destinationBinId),
            eq(storageLocations.organizationId, ctx.organizationId),
          ),
        );
    }

    return inserted;
  });
}
