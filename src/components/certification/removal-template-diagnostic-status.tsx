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

const STATUS_CLASSES: Record<RemovalTemplateDiagnosticStatus, string> = {
  mapped: "border-[var(--st-ok-border)] bg-[var(--st-ok-bg)] text-[var(--st-ok)]",
  "registry-owned-fixed":
    "border-[var(--color-border-secondary)] bg-[var(--color-surface-light)] text-[var(--color-text-secondary)]",
  "optional-not-present":
    "border-[var(--color-border-secondary)] bg-[var(--color-surface-light)] text-[var(--color-text-tertiary)]",
  "missing-noma-mapping":
    "border-[var(--st-bad-border)] bg-[var(--st-bad-bg)] text-[var(--st-bad)]",
  "unsupported-component":
    "border-[var(--st-bad-border)] bg-[var(--st-bad-bg)] text-[var(--st-bad)]",
  "template-contract-drift":
    "border-[var(--st-wait-border)] bg-[var(--st-wait-bg)] text-[var(--st-wait)]",
  "externally-unconfirmed-contract":
    "border-[var(--st-wait-border)] bg-[var(--st-wait-bg)] text-[var(--st-wait)]",
  "deprecated-incompatible":
    "border-[var(--st-bad-border)] bg-[var(--st-bad-bg)] text-[var(--st-bad)]",
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
