"use client";

import { useState, type ElementType } from "react";
import Link from "next/link";
import {
  ArrowRight,
  CheckCircle,
  ClockCountdown,
  Factory,
  Funnel,
  MapTrifold,
  Pulse,
  SealCheck,
  Warning,
} from "@phosphor-icons/react/dist/ssr";
import { EmptyState } from "@/components/ui";
import {
  useDashboardOverview,
} from "@/hooks/use-dashboard-overview";
import type {
  DashboardAttentionItem,
  DashboardMapFacility,
  DashboardMetric,
  DashboardNowItem,
  DashboardOverview,
  DashboardProgressStage,
  DashboardTone,
} from "@/data-access/dashboard-overview";

const PERIOD_OPTIONS = [7, 30, 90] as const;
const DEFAULT_PERIOD_DAYS = 30;
const MAP_PADDING_PERCENT = 12;
const MAP_SPAN_PERCENT = 76;

const TONE_ICON: Record<DashboardTone, ElementType> = {
  critical: Warning,
  blocked: Warning,
  ready: CheckCircle,
  waiting: ClockCountdown,
  running: Pulse,
};

const TONE_CLASSES: Record<DashboardTone, string> = {
  critical: "text-[var(--clr-red)] bg-[var(--clr-red-10)] border-[var(--clr-red-40)]",
  blocked:
    "text-[var(--color-signal-orange)] bg-[var(--clr-orange-10)] border-[var(--clr-orange-40)]",
  ready:
    "text-[var(--color-signal-green)] bg-[var(--color-signal-green-light)] border-[var(--color-status-success-border)]",
  waiting:
    "text-[var(--color-text-secondary)] bg-[var(--color-background-medium)] border-[var(--color-border-secondary)]",
  running: "text-[var(--clr-purple)] bg-[var(--clr-purple-10)] border-[var(--clr-purple-40)]",
};

