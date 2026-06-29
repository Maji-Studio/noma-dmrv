/**
 * EnvBanner
 * Ambient environment indicator. Sandbox is informational (yellow); production
 * is high-attention (red border) so operators always know which Isometric
 * environment a write will hit.
 */
"use client";

import { ShieldWarningIcon, TestTubeIcon } from "@phosphor-icons/react";

interface EnvBannerProps {
  isProduction: boolean;
  /** Optional override for environments where mapping data hasn't loaded yet. */
  isLoading?: boolean;
  /** Compact variant for inline use inside dialogs. */
  variant?: "page" | "inline";
}

export function EnvBanner({
  isProduction,
  isLoading = false,
  variant = "page",
}: EnvBannerProps) {
  if (isLoading) return null;

  const isInline = variant === "inline";

  if (isProduction) {
    return (
      <div
        role="status"
        aria-live="polite"
        className={[
          "flex items-center gap-12 border-l-4 border-[var(--clr-red)]",
          "bg-[var(--clr-red-10)] text-[var(--color-text-primary)]",
          isInline ? "px-12 py-8" : "px-16 py-12",
        ].join(" ")}
      >
        <ShieldWarningIcon
          size={isInline ? 16 : 20}
          weight="fill"
          className="shrink-0 text-[var(--clr-red)]"
        />
        <div className="flex flex-col gap-2 min-w-0">
          <span className="title-chapter-title text-[var(--clr-red)]">
            Production · Isometric registry
          </span>
          {!isInline && (
            <span className="body-small text-[var(--color-text-secondary)]">
              Submissions from this facility are visible to verifiers and create
              real registry records.
            </span>
          )}
        </div>
      </div>
    );
  }

  return (
    <div
      role="status"
      aria-live="polite"
      className={[
        "flex items-center gap-12 border border-[var(--clr-orange-40)]",
        "bg-[var(--clr-orange-10)] text-[var(--color-text-primary)]",
        isInline ? "px-12 py-8" : "px-16 py-12",
      ].join(" ")}
    >
      <TestTubeIcon
        size={isInline ? 16 : 20}
        weight="fill"
        className="shrink-0 text-[var(--color-signal-orange)]"
      />
      <div className="flex flex-col gap-2 min-w-0">
        <span className="title-chapter-title text-[var(--color-signal-orange)]">
          Sandbox · Isometric registry
        </span>
        {!isInline && (
          <span className="body-small text-[var(--color-text-secondary)]">
            Changes don&apos;t reach the verifier. Use this environment to
            rehearse the workflow.
          </span>
        )}
      </div>
    </div>
  );
}
