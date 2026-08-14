"use client";

import { useState } from "react";
import {
  FlowArrowIcon,
  MagnifyingGlassIcon,
  WarningIcon,
} from "@phosphor-icons/react/dist/ssr";
import { Button, EmptyState } from "@/components/ui";
import { useRemovalTemplateDiagnostic } from "@/hooks/use-certification";
import type { RemovalTemplateDiagnosticAvailability } from "@/fn/certification";
import type { RemovalTemplateDiagnosticStatus } from "@/lib/certification/removal-template-diagnostic";
import { RemovalTemplateMappingView } from "./removal-template-mapping-view";
import { RemovalTemplateTraceView } from "./removal-template-trace-view";
import {
  REMOVAL_TEMPLATE_STATUS_LABELS,
  REMOVAL_TEMPLATE_TONE_COLORS,
  RemovalTemplateAggregateStatusBadge,
  RemovalTemplateDiagnosticStatusBadge,
  summarizeRemovalTemplateMappingOverview,
  type RemovalTemplateStatusTone,
} from "./removal-template-diagnostic-status";

type DiagnosticView = "mapping" | "trace";

const VIEWS: Array<{
  key: DiagnosticView;
  label: string;
  icon: typeof FlowArrowIcon;
}> = [
  { key: "mapping", label: "Mapping", icon: FlowArrowIcon },
  { key: "trace", label: "Removal trace", icon: MagnifyingGlassIcon },
];

const TONE_SUMMARY: Array<{ tone: RemovalTemplateStatusTone; label: string }> =
  [
    { tone: "ok", label: "mapped" },
    { tone: "neutral", label: "registry-owned or optional" },
    { tone: "attention", label: "attention needed" },
  ];

function MappingOverview({
  counts,
}: {
  counts: Record<RemovalTemplateDiagnosticStatus, number>;
}) {
  const { toneCounts, total } = summarizeRemovalTemplateMappingOverview(counts);
  if (total === 0) {
    return null;
  }
  return (
    <div className="sm:col-span-2 lg:col-span-4">
      <p className="label-micro text-[var(--color-text-tertiary)]">
        Mapping overview
      </p>
      <div
        aria-hidden
        className="mt-6 flex h-[6px] w-full overflow-hidden bg-[var(--st-off-bg)]"
      >
        {TONE_SUMMARY.map(({ tone }) =>
          toneCounts[tone] > 0 ? (
            <span
              key={tone}
              style={{
                width: `${(toneCounts[tone] / total) * 100}%`,
                backgroundColor: REMOVAL_TEMPLATE_TONE_COLORS[tone],
              }}
            />
          ) : null,
        )}
      </div>
      <p className="mt-6 flex flex-wrap gap-x-16 gap-y-4 body-caption text-[var(--color-text-secondary)]">
        {TONE_SUMMARY.map(({ tone, label }) => (
          <span key={tone} className="inline-flex items-center gap-6">
            <span
              aria-hidden
              className="size-[6px]"
              style={{
                backgroundColor: REMOVAL_TEMPLATE_TONE_COLORS[tone],
              }}
            />
            {toneCounts[tone]} {label}
          </span>
        ))}
      </p>
    </div>
  );
}

const STATUS_LEGEND: RemovalTemplateDiagnosticStatus[] = [
  "mapped",
  "registry-owned-fixed",
  "optional-not-present",
  "missing-noma-mapping",
  "unsupported-component",
  "template-contract-drift",
  "externally-unconfirmed-contract",
  "deprecated-incompatible",
];

const AVAILABILITY_COPY: Record<
  Exclude<RemovalTemplateDiagnosticAvailability, "ready">,
  { title: string; description: string }
> = {
  "project-not-linked": {
    title: "No Isometric project link",
    description:
      "Link this facility to an Isometric project before inspecting an active Removal template.",
  },
  "credentials-not-configured": {
    title: "Template contract is unavailable",
    description:
      "Configure organization Isometric credentials before loading the active Removal template.",
  },
  "template-not-selected": {
    title: "No active Removal template",
    description:
      "Select a default Isometric Removal template in Certifier settings.",
  },
  "template-not-found": {
    title: "Active Removal template is missing",
    description:
      "The saved template ID no longer resolves in the linked Isometric project. Select another template.",
  },
};