function formatTime(value: string): string {
  return new Intl.DateTimeFormat("en", {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(value));
}

function plural(value: number, singular: string, pluralLabel = `${singular}s`) {
  return `${value} ${value === 1 ? singular : pluralLabel}`;
}

export function DashboardView() {
  const [facilityFilter, setFacilityFilter] = useState("all");
  const [periodDays, setPeriodDays] = useState<number>(DEFAULT_PERIOD_DAYS);
  const query = useDashboardOverview({
    facilityId: facilityFilter === "all" ? null : facilityFilter,
    periodDays,
  });

  const data = query.data;

  return (
    <div className="container-max flex flex-col gap-32 py-32">
      <header className="flex flex-col gap-20 xl:flex-row xl:items-end xl:justify-between">
        <div className="flex flex-col gap-8">
          <span className="title-chapter-title text-[var(--color-text-tertiary)]">
            Dashboard
          </span>
          <h1 className="title-heading-2">Today across all facilities</h1>
          <p className="body-medium max-w-[720px] text-[var(--color-text-secondary)]">
            Needs attention, live production, evidence health, and certification
            progress from current MRV records.
          </p>
        </div>
        <DashboardControls
          data={data}
          facilityFilter={facilityFilter}
          onFacilityChange={setFacilityFilter}
          periodDays={periodDays}
          onPeriodChange={setPeriodDays}
          disabled={query.isLoading && !data}
        />
      </header>

      {query.isLoading && !data ? (
        <DashboardLoading />
      ) : query.error || !data ? (
        <div className="border border-[var(--color-border-secondary)] bg-[var(--color-background-white)] p-20">
          <p className="body-medium text-[var(--clr-red)]" role="alert">
            Unable to load the dashboard. Try refreshing the page.
          </p>
        </div>
      ) : (
        <>
          <section className="grid grid-cols-1 gap-24 xl:grid-cols-[minmax(0,2fr)_minmax(320px,1fr)]">
            <NeedsAttention items={data.attentionItems} />
            <NowPanel items={data.nowItems} generatedAt={data.generatedAt} />
          </section>

          <MetricStrip metrics={data.metrics} />
          <ProgressPipeline stages={data.progress} />

          <section className="grid grid-cols-1 gap-24 xl:grid-cols-[minmax(0,1.4fr)_minmax(320px,0.6fr)]">
            <MapCoveragePanel data={data} />
            <EvidenceHealthPanel data={data} />
          </section>
        </>
      )}
    </div>
  );
}

function DashboardControls({
  data,
  facilityFilter,
  onFacilityChange,
  periodDays,
  onPeriodChange,
  disabled,
}: {
  data: DashboardOverview | undefined;
  facilityFilter: string;
  onFacilityChange: (value: string) => void;
  periodDays: number;
  onPeriodChange: (value: number) => void;
  disabled: boolean;
}) {
  return (
    <div className="flex flex-col gap-8 sm:flex-row sm:items-center">
      <label className="flex flex-col gap-4">
        <span className="body-caption text-[var(--color-text-tertiary)]">
          Facility
        </span>
        <select
          value={facilityFilter}
          onChange={(event) => onFacilityChange(event.target.value)}
          disabled={disabled}
          className="h-40 min-w-[220px] border border-[var(--color-border-secondary)] bg-[var(--color-background-white)] px-10 body-small text-[var(--color-text-primary)] focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-[var(--clr-purple)]"
        >
          <option value="all">All facilities</option>
          {(data?.facilities ?? []).map((facility) => (
            <option key={facility.id} value={facility.id}>
              {facility.code} · {facility.name}
            </option>
          ))}
        </select>
      </label>
      <label className="flex flex-col gap-4">
        <span className="body-caption text-[var(--color-text-tertiary)]">
          Window
        </span>
        <select
          value={periodDays}
          onChange={(event) => onPeriodChange(Number(event.target.value))}
          disabled={disabled}
          className="h-40 min-w-[136px] border border-[var(--color-border-secondary)] bg-[var(--color-background-white)] px-10 body-small text-[var(--color-text-primary)] focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-[var(--clr-purple)]"
        >
          {PERIOD_OPTIONS.map((value) => (
            <option key={value} value={value}>
              {value} days
            </option>
          ))}
        </select>
      </label>
    </div>
  );
}

function DashboardLoading() {
  return (
    <div className="grid grid-cols-1 gap-24 xl:grid-cols-[minmax(0,2fr)_minmax(320px,1fr)]">
      <section className="min-h-[360px] border border-[var(--color-border-secondary)] bg-[var(--color-background-white)] p-20">
        <div className="mb-20 h-24 w-180 bg-[var(--color-surface-light)]" />
        <div className="flex flex-col gap-12">
          {Array.from({ length: 6 }).map((_, index) => (
            <div
              key={index}
              className="h-56 bg-[var(--color-surface-light)]"
            />
          ))}
        </div>
      </section>
      <section className="min-h-[360px] border border-[var(--color-border-secondary)] bg-[var(--color-background-white)] p-20">
        <div className="mb-20 h-24 w-120 bg-[var(--color-surface-light)]" />
        <div className="flex flex-col gap-12">
          {Array.from({ length: 4 }).map((_, index) => (
            <div
              key={index}
              className="h-48 bg-[var(--color-surface-light)]"
            />
          ))}
        </div>
      </section>
    </div>
  );
}

function NeedsAttention({ items }: { items: DashboardAttentionItem[] }) {
  return (
    <section className="flex min-h-[360px] flex-col border border-[var(--color-border-secondary)] bg-[var(--color-background-white)]">
      <div className="flex items-center justify-between gap-16 border-b border-[var(--color-border-tertiary)] px-20 py-16">
        <div className="flex items-center gap-10">
          <Warning size={22} weight="fill" className="text-[var(--clr-orange)]" />
          <h2 className="title-heading-3">Needs attention</h2>
        </div>
        <span className="body-caption text-[var(--color-text-tertiary)]">
          {items.length}
        </span>
      </div>
      {items.length === 0 ? (
        <EmptyState
          icon={<CheckCircle size={40} />}
          title="Nothing needs attention"
          description="No derived blockers or active alerts in the selected scope."
          padding="md"
        />
      ) : (
        <div className="flex flex-col">
          {items.map((item, index) => (
            <AttentionRow key={item.id} item={item} withBorder={index > 0} />
          ))}
        </div>
      )}
    </section>
  );
}

function AttentionRow({
  item,
  withBorder,
}: {
  item: DashboardAttentionItem;
  withBorder: boolean;
}) {
  const Icon = TONE_ICON[item.tone];
  return (
    <Link
      href={item.href}
      className={[
        "group grid grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-12 px-20 py-14 transition-colors hover:bg-[var(--color-background-medium)]",
        withBorder ? "border-t border-[var(--color-border-tertiary)]" : "",
      ].join(" ")}
    >
      <span
        className={`flex h-32 w-32 items-center justify-center border ${TONE_CLASSES[item.tone]}`}
      >
        <Icon size={16} weight="fill" />
      </span>
      <span className="flex min-w-0 flex-col gap-3">
        <span className="flex flex-wrap items-center gap-8">
          <span className="body-caption font-mono uppercase text-[var(--color-text-tertiary)]">
            {item.facilityCode}
          </span>
          <span className="body-caption text-[var(--color-text-tertiary)]">
            {item.label}
          </span>
          {item.entityCode && (
            <span className="body-caption font-mono text-[var(--color-text-secondary)]">
              {item.entityCode}
            </span>
          )}
        </span>
        <span className="body-small text-[var(--color-text-primary)]">
          {item.title}
        </span>
        <span className="body-caption text-[var(--color-text-secondary)]">
          {item.detail}
        </span>
      </span>
      <ArrowRight
        size={16}
        weight="bold"
        className="text-[var(--color-text-tertiary)] transition-transform duration-150 group-hover:translate-x-[3px]"
      />
    </Link>
  );
}

function NowPanel({
  items,
  generatedAt,
}: {
  items: DashboardNowItem[];
  generatedAt: string;
}) {
  return (
    <section className="flex min-h-[360px] flex-col border border-[var(--color-border-secondary)] bg-[var(--color-background-white)]">
      <div className="flex items-center justify-between gap-16 border-b border-[var(--color-border-tertiary)] px-20 py-16">
        <div className="flex items-center gap-10">
          <Pulse size={22} weight="fill" className="text-[var(--clr-purple)]" />
          <h2 className="title-heading-3">Now</h2>
        </div>
        <span className="body-caption text-[var(--color-text-tertiary)]">
          {formatTime(generatedAt)}
        </span>
      </div>
      {items.length === 0 ? (
        <EmptyState
          icon={<ClockCountdown size={40} />}
          title="Quiet right now"
          description="No running production or in-flight submission in this scope."
          padding="md"
        />
      ) : (
        <div className="flex flex-col">
          {items.map((item, index) => (
            <NowRow key={item.id} item={item} withBorder={index > 0} />
          ))}
        </div>
      )}
    </section>
  );
}

function NowRow({
  item,
  withBorder,
}: {
  item: DashboardNowItem;
  withBorder: boolean;
}) {
  return (
    <Link
      href={item.href}
      className={[
        "group flex items-center gap-12 px-20 py-14 transition-colors hover:bg-[var(--color-background-medium)]",
        withBorder ? "border-t border-[var(--color-border-tertiary)]" : "",
      ].join(" ")}
    >
      <span className="flex h-28 w-28 items-center justify-center border border-[var(--color-border-secondary)] bg-[var(--color-background-light)] text-[var(--color-text-secondary)]">
        <Factory size={15} weight="fill" />
      </span>
      <span className="min-w-0 flex-1">
        <span className="block body-caption font-mono uppercase text-[var(--color-text-tertiary)]">
          {item.facilityCode} · {item.label}
        </span>
        <span className="block truncate body-small text-[var(--color-text-primary)]">
          {item.title}
        </span>
        <span className="block body-caption text-[var(--color-text-secondary)]">
          {item.detail}
        </span>
      </span>
      <span className="body-caption uppercase text-[var(--color-text-tertiary)]">
        {item.status}
      </span>
    </Link>
  );
}

function MetricStrip({ metrics }: { metrics: DashboardMetric[] }) {
  return (
    <section className="grid grid-cols-1 gap-16 md:grid-cols-2 xl:grid-cols-4">
      {metrics.map((metric) => (
        <div
          key={metric.label}
          className="border border-[var(--color-border-secondary)] bg-[var(--color-background-white)] px-20 py-16"
        >
          <span className="body-caption uppercase text-[var(--color-text-tertiary)]">
            {metric.label}
          </span>
          <div className="mt-4 flex items-end justify-between gap-12">
            <span className="title-heading-2 text-[var(--color-text-primary)]">
              {metric.value}
            </span>
            <span className="body-caption text-right text-[var(--color-text-secondary)]">
              {metric.detail}
            </span>
          </div>
        </div>
      ))}
    </section>
  );
}

function ProgressPipeline({ stages }: { stages: DashboardProgressStage[] }) {
  if (stages.length === 0) return null;

  return (
    <section className="flex flex-col gap-16">
      <div className="flex items-center gap-10">
        <Funnel size={22} weight="fill" className="text-[var(--clr-pink)]" />
        <h2 className="title-heading-3">Progress</h2>
      </div>
      <div className="grid grid-cols-1 border border-[var(--color-border-secondary)] bg-[var(--color-background-white)] md:grid-cols-2 xl:grid-cols-4">
        {stages.map((stage, index) => (
          <ProgressStage
            key={stage.key}
            stage={stage}
            withLeftBorder={index % 4 !== 0}
            withTopBorder={index >= 4}
          />
        ))}
      </div>
    </section>
  );
}

function ProgressStage({
  stage,
  withLeftBorder,
  withTopBorder,
}: {
  stage: DashboardProgressStage;
  withLeftBorder: boolean;
  withTopBorder: boolean;
}) {
  const attentionShare =
    stage.total === 0 ? 0 : Math.min(100, (stage.needsAttention / stage.total) * 100);
  return (
    <Link
      href={stage.href}
      className={[
        "group flex min-h-[148px] flex-col justify-between gap-16 p-18 transition-colors hover:bg-[var(--color-background-medium)]",
        withLeftBorder ? "xl:border-l xl:border-[var(--color-border-tertiary)]" : "",
        withTopBorder ? "xl:border-t xl:border-[var(--color-border-tertiary)]" : "",
      ].join(" ")}
    >
      <span className="flex items-start justify-between gap-8">
        <span className="body-small text-[var(--color-text-primary)]">
          {stage.label}
        </span>
        <ArrowRight
          size={14}
          weight="bold"
          className="shrink-0 text-[var(--color-text-tertiary)] transition-transform duration-150 group-hover:translate-x-[3px]"
        />
      </span>
      <span className="flex flex-col gap-8">
        <span className="title-heading-3">
          {stage.needsAttention}
          <span className="body-caption text-[var(--color-text-tertiary)]">
            {" "}
            / {stage.total}
          </span>
        </span>
        <span className="h-6 bg-[var(--color-background-medium)]">
          <span
            className="block h-full bg-[var(--clr-orange)]"
            style={{ width: `${attentionShare}%` }}
          />
        </span>
        <span className="body-caption text-[var(--color-text-secondary)]">
          {stage.detail}
        </span>
      </span>
    </Link>
  );
}

function MapCoveragePanel({ data }: { data: DashboardOverview }) {
  return (
    <section className="flex flex-col border border-[var(--color-border-secondary)] bg-[var(--color-background-white)]">
      <div className="flex items-center justify-between gap-16 border-b border-[var(--color-border-tertiary)] px-20 py-16">
        <div className="flex items-center gap-10">
          <MapTrifold size={22} weight="fill" className="text-[var(--clr-purple)]" />
          <h2 className="title-heading-3">Map coverage</h2>
        </div>
        <span className="body-caption text-[var(--color-text-tertiary)]">
          {data.map.plottedFacilityCount}/{data.map.facilityCount} plotted
        </span>
      </div>
      <div className="grid grid-cols-1 xl:grid-cols-[minmax(0,1fr)_260px]">
        <FacilityPlot facilities={data.map.facilities} />
        <div className="border-t border-[var(--color-border-tertiary)] p-20 xl:border-l xl:border-t-0">
          <div className="flex flex-col gap-16">
            <MapStat
              label="Facilities without GPS"
              value={data.map.missingFacilityGpsCount}
            />
            <MapStat
              label="Transport legs"
              value={data.map.transportLegCount}
            />
            <MapStat
              label="Unplottable legs"
              value={data.map.transportEndpointGapCount}
            />
            <Link
              href="/chain-of-custody"
              className="inline-flex items-center gap-8 body-small text-[var(--color-text-primary)] underline underline-offset-2 hover:text-[var(--color-text-secondary)]"
            >
              Open custody map
              <ArrowRight size={14} weight="bold" />
            </Link>
          </div>
        </div>
      </div>
    </section>
  );
}

function FacilityPlot({ facilities }: { facilities: DashboardMapFacility[] }) {
  const plotted = facilities.filter(
    (facility) => facility.lat != null && facility.lng != null,
  );

  if (plotted.length === 0) {
    return (
      <div className="min-h-[320px] p-20">
        <EmptyState
          icon={<MapTrifold size={40} />}
          title="No facilities plotted"
          description="Add facility GPS coordinates to make the org map useful."
          padding="md"
        />
      </div>
    );
  }

  const lats = plotted.map((facility) => facility.lat ?? 0);
  const lngs = plotted.map((facility) => facility.lng ?? 0);
  const minLat = Math.min(...lats);
  const maxLat = Math.max(...lats);
  const minLng = Math.min(...lngs);
  const maxLng = Math.max(...lngs);
  const latRange = Math.max(maxLat - minLat, 1);
  const lngRange = Math.max(maxLng - minLng, 1);

  return (
    <div className="relative min-h-[320px] overflow-hidden bg-[var(--color-background-light)]">
      <div className="absolute inset-0 opacity-60 [background-image:linear-gradient(var(--color-border-tertiary)_1px,transparent_1px),linear-gradient(90deg,var(--color-border-tertiary)_1px,transparent_1px)] [background-size:32px_32px]" />
      <div className="absolute left-20 top-20 z-10 border border-[var(--color-border-secondary)] bg-[var(--color-background-white)] px-10 py-6">
        <span className="body-caption font-mono uppercase text-[var(--color-text-secondary)]">
          Organization map
        </span>
      </div>
      {plotted.map((facility) => {
        const x =
          MAP_PADDING_PERCENT +
          (((facility.lng ?? 0) - minLng) / lngRange) * MAP_SPAN_PERCENT;
        const y =
          MAP_PADDING_PERCENT +
          ((maxLat - (facility.lat ?? 0)) / latRange) * MAP_SPAN_PERCENT;
        const hasAttention = facility.attentionCount > 0;

        return (
          <Link
            key={facility.id}
            href={`/facilities?facility=${encodeURIComponent(facility.id)}`}
            className="group absolute z-20 -translate-x-1/2 -translate-y-1/2"
            style={{ left: `${x}%`, top: `${y}%` }}
            aria-label={`${facility.name}: ${plural(
              facility.attentionCount,
              "attention item",
            )}`}
          >
            <span
              className={[
                "block h-18 w-18 border-2 bg-[var(--color-background-white)] shadow-[0_0_0_4px_rgba(255,255,255,0.75)]",
                hasAttention
                  ? "border-[var(--clr-orange)]"
                  : "border-[var(--clr-purple)]",
              ].join(" ")}
            />
            <span className="absolute left-24 top-1/2 hidden min-w-[120px] -translate-y-1/2 border border-[var(--color-border-secondary)] bg-[var(--color-background-white)] px-8 py-6 group-hover:block">
              <span className="block body-caption font-mono uppercase text-[var(--color-text-tertiary)]">
                {facility.code}
              </span>
              <span className="block body-small text-[var(--color-text-primary)]">
                {facility.name}
              </span>
              <span className="block body-caption text-[var(--color-text-secondary)]">
                {plural(facility.attentionCount, "item")} ·{" "}
                {plural(facility.runningRunCount, "run")}
              </span>
            </span>
          </Link>
        );
      })}
    </div>
  );
}

function MapStat({ label, value }: { label: string; value: number }) {
  return (
    <div className="flex items-center justify-between gap-12 border-b border-[var(--color-border-tertiary)] pb-10">
      <span className="body-small text-[var(--color-text-secondary)]">
        {label}
      </span>
      <span className="body-small font-mono text-[var(--color-text-primary)]">
        {value}
      </span>
    </div>
  );
}

function EvidenceHealthPanel({ data }: { data: DashboardOverview }) {
  const rows = [
    {
      label: "Application GPS missing",
      value: data.evidence.missingApplicationGps,
    },
    {
      label: "Feedstock GPS missing",
      value: data.evidence.missingFeedstockGps,
    },
    {
      label: "Facility GPS missing",
      value: data.evidence.missingFacilityGps,
    },
    {
      label: "Runs without samples",
      value: data.evidence.productionRunsWithoutSamples,
    },
    {
      label: "Transport endpoint gaps",
      value: data.evidence.transportEndpointGaps,
    },
    {
      label: "Distances not document-backed",
      value: data.evidence.transportDistanceEvidenceGaps,
    },
  ];

  return (
    <section className="flex flex-col border border-[var(--color-border-secondary)] bg-[var(--color-background-white)]">
      <div className="flex items-center gap-10 border-b border-[var(--color-border-tertiary)] px-20 py-16">
        <SealCheck size={22} weight="fill" className="text-[var(--clr-pink)]" />
        <h2 className="title-heading-3">Evidence health</h2>
      </div>
      <div className="flex flex-col p-20">
        {rows.map((row, index) => (
          <div
            key={row.label}
            className={[
              "flex items-center justify-between gap-12 py-10",
              index > 0 ? "border-t border-[var(--color-border-tertiary)]" : "",
            ].join(" ")}
          >
            <span className="body-small text-[var(--color-text-secondary)]">
              {row.label}
            </span>
            <span
              className={[
                "inline-flex min-w-32 justify-center border px-8 py-3 body-caption font-mono",
                row.value > 0
                  ? "border-[var(--clr-orange-40)] bg-[var(--clr-orange-10)] text-[var(--color-signal-orange)]"
                  : "border-[var(--color-status-success-border)] bg-[var(--color-status-success-bg)] text-[var(--color-status-success)]",
              ].join(" ")}
            >
              {row.value}
            </span>
          </div>
        ))}
      </div>
      <div className="border-t border-[var(--color-border-tertiary)] px-20 py-14">
        <Link
          href="/certification"
          className="inline-flex items-center gap-8 body-small text-[var(--color-text-primary)] underline underline-offset-2 hover:text-[var(--color-text-secondary)]"
        >
          Open certification overview
          <ArrowRight size={14} weight="bold" />
        </Link>
      </div>
    </section>
  );
}
