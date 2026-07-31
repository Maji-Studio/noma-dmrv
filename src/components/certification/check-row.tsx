/**
 * CheckRow — one row of a certification checklist (icon · label · detail · fix
 * link). Shared by the removal-level requirements shown on the wizard's
 * confirm-&-submit step (`new-removal-dialog/submit-step.tsx`) and the
 * batch-level health strip (`credit-batches/credit-batch-health-strip.tsx`) so
 * the two surfaces can never disagree on how a met/unmet/skipped check renders.
 * Both feed status unions structurally equal to `CheckStatus`.
 */
"use client";

import type { ReactNode } from "react";
import type { Icon } from "@phosphor-icons/react";
import Link from "next/link";
import { CheckCircleIcon, CircleIcon, WarningIcon } from "@phosphor-icons/react/dist/ssr";
import { InfoHint } from "@/components/ui/tooltip";

export type CheckStatus = "met" | "unmet" | "skipped" | "warning" | "active";

const STATUS_ICON: Record<CheckStatus, Icon> = {
  met: CheckCircleIcon,
  unmet: WarningIcon,
  skipped: CircleIcon,
  warning: WarningIcon,
  active: CircleIcon,
};

/**
 * `met` uses the status ramp (`--st-ok`); the amber rows still use the legacy
 * `--color-signal-orange`, which is live in ~40 places app-wide and is not part
 * of this pass. Move all four to the ramp in one app-wide edit, not here alone.
 * `active` marks the current step of a sequential workflow (GHG statement
 * detail) and takes the in-progress ramp step.
 */
const STATUS_COLOR: Record<CheckStatus, string> = {
  met: "var(--st-ok)",
  unmet: "var(--color-signal-orange)",
  skipped: "var(--color-text-tertiary)",
  warning: "var(--color-signal-orange)",
  active: "var(--st-run)",
};

interface FixLink {
  label: string;
  href: string;
}

interface CheckRowProps {
  status: CheckStatus;
  label: string;
  detail?: ReactNode;
  /**
   * Protocol/registry reasoning for this requirement, revealed behind an ⓘ
   * "Why?" affordance next to the label so the raw vocabulary (R₀, tonne·km,
   * § citations) stays off the primary line (Phase 1).
   */
  whyDetail?: string;
  /** First row omits the top divider. */
  isFirst: boolean;
  /** Horizontal padding — requirements step uses 16, the health strip 20. */
  paddingX?: 16 | 20;
  /** Standard "fix this" link, rendered when present. */
  fix?: FixLink | null;
  /** Extra trailing content (e.g. the health panel's facility-setup link). */
  children?: ReactNode;
}

export function CheckRow({
  status,
  label,
  detail,
  whyDetail,
  isFirst,
  paddingX = 16,
  fix,
  children,
}: CheckRowProps) {
  const Icon = STATUS_ICON[status];
  const px = paddingX === 20 ? "px-20" : "px-16";
  return (
    <li
      className={`flex items-start gap-12 ${px} py-12 ${
        isFirst ? "" : "border-t border-[var(--color-border-tertiary)]"
      }`}
    >
      <Icon
        size={18}
        weight={status === "skipped" ? "regular" : "fill"}
        aria-hidden
        className="mt-px shrink-0"
        style={{ color: STATUS_COLOR[status] }}
      />
      <div className="flex min-w-0 flex-1 flex-col gap-2">
        <span className="inline-flex items-center gap-6 body-small text-[var(--color-text-primary)]">
          {label}
          {whyDetail && <InfoHint label="Why is this required?">{whyDetail}</InfoHint>}
        </span>
        {detail && (
          <span className="body-caption text-[var(--color-text-secondary)]">
            {detail}
          </span>
        )}
      </div>
      {fix && (
        <Link
          href={fix.href}
          className="shrink-0 self-center body-caption font-medium text-[var(--color-interaction)] underline-offset-2 hover:underline"
        >
          {fix.label}
        </Link>
      )}
      {children}
    </li>
  );
}
