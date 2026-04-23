"use server";

/**
 * Samples Server Actions
 * Server-side functions for sample CRUD operations
 */

import { z } from "zod";
import { samples } from "@/db/schema";
import { withAutoCode } from "@/data-access/code-generator";
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
import { getUser } from "@/lib/auth/server";
import {
  createSampleSchema,
  deleteSampleSchema,
  updateSampleSchema,
  sampleFilterSchema,
} from "@/schemas/samples";
import type { ActionResult } from "@/types/actions";

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
    const user = await getUser();
    if (!user?.id) {
      return { success: false, error: "Unauthorized" };
    }

    const validatedFilters = filters
      ? sampleFilterSchema.parse(filters)
      : undefined;
    const samples = await getSamplesData(user.id, validatedFilters);

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
      error:
        error instanceof Error ? error.message : "Failed to load samples",
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
    const user = await getUser();
    if (!user?.id) {
      return { success: false, error: "Unauthorized" };
    }

    const sample = await getSampleByIdData(user.id, sampleId);
    return { success: true, data: sample };
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : "Failed to load sample",
    };
  }
}

/**
 * Get sample statistics
 */
export async function getSampleStatsFn(
  productionRunId?: string,
  facilityId?: string,
): Promise<ActionResult<SampleStats>> {
  try {
    const user = await getUser();
    if (!user?.id) {
      return { success: false, error: "Unauthorized" };
    }

    const validatedProductionRunId = productionRunId
      ? z.string().uuid().parse(productionRunId)
      : undefined;
    const validatedFacilityId = facilityId
      ? z.string().uuid().parse(facilityId)
      : undefined;
    const stats = await getSampleStatsData(
      user.id,
      validatedProductionRunId,
      validatedFacilityId,
    );
    return { success: true, data: stats };
  } catch (error) {
    return {
      success: false,
      error:
        error instanceof Error ? error.message : "Failed to load sample stats",
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
    const user = await getUser();
    if (!user?.id) {
      return { success: false, error: "Unauthorized" };
    }

    const available = await isSampleCodeAvailableData(
      user.id,
      code,
      excludeSampleId
    );
    return { success: true, data: { available } };
  } catch (error) {
    return {
      success: false,
      error:
        error instanceof Error
          ? error.message
          : "Failed to check sample code",
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
    const user = await getUser();
    if (!user?.id) {
      return { success: false, error: "Unauthorized" };
    }

    const code = await generateNextSampleCodeData(user.id);
    return { success: true, data: { code } };
  } catch (error) {
    return {
      success: false,
      error:
        error instanceof Error
          ? error.message
          : "Failed to generate sample code",
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
    const user = await getUser();
    if (!user?.id) {
      return { success: false, error: "Unauthorized" };
    }

    const sample = await withAutoCode(
      "SAM",
      samples,
      samples.sampleCode,
      undefined,
      async (sampleCode) => {
        const validated = createSampleSchema.parse({ ...data, sampleCode });
        return createSample(user.id, {
          sampleCode,
          productionRunId: validated.productionRunId,
          samplingTime:
            validated.samplingTime instanceof Date
              ? validated.samplingTime
              : new Date(validated.samplingTime),
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
      error:
        error instanceof Error ? error.message : "Failed to create sample",
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
    const user = await getUser();
    if (!user?.id) {
      return { success: false, error: "Unauthorized" };
    }

    const validated = updateSampleSchema.parse(data);

    const sample = await updateSample(user.id, validated.sampleId, {
      sampleCode: validated.sampleCode,
      productionRunId: validated.productionRunId,
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
      error:
        error instanceof Error ? error.message : "Failed to update sample",
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
    const user = await getUser();
    if (!user?.id) {
      return { success: false, error: "Unauthorized" };
    }

    const validated = deleteSampleSchema.parse(data);
    await deleteSample(user.id, validated.sampleId);

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
      error:
        error instanceof Error ? error.message : "Failed to delete sample",
    };
  }
}
