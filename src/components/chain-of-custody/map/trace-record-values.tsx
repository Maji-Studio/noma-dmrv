"use client";

/**
 * A record's values opened in place on the Traceability Map: up to three key
 * figures (wet first), the rest of its record values, a "Not recorded" note for
 * gaps, and its actions. Same facts the Flow record sheet shows, from
 * the same graph data.
 */

import Link from "next/link";
import type { CSSProperties } from "react";
import { ArrowUpRightIcon, TreeStructureIcon } from "@phosphor-icons/react/dist/ssr";
import { Button, buttonVariants } from "@/components/ui/button";
import { Notice } from "@/components/ui/notice";
import { isMissingValueCopy, MISSING_VALUE, missingValueSituation } from "@/lib/copy-utils";
import { formatDistanceKm } from "@/lib/format-utils";
import { cn } from "@/lib/utils";
import { ChainStatusBadge } from "../chain-status-badge";
import { placeWithoutPosition, recordLegs, splitWetDry, type TraceModel, type TraceRecord } from "./trace-model";

const STAT_LIMIT = 3;
/** Kinds whose mass is a quantity with no dry mass to record (an order). */
const KINDS_WITHOUT_DRY_MASS: ReadonlyArray<TraceRecord["kind"]> = ["order"];

interface Stat {
  label: string;
  value: string;
}

/** A missing value reads as the shared placeholder: small, tertiary, regular weight. */
function valueClass(value: string, present: string): string {
  return isMissingValueCopy(value)
    ? "body-small font-normal text-[var(--color-text-tertiary)]"
    : `${present} text-[var(--color-text-primary)]`;
}

/** Key figures and the remaining rows, each fact once. */
function figures(model: TraceModel, record: TraceRecord) {
  const stats: Stat[] = [];
  let statsTitle: string | null = null;
  const rows = [...record.details];
  const missing: string[] = [];
  const pairIndex = rows.findIndex((row) => splitWetDry(row.value) !== null);
  if (pairIndex >= 0) {
    const row = rows.splice(pairIndex, 1)[0]!;
    const pair = splitWetDry(row.value)!;
    statsTitle = row.label;
    stats.push({ label: "Wet", value: pair.wet });
    // Judged by kind, not by value: a record that carries a dry mass shows it as
    // "Not recorded" when it is missing; only an order's quantity never has one.
    if (!KINDS_WITHOUT_DRY_MASS.includes(record.kind)) {
      stats.push({ label: "Dry", value: isMissingValueCopy(pair.dry) ? MISSING_VALUE.notRecorded : pair.dry });
    }
  }
  const legs = recordLegs(model, record.id);
  if (legs.length === 1) {
    stats.push({ label: "One way", value: formatDistanceKm(legs[0]!.distanceKm) });
  } else if (legs.length > 1) {
    stats.push({ label: "Routes", value: String(legs.length) });
  }
  // Only plain "Not recorded" gaps collect into the note; other tokens
  // ("Not set", "Not yet computed", ...) keep their own meaning as rows.
  for (const row of rows) if (missingValueSituation(row.value) === "notRecorded") missing.push(row.label);
  return {
    statsTitle,
    stats: stats.slice(0, STAT_LIMIT),
    rows: rows.filter((row) => missingValueSituation(row.value) !== "notRecorded"),
    missing,
  };
}

/** Where the map shows the record, in the map's own words. */
export function positionLine(model: TraceModel, record: TraceRecord): string {
  if (record.position) {
    if (record.sub && record.sub !== record.shortCode) return record.sub;
    return record.geoCode && record.geoCode !== record.shortCode ? record.geoCode : "On the map";
  }
  return placeWithoutPosition(model, record.kind);
}

/**
 * One line under a record's code in a list: where it is when the map shows
 * it, else its first wet and dry figures (every row in a stage at the
 * facility would otherwise say the same thing).
 */
