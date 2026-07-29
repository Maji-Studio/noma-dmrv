"use client";

import { useMutation } from "@tanstack/react-query";
import {
  normalizeGisBoundaryFn,
  type NormalizeGisBoundaryActionResult,
} from "@/fn/gis-boundary";

export interface NormalizeGisBoundaryInput {
  text: string;
  source: "upload" | "paste";
  fileName?: string;
}

export function useNormalizeGisBoundary() {
  return useMutation<
    NormalizeGisBoundaryActionResult,
    Error,
    NormalizeGisBoundaryInput
  >({
    mutationFn: normalizeGisBoundaryFn,
  });
}
