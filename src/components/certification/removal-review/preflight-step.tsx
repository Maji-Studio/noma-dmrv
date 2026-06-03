/**
 * PreflightStep — step 4 of the removal Review flow. Renders the shared
 * `buildRemovalPreflightChecklist` as a met/unmet checklist plus the overall
 * `deriveRemovalReadiness` verdict. This is the canonical home of the blocker
 * logic the credit-batch Certify panel duplicates inline (superseded once the
 * panel is demoted to a read-only bridge in Stage 6).
 */
"use client";

import type { ElementType } from "react";
import { CheckCircle, Circle, Warning } from "@phosphor-icons/react/dist/ssr";
import type {
  PreflightCheck,
  PreflightCheckStatus,
  RemovalReadiness,
} from "@/lib/certification/readiness";

const STATUS_ICON: Record<PreflightCheckStatus, ElementType> = {
  met: CheckCircle,
  unmet: Warning,
  skipped: Circle,
};

const STATUS_COLOR: Record<PreflightCheckStatus, string> = {
  met: "var(--color-signal-green)",
  unmet: "var(--color-signal-orange)",
  skipped: "var(--color-text-tertiary)",
};

function Verdict({ readiness }: { readiness: RemovalReadiness }) {
  const copy: Record<RemovalReadiness["state"], { tone: string; text: string }> = {
    ready: {
      tone: "var(--color-signal-green)",
      text: "All preconditions met — this removal is ready to submit.",
    },
    blocked: {
      tone: "var(--color-signal-orange)",
      text: "Some preconditions aren't met yet. Resolve them before submitting.",
    },
    submitted: {
      tone: "var(--color-text-tertiary)",
      text: "This removal has already been submitted to the registry.",
    },
    inProgress: {
      tone: "var(--color-text-tertiary)",
      text: "A submission is currently in progress.",
    },
  };
  const { tone, text } = copy[readiness.state];
  return (
    <div
      className="border-l-2 pl-12 py-4"
      style={{ borderColor: tone }}
    >
      <p className="body-small text-[var(--color-text-primary)]">{text}</p>
    </div>
  );
}

export function PreflightStep({
  checklist,
  readiness,
}: {
  checklist: PreflightCheck[];
  readiness: RemovalReadiness;
}) {
  return (
    <div className="flex flex-col gap-24">
      <div className="flex flex-col gap-8">
        <h2 className="title-heading-3">Pre-flight</h2>
        <p className="body-medium text-[var(--color-text-secondary)] max-w-[680px]">
          The checks the registry needs before this Removal can be submitted.
        </p>
      </div>

      <Verdict readiness={readiness} />

      <ul className="flex flex-col border border-[var(--color-border-secondary)] bg-[var(--color-background-white)]">
        {checklist.map((check, index) => {
          const Icon = STATUS_ICON[check.status];
          return (
            <li
              key={check.key}
              className={`flex items-start gap-12 px-16 py-12 ${
                index > 0 ? "border-t border-[var(--color-border-tertiary)]" : ""
              }`}
            >
              <Icon
                size={18}
                weight={check.status === "skipped" ? "regular" : "fill"}
                aria-hidden
                className="mt-px shrink-0"
                style={{ color: STATUS_COLOR[check.status] }}
              />
              <div className="flex flex-col gap-2 min-w-0">
                <span className="body-small text-[var(--color-text-primary)]">
                  {check.label}
                </span>
                {check.detail && (
                  <span className="body-caption text-[var(--color-text-secondary)]">
                    {check.detail}
                  </span>
                )}
                {check.status === "skipped" && !check.detail && (
                  <span className="body-caption text-[var(--color-text-tertiary)]">
                    Pending an earlier check
                  </span>
                )}
              </div>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