export function RemovalTemplateDiagnosticPanel({
  facilityId,
}: {
  facilityId: string;
}) {
  const [view, setView] = useState<DiagnosticView>("mapping");
  const query = useRemovalTemplateDiagnostic(facilityId);

  if (query.isLoading) {
    return (
      <p className="body-small text-[var(--color-text-tertiary)]">
        Loading active Removal template…
      </p>
    );
  }

  if (query.error || !query.data) {
    return (
      <EmptyState
        icon={<WarningIcon size={40} weight="bold" />}
        title="Template mapping could not be loaded"
        description={
          query.error instanceof Error
            ? query.error.message
            : "Refresh the page to retry the read-only diagnostic."
        }
        padding="sm"
      />
    );
  }

  const { data } = query;
  const unavailable =
    data.availability === "ready"
      ? null
      : AVAILABILITY_COPY[data.availability];

  return (
    <div className="flex flex-col gap-20">
      <section className="grid gap-12 border border-[var(--color-border-secondary)] bg-[var(--color-background-white)] p-16 sm:grid-cols-2 lg:grid-cols-4">
        <div>
          <p className="label-micro text-[var(--color-text-tertiary)]">
            Environment
          </p>
          <p className="body-small capitalize">{data.environment}</p>
        </div>
        <div>
          <p className="label-micro text-[var(--color-text-tertiary)]">
            Project link
          </p>
          <p className="body-small">
            {!data.project.linked
              ? "Not linked"
              : data.project.resolved
                ? data.project.name || "Linked"
                : "Linked"}
          </p>
        </div>
        <div>
          <p className="label-micro text-[var(--color-text-tertiary)]">
            Active Removal template
          </p>
          <p className="body-small">
            {data.diagnostic?.template.displayName ?? "Not available"}
          </p>
          {data.diagnostic && (
            <p className="body-caption text-[var(--color-text-tertiary)]">
              {data.diagnostic.template.creditType} credit type
            </p>
          )}
          {(data.selectedTemplateId || data.project.id) && (
            <details className="mt-4 body-caption text-[var(--color-text-tertiary)]">
              <summary className="cursor-pointer">Raw template identifiers</summary>
              <dl className="mt-6 grid grid-cols-[auto_1fr] gap-x-8 gap-y-2 font-mono">
                {data.selectedTemplateId && (
                  <>
                    <dt>Template</dt>
                    <dd className="break-all">{data.selectedTemplateId}</dd>
                  </>
                )}
                {data.project.id && (
                  <>
                    <dt>Project</dt>
                    <dd className="break-all">{data.project.id}</dd>
                  </>
                )}
              </dl>
            </details>
          )}
        </div>
        <div>
          <p className="label-micro text-[var(--color-text-tertiary)]">
            Aggregate status
          </p>
          {data.diagnostic ? (
            <div className="mt-4">
              <RemovalTemplateAggregateStatusBadge
                status={data.diagnostic.aggregateStatus}
              />
            </div>
          ) : (
            <p className="body-small text-[var(--color-text-tertiary)]">
              Not available
            </p>
          )}
        </div>
        {data.diagnostic && <MappingOverview counts={data.diagnostic.counts} />}
      </section>

      {unavailable || !data.diagnostic ? (
        <EmptyState
          icon={<WarningIcon size={40} weight="bold" />}
          title={unavailable?.title ?? "Template mapping is unavailable"}
          description={
            unavailable?.description ??
            "Check the project link and active Removal template."
          }
          padding="sm"
        />
      ) : (
        <>
          <div
            role="tablist"
            aria-label="Removal template diagnostic views"
            className="flex flex-wrap gap-8 border-b border-[var(--color-border-secondary)] pb-8"
          >
            {VIEWS.map((item) => {
              const Icon = item.icon;
              const selected = view === item.key;
              return (
                <Button
                  key={item.key}
                  id={`removal-template-diagnostic-tab-${item.key}`}
                  role="tab"
                  aria-selected={selected}
                  aria-controls="removal-template-diagnostic-tabpanel"
                  variant={selected ? "primary" : "weak"}
                  size="small"
                  onClick={() => setView(item.key)}
                >
                  <Icon size={16} weight="bold" aria-hidden />
                  {item.label}
                </Button>
              );
            })}
          </div>

          <details className="border border-[var(--color-border-tertiary)] px-12 py-10">
            <summary className="cursor-pointer body-small">
              Status definitions
            </summary>
            <ul className="mt-10 grid gap-8 sm:grid-cols-2 xl:grid-cols-3">
              {STATUS_LEGEND.map((status) => (
                <li key={status} className="flex items-center justify-between gap-8">
                  <span className="body-caption text-[var(--color-text-secondary)]">
                    {REMOVAL_TEMPLATE_STATUS_LABELS[status]}
                  </span>
                  <RemovalTemplateDiagnosticStatusBadge status={status} />
                </li>
              ))}
            </ul>
          </details>

          <div
            id="removal-template-diagnostic-tabpanel"
            role="tabpanel"
            aria-labelledby={`removal-template-diagnostic-tab-${view}`}
          >
            {view === "mapping" && (
              <RemovalTemplateMappingView model={data.diagnostic} />
            )}
            {view === "trace" && (
              <RemovalTemplateTraceView
                facilityId={facilityId}
                model={data.diagnostic}
              />
            )}
          </div>
        </>
      )}
    </div>
  );
}
