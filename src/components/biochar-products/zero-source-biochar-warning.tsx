import { WarningIcon } from "@phosphor-icons/react/dist/ssr";
import { ZERO_SOURCE_BIOCHAR_WARNING } from "@/lib/biochar-composition";

interface ZeroSourceBiocharWarningProps {
  sourceBiocharMassKg: number | null | undefined;
}

/** Blocks silent use of legacy products whose blend contains no biochar. */
export function ZeroSourceBiocharWarning({
  sourceBiocharMassKg,
}: ZeroSourceBiocharWarningProps) {
  if (sourceBiocharMassKg !== 0) return null;

  return (
    <div
      role="alert"
      className="flex items-start gap-8 border border-[var(--st-wait-border)] bg-[var(--st-wait-bg)] p-12"
    >
      <WarningIcon
        size={16}
        weight="fill"
        aria-hidden
        className="mt-1 shrink-0 text-[var(--st-wait)]"
      />
      <p className="body-caption text-[var(--color-text-secondary)]">
        {ZERO_SOURCE_BIOCHAR_WARNING}
      </p>
    </div>
  );
}
