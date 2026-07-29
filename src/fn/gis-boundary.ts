"use server";

import { z } from "zod";
import { GIS_BOUNDARY_NORMALIZE_RATE_LIMIT } from "@/config/geo";
import { normalizeGeoJson } from "@/lib/geojson/normalize";
import type {
  GeoJsonIssueLocation,
  GisBoundary,
  NormalizeGeoJsonResult,
} from "@/lib/geojson/types";
import type { ActionResult } from "@/types/actions";
import { withAction } from "./with-action";

const normalizeGisBoundaryInputSchema = z.object({
  text: z.string().min(1, "Paste GeoJSON or choose a GeoJSON file"),
  source: z.enum(["upload", "paste"]),
  fileName: z.string().min(1).max(255).optional(),
});

export type NormalizeGisBoundaryActionResult =
  | { success: true; data: GisBoundary }
  | {
      success: false;
      error: string;
      location?: GeoJsonIssueLocation;
    };

/**
 * Authenticate the operator and normalize boundary text without writing it.
 * The returned envelope is persisted later through application create/update.
 */
export async function normalizeGisBoundaryFn(
  input: z.infer<typeof normalizeGisBoundaryInputSchema>,
): Promise<NormalizeGisBoundaryActionResult> {
  const actionResult: ActionResult<NormalizeGeoJsonResult> = await withAction(
    async () => normalizeGeoJson(normalizeGisBoundaryInputSchema.parse(input)),
    {
      zodErrorPrefix: "Boundary validation failed",
      rateLimit: GIS_BOUNDARY_NORMALIZE_RATE_LIMIT,
    },
  );

  if (!actionResult.success) return actionResult;
  if (!actionResult.data.ok) {
    return {
      success: false,
      error: actionResult.data.error,
      location: actionResult.data.location,
    };
  }
  return { success: true, data: actionResult.data.boundary };
}
