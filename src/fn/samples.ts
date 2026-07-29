"use server";

/**
 * Samples Server Actions
 * Server-side functions for sample CRUD operations
 */

import { z } from "zod";
import { samples } from "@/db/schema";
import { withAutoCode } from "@/data-access/code-generator";
import { getCreditBatchById } from "@/data-access/credit-batches";
import { getFacilityById } from "@/data-access/facilities";
import { requireOrgFacility } from "@/data-access/utils";
import {
  createSample,
  deleteSample,
  getSamples as getSamplesData,
  getSampleById as getSampleByIdData,
  getSampleStats as getSampleStatsData,
  updateSample,
  isSampleCodeAvailable as isSampleCodeAvailableData,
  generateNextSampleCode as generateNextSampleCodeData,
  type PaginatedSamples,
  type SampleWithRelations,
  type SampleStats,
} from "@/data-access/samples";
import { requireOrgContext } from "@/lib/auth/server";
import { formatFacilityDate } from "@/lib/date-utils";
import { SafeError } from "@/lib/errors";
import {
  createSampleSchema,
  deleteSampleSchema,
  updateSampleSchema,
  sampleFilterSchema,
} from "@/schemas/samples";
import type { ActionResult } from "@/types/actions";
import { toLoggedActionError } from "./action-errors";

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

