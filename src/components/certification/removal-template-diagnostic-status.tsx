import type {
  RemovalTemplateAggregateStatus,
  RemovalTemplateDiagnosticStatus,
} from "@/lib/certification/removal-template-diagnostic";

export const REMOVAL_TEMPLATE_STATUS_LABELS: Record<
  RemovalTemplateDiagnosticStatus,
  string
> = {
  mapped: "Mapped",
  "registry-owned-fixed": "Registry-owned / fixed",
  "optional-not-present": "Optional / not present",
  "missing-noma-mapping": "Missing noma mapping",
  "unsupported-component": "Unsupported blueprint / component",
  "template-contract-drift": "Template contract drift",
  "externally-unconfirmed-contract": "Externally unconfirmed",
  "deprecated-incompatible": "Deprecated / incompatible",
};

/**
 * Three visual tones summarize the eight statuses wherever a wire, edge, or
 * bar segment can only carry a color: data flows (ok), the registry supplies
 * the value itself (neutral), or the mapping needs platform attention.
 */
export type RemovalTemplateStatusTone = "ok" | "neutral" | "attention";

export const REMOVAL_TEMPLATE_STATUS_TONES: Record<
  RemovalTemplateDiagnosticStatus,
  RemovalTemplateStatusTone
> = {
  mapped: "ok",
  "registry-owned-fixed": "neutral",
  "optional-not-present": "neutral",
  "missing-noma-mapping": "attention",
  "unsupported-component": "attention",
  "template-contract-drift": "attention",
  "externally-unconfirmed-contract": "attention",
  "deprecated-incompatible": "attention",
};

export const REMOVAL_TEMPLATE_TONE_COLORS: Record<
  RemovalTemplateStatusTone,
  string
> = {
  ok: "var(--st-ok)",
  neutral: "var(--st-off)",
  attention: "var(--st-wait)",
};

export function summarizeRemovalTemplateMappingOverview(
  counts: Record<RemovalTemplateDiagnosticStatus, number>,
): {
  toneCounts: Record<RemovalTemplateStatusTone, number>;
  total: number;
} {
  const toneCounts: Record<RemovalTemplateStatusTone, number> = {
    ok: 0,
    neutral: 0,
    attention: 0,
  };
  for (const [status, count] of Object.entries(counts)) {
    const diagnosticStatus = status as RemovalTemplateDiagnosticStatus;
    toneCounts[REMOVAL_TEMPLATE_STATUS_TONES[diagnosticStatus]] += count;
  }
  return {
    toneCounts,
    total: toneCounts.ok + toneCounts.neutral + toneCounts.attention,
  };
}

const STATUS_CLASSES: Record<RemovalTemplateDiagnosticStatus, string> = {
  mapped: "border-[var(--st-ok-border)] bg-[var(--st-ok-bg)] text-[var(--st-ok)]",
  "registry-owned-fixed":
    "border-[var(--color-border-secondary)] bg-[var(--color-surface-light)] text-[var(--color-text-secondary)]",
  "optional-not-present":
    "border-[var(--color-border-secondary)] bg-[var(--color-surface-light)] text-[var(--color-text-tertiary)]",
  "missing-noma-mapping":
    "border-[var(--st-wait-border)] bg-[var(--st-wait-bg)] text-[var(--st-wait)]",
  "unsupported-component":
    "border-[var(--st-wait-border)] bg-[var(--st-wait-bg)] text-[var(--st-wait)]",
  "template-contract-drift":
    "border-[var(--st-wait-border)] bg-[var(--st-wait-bg)] text-[var(--st-wait)]",
  "externally-unconfirmed-contract":
    "border-[var(--st-wait-border)] bg-[var(--st-wait-bg)] text-[var(--st-wait)]",
  "deprecated-incompatible":
    "border-[var(--st-wait-border)] bg-[var(--st-wait-bg)] text-[var(--st-wait)]",
};

export function RemovalTemplateDiagnosticStatusBadge({
  status,
}: {
  status: RemovalTemplateDiagnosticStatus;
}) {
  return (
    <span
      className={`inline-flex min-h-[20px] items-center border px-6 py-2 body-caption-fit font-medium ${STATUS_CLASSES[status]}`}
    >
      {REMOVAL_TEMPLATE_STATUS_LABELS[status]}
    </span>
  );
}

const AGGREGATE_LABELS: Record<RemovalTemplateAggregateStatus, string> = {
  mapped: "Mapped",
  drift: "Drift",
  missing: "Missing",
};

const AGGREGATE_STATUS: Record<
  RemovalTemplateAggregateStatus,
  RemovalTemplateDiagnosticStatus
> = {
  mapped: "mapped",
  drift: "template-contract-drift",
  missing: "missing-noma-mapping",
};

export function RemovalTemplateAggregateStatusBadge({
  status,
}: {
  status: RemovalTemplateAggregateStatus;
}) {
  return (
    <span
      className={`inline-flex min-h-[24px] items-center border px-8 py-4 body-caption-fit font-medium ${STATUS_CLASSES[AGGREGATE_STATUS[status]]}`}
    >
      {AGGREGATE_LABELS[status]}
    </span>
  );
}
