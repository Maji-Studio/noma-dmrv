"use server";

import { withAction } from "./with-action";

/**
 * Samples Server Actions
 * Server-side functions for sample CRUD operations
 */

import { z } from "zod";
import { requireOrgFacility } from "@/data-access/utils";
import {
  getSamples as getSamplesData,
  getSampleById as getSampleByIdData,
  getSampleStats as getSampleStatsData,
  type PaginatedSamples,
  type SampleWithRelations,
  type SampleStats,
} from "@/data-access/samples";
import { requireOrgContext } from "@/lib/auth/server";
import { deleteLabSample, recordLabSample, updateLabSample } from "@/lib/operations/lab-samples";
import { runOperationInProcess } from "@/lib/operations/runner";
import {
  createSampleSchema,
  deleteSampleSchema,
  updateSampleSchema,
  sampleFilterSchema,
} from "@/schemas/samples";
import type { ActionResult } from "@/types/actions";
import {
  formatZodActionError,
  toLoggedActionError,
} from "./action-errors";

function sampleActionError(
  error: unknown,
  fallbackMessage: string,
  op: string,
): string {
  return toLoggedActionError(error, fallbackMessage, {
    message: "sample action failed",
    context: { op },
  });
}

/** Keep the per-operation log context the legacy actions emitted. */
function logFor(op: string) {
  return { message: "sample action failed", context: { op } };
}

// ============================================
// List/Query Operations
// ============================================

/**
 * Get paginated list of samples with filtering
 */
export async function getSamplesFn(
  filters?: Partial<z.infer<typeof sampleFilterSchema>>
): Promise<ActionResult<PaginatedSamples>> {
  try {
    const ctx = await requireOrgContext();

    const validatedFilters = filters
      ? sampleFilterSchema.parse(filters)
      : undefined;
    if (validatedFilters?.facilityId) {
      await requireOrgFacility(ctx, validatedFilters.facilityId);
    }
    const samples = await getSamplesData(ctx, validatedFilters);

    return { success: true, data: samples };
  } catch (error) {
    if (error instanceof z.ZodError) {
      return {
        success: false,
        error: formatZodActionError(error, "Invalid filter parameters"),
      };
    }
    return {
      success: false,
      error: sampleActionError(
        error,
        "Failed to load samples",
        "sample:list",
      ),
    };
  }
}

/**
 * Get a single sample by ID
 */
export async function getSampleByIdFn(
  sampleId: string
): Promise<ActionResult<SampleWithRelations>> {
  try {
    const ctx = await requireOrgContext();

    const sample = await getSampleByIdData(ctx, sampleId);
    return { success: true, data: sample };
  } catch (error) {
    return {
      success: false,
      error: sampleActionError(
        error,
        "Failed to load sample",
        "sample:get",
      ),
    };
  }
}

/**
 * Get sample statistics
 */
export async function getSampleStatsFn(
  creditBatchId?: string,
  facilityId?: string,
): Promise<ActionResult<SampleStats>> {
  try {
    const ctx = await requireOrgContext();

    const validatedCreditBatchId = creditBatchId
      ? z.string().uuid().parse(creditBatchId)
      : undefined;
    const validatedFacilityId = facilityId
      ? z.string().uuid().parse(facilityId)
      : undefined;
    if (validatedFacilityId) {
      await requireOrgFacility(ctx, validatedFacilityId);
    }
    const stats = await getSampleStatsData(
      ctx,
      validatedCreditBatchId,
      validatedFacilityId,
    );
    return { success: true, data: stats };
  } catch (error) {
    return {
      success: false,
      error: sampleActionError(
        error,
        "Failed to load sample stats",
        "sample:stats",
      ),
    };
  }
}

// ============================================
// Create Operations
// ============================================

/**
 * Create a new sample through `record_lab_sample`, as the API does. The
 * server generates the code and calculates H/C_org and O/C_org; the form's
 * own preview of them is not sent. Form-only fields (durability tier mirror,
 * nutrient toggle, file URLs without an input) stay behind.
 */