async function assertSampleNotBeforeBatchWindow(
  ctx: Awaited<ReturnType<typeof requireOrgContext>>,
  creditBatchId: string,
  samplingTime: Date,
): Promise<void> {
  const batch = await getCreditBatchById(ctx, creditBatchId, {
    skipPreview: true,
  });
  if (!batch) throw new SafeError("Credit batch not found");

  const facility = await getFacilityById(ctx, batch.facilityId);
  const samplingDay = formatFacilityDate(samplingTime, facility.timezone);
  if (samplingDay < batch.startDate) {
    throw new SafeError(
      `Sample date ${samplingDay} is before credit batch ${batch.code}'s production window, ${batch.startDate} to ${batch.endDate}. Choose a date within or after the production window.`,
    );
  }
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
        error: `Invalid filter parameters: ${error.issues.map((e) => e.message).join(", ")}`,
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

/**
 * Check if a sample code is available
 */
export async function checkSampleCodeFn(
  code: string,
  excludeSampleId?: string
): Promise<ActionResult<{ available: boolean }>> {
  try {
    const ctx = await requireOrgContext();

    const available = await isSampleCodeAvailableData(
      ctx,
      code,
      excludeSampleId
    );
    return { success: true, data: { available } };
  } catch (error) {
    return {
      success: false,
      error: sampleActionError(
        error,
        "Failed to check sample code",
        "sample:check-code",
      ),
    };
  }
}

/**
 * Generate next sample code
 */
export async function generateNextSampleCodeFn(): Promise<
  ActionResult<{ code: string }>
> {
  try {
    const ctx = await requireOrgContext();

    const code = await generateNextSampleCodeData(ctx);
    return { success: true, data: { code } };
  } catch (error) {
    return {
      success: false,
      error: sampleActionError(
        error,
        "Failed to generate sample code",
        "sample:generate-code",
      ),
    };
  }
}

// ============================================
// Create Operations
// ============================================

/**
 * Create a new sample
 */
export async function createSampleFn(
  data: z.infer<typeof createSampleSchema>
): Promise<ActionResult<SampleWithRelations>> {
  try {
    const ctx = await requireOrgContext();

    const sample = await withAutoCode(
      ctx,
      "SAM",
      samples,
      samples.sampleCode,
      undefined,
      async (sampleCode) => {
        const validated = createSampleSchema.parse({ ...data, sampleCode });
        const samplingTime =
          validated.samplingTime instanceof Date
            ? validated.samplingTime
            : new Date(validated.samplingTime);
        await assertSampleNotBeforeBatchWindow(
          ctx,
          validated.creditBatchId,
          samplingTime,
        );
        return createSample(ctx, {
          sampleCode,
          creditBatchId: validated.creditBatchId,
          samplingTime,
          labName: validated.labName || null,
          labAccreditation: validated.labAccreditation || null,
          analysisDate: validated.analysisDate
            ? validated.analysisDate instanceof Date
              ? validated.analysisDate
              : new Date(validated.analysisDate)
            : null,
          weightGrams: validated.weightGrams ?? null,
          volumeMl: validated.volumeMl ?? null,
          totalCarbonPercent: validated.totalCarbonPercent as number,
          organicCarbonPercent: validated.organicCarbonPercent as number,
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
      hToCOrgRatio: validated.hToCOrgRatio ?? null,
      oToCOrgRatio: validated.oToCOrgRatio ?? null,
      randomReflectanceR0Percent: validated.randomReflectanceR0Percent ?? null,
      sReflectanceFraction: validated.sReflectanceFraction ?? null,
      r0MeasurementCount: validated.r0MeasurementCount ?? null,
      r0AnalysisDate: validated.r0AnalysisDate
        ? validated.r0AnalysisDate instanceof Date
          ? validated.r0AnalysisDate
          : new Date(validated.r0AnalysisDate)
        : null,
      r0HistogramFileUrl: validated.r0HistogramFileUrl || null,
      reactiveCarbonPercent: validated.reactiveCarbonPercent ?? null,
      residualCarbonPercent: validated.residualCarbonPercent ?? null,
      tgaAnalysisDate: validated.tgaAnalysisDate
        ? validated.tgaAnalysisDate instanceof Date
          ? validated.tgaAnalysisDate
          : new Date(validated.tgaAnalysisDate)
        : null,
      tgaThermogramFileUrl: validated.tgaThermogramFileUrl || null,
      phosphorusPercent: validated.phosphorusPercent ?? null,
      potassiumPercent: validated.potassiumPercent ?? null,
      magnesiumPercent: validated.magnesiumPercent ?? null,
      calciumPercent: validated.calciumPercent ?? null,
      ironPercent: validated.ironPercent ?? null,
        });
      }
    );

    return { success: true, data: sample };
  } catch (error) {
    if (error instanceof z.ZodError) {
      return {
        success: false,
        error: `Validation error: ${error.issues.map((e) => e.message).join(", ")}`,
      };
    }
    return {
      success: false,
      error: sampleActionError(
        error,
        "Failed to create sample",
        "sample:create",
      ),
    };
  }
}

// ============================================
// Update Operations
// ============================================

/**
 * Update an existing sample
 */
export async function updateSampleFn(
  data: z.infer<typeof updateSampleSchema>
): Promise<ActionResult<SampleWithRelations>> {
  try {
    const ctx = await requireOrgContext();

    const validated = updateSampleSchema.parse(data);

    if (validated.creditBatchId !== undefined || validated.samplingTime !== undefined) {
      const existing = await getSampleByIdData(ctx, validated.sampleId);
      const creditBatchId = validated.creditBatchId ?? existing.creditBatchId;
      const samplingTime = validated.samplingTime ?? existing.samplingTime;
      if (creditBatchId != null) {
        await assertSampleNotBeforeBatchWindow(ctx, creditBatchId, samplingTime);
      }
    }

    const sample = await updateSample(ctx, validated.sampleId, {
      sampleCode: validated.sampleCode,
      creditBatchId: validated.creditBatchId,
      samplingTime: validated.samplingTime
        ? validated.samplingTime instanceof Date
          ? validated.samplingTime
          : new Date(validated.samplingTime)
        : undefined,
      labName: validated.labName,
      labAccreditation: validated.labAccreditation,
      analysisDate: validated.analysisDate
        ? validated.analysisDate instanceof Date
          ? validated.analysisDate
          : typeof validated.analysisDate === "string"
          ? new Date(validated.analysisDate)
          : null
        : validated.analysisDate === null
        ? null
        : undefined,
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
      hToCOrgRatio: validated.hToCOrgRatio,
      oToCOrgRatio: validated.oToCOrgRatio,
      randomReflectanceR0Percent: validated.randomReflectanceR0Percent,
      sReflectanceFraction: validated.sReflectanceFraction,
      r0MeasurementCount: validated.r0MeasurementCount,
      r0AnalysisDate: validated.r0AnalysisDate
        ? validated.r0AnalysisDate instanceof Date
          ? validated.r0AnalysisDate
          : typeof validated.r0AnalysisDate === "string"
          ? new Date(validated.r0AnalysisDate)
          : null
        : validated.r0AnalysisDate === null
        ? null
        : undefined,
      r0HistogramFileUrl: validated.r0HistogramFileUrl,
      reactiveCarbonPercent: validated.reactiveCarbonPercent,
      residualCarbonPercent: validated.residualCarbonPercent,
      tgaAnalysisDate: validated.tgaAnalysisDate
        ? validated.tgaAnalysisDate instanceof Date
          ? validated.tgaAnalysisDate
          : typeof validated.tgaAnalysisDate === "string"
          ? new Date(validated.tgaAnalysisDate)
          : null
        : validated.tgaAnalysisDate === null
        ? null
        : undefined,
      tgaThermogramFileUrl: validated.tgaThermogramFileUrl,
      phosphorusPercent: validated.phosphorusPercent,
      potassiumPercent: validated.potassiumPercent,
      magnesiumPercent: validated.magnesiumPercent,
      calciumPercent: validated.calciumPercent,
      ironPercent: validated.ironPercent,
    });

    return { success: true, data: sample };
  } catch (error) {
    if (error instanceof z.ZodError) {
      return {
        success: false,
        error: `Validation error: ${error.issues.map((e) => e.message).join(", ")}`,
      };
    }
    return {
      success: false,
      error: sampleActionError(
        error,
        "Failed to update sample",
        "sample:update",
      ),
    };
  }
}

// ============================================
// Delete Operations
// ============================================

/**
 * Delete a sample
 */
export async function deleteSampleFn(
  data: z.infer<typeof deleteSampleSchema>
): Promise<ActionResult<void>> {
  try {
    const ctx = await requireOrgContext();

    const validated = deleteSampleSchema.parse(data);
    await deleteSample(ctx, validated.sampleId);

    return { success: true, data: undefined };
  } catch (error) {
    if (error instanceof z.ZodError) {
      return {
        success: false,
        error: `Validation error: ${error.issues.map((e) => e.message).join(", ")}`,
      };
    }
    return {
      success: false,
      error: sampleActionError(
        error,
        "Failed to delete sample",
        "sample:delete",
      ),
    };
  }
}