export function recordSummary(model: TraceModel, record: TraceRecord): string {
  if (record.position) return positionLine(model, record);
  for (const row of record.details) {
    const pair = splitWetDry(row.value);
    if (pair) {
      return isMissingValueCopy(pair.dry)
        ? `${row.label}: ${pair.wet} wet`
        : `${row.label}: ${pair.wet} wet · ${pair.dry} dry`;
    }
  }
  return positionLine(model, record);
}

export function RecordValues({
  model,
  record,
  onTrace,
  className,
  style,
}: {
  model: TraceModel;
  record: TraceRecord;
  onTrace?: (recordId: string) => void;
  className?: string;
  style?: CSSProperties;
}) {
  const { statsTitle, stats, rows, missing } = figures(model, record);
  const extra = [
    ...(record.geoCode && record.geoCode !== record.shortCode ? [{ label: "Record", value: record.geoCode }] : []),
    { label: "Place", value: record.position ? record.sub ?? "" : placeWithoutPosition(model, record.kind) },
  ].filter((row) => row.value && !rows.some((other) => other.value === row.value) && row.value !== record.shortCode);
  const href = record.href;
  return (
    <div className={cn("flex flex-col gap-16", className)} style={style}>
      {stats.length > 0 ? (
        <div className="flex flex-col gap-4">
        {statsTitle ? (
          <p className="body-caption text-[var(--color-text-secondary)]">{statsTitle}</p>
        ) : null}
        <dl
          className="grid border-y border-[var(--clr-dark-purple-10)]"
          style={{ gridTemplateColumns: `repeat(${stats.length}, minmax(0, 1fr))` }}
        >
          {stats.map((stat, index) => (
            <div
              key={stat.label}
              className={cn(
                "flex min-w-0 flex-col gap-2 py-10",
                index > 0 && "border-l border-[var(--clr-dark-purple-10)] pl-12",
              )}
            >
              <dt className="body-caption truncate text-[var(--color-text-tertiary)]">{stat.label}</dt>
              <dd
                className={cn("truncate", valueClass(stat.value, "body-medium font-medium"))}
                data-empty={isMissingValueCopy(stat.value) || undefined}
              >
                {stat.value}
              </dd>
            </div>
          ))}
        </dl>
        </div>
      ) : null}
      <dl className="flex flex-col">
        {record.status ? (
          <div className="flex items-center justify-between gap-12 border-b border-[var(--clr-dark-purple-10)] py-8">
            <dt className="body-caption text-[var(--color-text-tertiary)]">Status</dt>
            <dd><ChainStatusBadge status={record.status} /></dd>
          </div>
        ) : null}
        {[...rows, ...extra].map((row) => (
          <div
            key={`${row.label}:${row.value}`}
            className="flex items-baseline justify-between gap-12 border-b border-[var(--clr-dark-purple-10)] py-8"
          >
            <dt className="body-caption shrink-0 text-[var(--color-text-tertiary)]">{row.label}</dt>
            <dd
              className={cn("min-w-0 text-right", valueClass(row.value, "body-small"))}
              data-empty={isMissingValueCopy(row.value) || undefined}
            >
              {row.value}
            </dd>
          </div>
        ))}

      </dl>
      {missing.length > 0 ? (
        <Notice tone="warning">{`${MISSING_VALUE.notRecorded}: ${missing.join(", ")}`}</Notice>
      ) : null}
      {(record.drillable && onTrace) || href ? (
        <div className="flex flex-wrap gap-8">
          {record.drillable && onTrace ? (
            <Button variant="primary" size="small" className="min-h-44 sm:min-h-0" onClick={() => onTrace(record.id)}>
              <TreeStructureIcon size={14} weight="bold" />
              Trace rollback
            </Button>
          ) : null}
          {href ? (
            <Link href={href} className={cn(buttonVariants({ variant: "default", size: "small" }), "min-h-44 sm:min-h-0")}>
              <ArrowUpRightIcon size={14} weight="bold" />
              View full record
            </Link>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