export async function createSampleFn(
  data: z.infer<typeof createSampleSchema>
): Promise<ActionResult<SampleWithRelations>> {
  return withAction(async (ctx) => {
    const validated = createSampleSchema.parse(data);
    const result = await runOperationInProcess(recordLabSample, ctx, {
      creditBatchId: validated.creditBatchId,
      samplingTime: validated.samplingTime,
      labName: validated.labName || null,
      labAccreditation: validated.labAccreditation || null,
      analysisDate: validated.analysisDate ?? null,
      weightGrams: validated.weightGrams ?? null,
      volumeMl: validated.volumeMl ?? null,
      totalCarbonPercent: validated.totalCarbonPercent,
      organicCarbonPercent: validated.organicCarbonPercent,
      inorganicCarbonPercent: validated.inorganicCarbonPercent ?? null,
      totalHydrogenPercent: validated.totalHydrogenPercent ?? null,
      totalNitrogenPercent: validated.totalNitrogenPercent ?? null,
      totalOxygenPercent: validated.totalOxygenPercent ?? null,
      totalSulfurPercent: validated.totalSulfurPercent ?? null,
      ashContentPercent: validated.ashContentPercent ?? null,
      moistureContentPercent: validated.moistureContentPercent ?? null,
      bulkDensityKgPerM3: validated.bulkDensityKgPerM3 ?? null,
      ph: validated.ph ?? null,
      saltContentGPerKg: validated.saltContentGPerKg ?? null,
      oToCOrgRatio: validated.oToCOrgRatio ?? null,
      randomReflectanceR0Percent: validated.randomReflectanceR0Percent ?? null,
      sReflectanceFraction: validated.sReflectanceFraction ?? null,
      r0MeasurementCount: validated.r0MeasurementCount ?? null,
      r0AnalysisDate: validated.r0AnalysisDate ?? null,
      reactiveCarbonPercent: validated.reactiveCarbonPercent ?? null,
      residualCarbonPercent: validated.residualCarbonPercent ?? null,
      tgaAnalysisDate: validated.tgaAnalysisDate ?? null,
      phosphorusPercent: validated.phosphorusPercent ?? null,
      potassiumPercent: validated.potassiumPercent ?? null,
      magnesiumPercent: validated.magnesiumPercent ?? null,
      calciumPercent: validated.calciumPercent ?? null,
      ironPercent: validated.ironPercent ?? null,
    });
    return result.sample;
  }, { fallbackMessage: "Failed to create sample", log: logFor("sample:create") });
}

// ============================================
// Update Operations
// ============================================

/**
 * Update an existing sample through `update_lab_sample`. Omitted fields keep
 * their stored value and null clears one; the ratios are recalculated from
 * the merged row.
 */
export async function updateSampleFn(
  data: z.infer<typeof updateSampleSchema>
): Promise<ActionResult<SampleWithRelations>> {
  return withAction(async (ctx) => {
    const validated = updateSampleSchema.parse(data);
    const result = await runOperationInProcess(updateLabSample, ctx, {
      labSampleId: validated.sampleId,
      expectedVersion: validated.expectedVersion,
      code: validated.sampleCode,
      creditBatchId: validated.creditBatchId,
      samplingTime: validated.samplingTime,
      labName: validated.labName,
      labAccreditation: validated.labAccreditation,
      analysisDate: validated.analysisDate,
      weightGrams: validated.weightGrams,
      volumeMl: validated.volumeMl,
      totalCarbonPercent: validated.totalCarbonPercent,
      organicCarbonPercent: validated.organicCarbonPercent,
      inorganicCarbonPercent: validated.inorganicCarbonPercent,
      totalHydrogenPercent: validated.totalHydrogenPercent,
      totalNitrogenPercent: validated.totalNitrogenPercent,
      totalOxygenPercent: validated.totalOxygenPercent,
      totalSulfurPercent: validated.totalSulfurPercent,
      ashContentPercent: validated.ashContentPercent,
      moistureContentPercent: validated.moistureContentPercent,
      bulkDensityKgPerM3: validated.bulkDensityKgPerM3,
      ph: validated.ph,
      saltContentGPerKg: validated.saltContentGPerKg,
      oToCOrgRatio: validated.oToCOrgRatio,
      randomReflectanceR0Percent: validated.randomReflectanceR0Percent,
      sReflectanceFraction: validated.sReflectanceFraction,
      r0MeasurementCount: validated.r0MeasurementCount,
      r0AnalysisDate: validated.r0AnalysisDate,
      reactiveCarbonPercent: validated.reactiveCarbonPercent,
      residualCarbonPercent: validated.residualCarbonPercent,
      tgaAnalysisDate: validated.tgaAnalysisDate,
      phosphorusPercent: validated.phosphorusPercent,
      potassiumPercent: validated.potassiumPercent,
      magnesiumPercent: validated.magnesiumPercent,
      calciumPercent: validated.calciumPercent,
      ironPercent: validated.ironPercent,
    });
    return result.sample;
  }, { fallbackMessage: "Failed to update sample", log: logFor("sample:update") });
}

// ============================================
// Delete Operations
// ============================================

/**
 * Delete a sample through `delete_lab_sample`.
 */
export async function deleteSampleFn(
  data: z.infer<typeof deleteSampleSchema>
): Promise<ActionResult<void>> {
  return withAction(async (ctx) => {
    const validated = deleteSampleSchema.parse(data);
    await runOperationInProcess(deleteLabSample, ctx, {
      labSampleId: validated.sampleId,
      expectedVersion: validated.expectedVersion,
    });
  }, { fallbackMessage: "Failed to delete sample", log: logFor("sample:delete") });
}
