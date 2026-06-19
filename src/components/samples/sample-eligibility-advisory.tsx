import { Warning } from "@phosphor-icons/react/dist/ssr";
import {
  H_TO_C_ORG_ELIGIBILITY_MAX,
  O_TO_C_ORG_ELIGIBILITY_MAX,
} from "@/lib/calculations/biochar-eligibility";

interface SampleEligibilityAdvisoryProps {
  /** Resolved molar H/C_org for this replicate (calculated or entered), if any. */
  hToCOrgRatio: number | null | undefined;
  /** Molar O/C_org for this replicate, if any. */
  oToCOrgRatio: number | null | undefined;
}

/**
 * Non-blocking biochar eligibility advisory (module §3 Table 2): flags a
 * replicate that breaches the H/C_org < 0.5 or O/C_org < 0.2 ceiling. Per D8,
 * eligibility is judged on the production run's replicate MEAN, so this is an
 * outlier flag, not a form error — a run failing on its mean is blocked at
 * submission by the durability gates. Renders nothing when within the ceilings.
 */
export function SampleEligibilityAdvisory({
  hToCOrgRatio,
  oToCOrgRatio,
}: SampleEligibilityAdvisoryProps) {
  const breaches: string[] = [];
  if (
    typeof hToCOrgRatio === "number" &&
    Number.isFinite(hToCOrgRatio) &&
    hToCOrgRatio >= H_TO_C_ORG_ELIGIBILITY_MAX
  ) {
    breaches.push(
      `H/C_org ${hToCOrgRatio.toFixed(3)} ≥ ${H_TO_C_ORG_ELIGIBILITY_MAX}`,
    );
  }
  if (
    typeof oToCOrgRatio === "number" &&
    Number.isFinite(oToCOrgRatio) &&
    oToCOrgRatio >= O_TO_C_ORG_ELIGIBILITY_MAX
  ) {
    breaches.push(
      `O/C_org ${oToCOrgRatio.toFixed(3)} ≥ ${O_TO_C_ORG_ELIGIBILITY_MAX}`,
    );
  }

  if (breaches.length === 0) return null;

  return (
    <div
      role="status"
      className="flex items-start gap-8 border border-[var(--st-wait-border)] bg-[var(--st-wait-bg)] p-12"
    >
      <Warning
        size={16}
        weight="fill"
        aria-hidden
        className="mt-1 shrink-0 text-[var(--color-signal-orange)]"
      />
      <p className="body-caption text-[var(--color-text-secondary)]">
        This replicate exceeds the biochar eligibility ceiling (
        {breaches.join("; ")}). Eligibility is judged on the production
        run&apos;s replicate mean (H/C_org &lt; {H_TO_C_ORG_ELIGIBILITY_MAX} and
        O/C_org &lt; {O_TO_C_ORG_ELIGIBILITY_MAX}, module §3 Table 2) — review for
        an outlier. A run failing on its mean is blocked at submission.
      </p>
    </div>
  );
}
