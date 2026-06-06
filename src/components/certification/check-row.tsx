/**
 * CheckRow — one row of a certification checklist (icon · label · detail · fix
 * link). Shared by the removal-level requirements step
 * (`new-removal-dialog/requirements-step.tsx`) and the batch-level health panel
 * (`credit-batches/credit-batch-health-panel.tsx`) so the two surfaces can never
 * disagree on how a met/unmet/skipped check renders. Both feed status unions
 * structurally equal to `CheckStatus`.
 */
"use client";

import type { ElementType, ReactNode } from "react";
import Link from "next/link";
import { CheckCircle, Circle, Warning } from "@phosphor-icons/react/dist/ssr";

export type CheckStatus = "met" | "unmet" | "skipped";

const STATUS_ICON: Record<CheckStatus, ElementType> = {
  met: CheckCircle,
  unmet: Warning,
  skipped: Circle,
};

const STATUS_COLOR: Record<CheckStatus, string> = {
  met: "var(--color-signal-green)",
  unmet: "var(--color-signal-orange)",
  skipped: "var(--color-text-tertiary)",
};

interface FixLink {
  label: string;
  href: string;
}

interface CheckRowProps {
  status: CheckStatus;
  label: string;
  detail?: string | null;
  /** First row omits the top divider. */
  isFirst: boolean;
  /** Horizontal padding — requirements step uses 16, the health panel 20. */
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
        <span className="body-small text-[var(--color-text-primary)]">
          {label}
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
