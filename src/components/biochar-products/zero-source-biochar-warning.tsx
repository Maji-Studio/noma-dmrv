import { Notice } from "@/components/ui/notice";
import { ZERO_SOURCE_BIOCHAR_WARNING } from "@/lib/biochar-composition";

interface ZeroSourceBiocharWarningProps {
  sourceBiocharMassKg: number | null | undefined;
}

/** Blocks silent use of legacy products whose blend contains no biochar. */
export function ZeroSourceBiocharWarning({
  sourceBiocharMassKg,
}: ZeroSourceBiocharWarningProps) {
  if (sourceBiocharMassKg !== 0) return null;

  return <Notice tone="error">{ZERO_SOURCE_BIOCHAR_WARNING}</Notice>;
}
