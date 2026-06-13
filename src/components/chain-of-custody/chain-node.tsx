"use client";

import { type ElementType } from "react";
import { Handle, Position, type NodeProps } from "@xyflow/react";
import { ArrowUpRight, TreeStructure } from "@phosphor-icons/react/dist/ssr";
import type { LineageDetailRow } from "./use-chain-graph";
import { STATUS_COLORS, STATUS_COLOR_FALLBACK } from "./chain-constants";

export interface ChainNodeData {
  label: string;
  code: string;
  icon: ElementType;
  /** Fill accent — left edge + highlight ring. */
  accent: string;
  /** Ink variant — header type label text (always passes contrast). */
  accentInk: string;
  href: string | null;
  status?: string | null;
  /** Formatted event date — the card's primary line (code is secondary). */
  date: string | null;
  /** Label/value rows (masses, parties, identifiers). */
  details: LineageDetailRow[];
  /** Cross-link highlight (map marker / rail selection). */
  highlighted?: boolean;
  /** Outside the hovered card's lineage — fade back (hover focus). */
  dimmed?: boolean;
  /** Batch DAG application card — click drills into the rollback. */
  drillable?: boolean;
  [key: string]: unknown;
}

function formatStatus(status: string) {
  return status.replaceAll("_", " ");
}

function StatusPill({ status }: { status: string | null | undefined }) {
  if (!status) {
    return null;
  }

  return (
    <span
      className="inline-flex items-center gap-6 whitespace-nowrap border-[1.5px] border-current px-6 py-2 font-mono text-[9px] font-medium uppercase tracking-[0.09em]"
      style={{ color: STATUS_COLORS[status] ?? STATUS_COLOR_FALLBACK }}
    >
      <span aria-hidden className="size-[6px] bg-current" />
      {formatStatus(status)}
    </span>
  );
}

export function ChainNode({ data }: NodeProps) {
  const {
    label,
    code,
    icon: Icon,
    accent,
    accentInk,
    status,
    date,
    details,
    highlighted,
    dimmed,
    drillable,
  } = data as unknown as ChainNodeData;
  // Every card is clickable now — a click opens the detail side-sheet (or, in
  // split view, locates the record on the map). Navigation moved into the
  // sheet's "View full record" action.
  const interactive = true;

  const card = (
    <div
      data-highlighted={highlighted ? "true" : undefined}
      className={`
        group flex flex-col border-[1.5px] bg-[var(--paper)] transition-[border-color,background-color,opacity] duration-150
        ${interactive ? "cursor-pointer" : "cursor-default"}
        ${dimmed ? "opacity-20" : "opacity-100"}
        border-[var(--clr-dark-purple-20)] hover:border-[var(--ink)] hover:bg-[var(--clr-dark-purple-1)]
      `}
      style={{
        width: 260,
        minHeight: 132,
        borderLeftWidth: "3px",
        borderLeftStyle: "solid",
        borderLeftColor: accent,
        ...(highlighted
          ? {
              borderColor: accent,
              boxShadow: `0 0 0 4px color-mix(in srgb, ${accent} 28%, transparent)`,
            }
          : null),
      }}
    >
      <div className="flex items-center justify-between gap-10 px-12 pt-12">
        <span
          className="inline-flex min-w-0 items-center gap-6 font-mono text-[10px] font-medium uppercase tracking-[0.09em]"
          style={{ color: accentInk }}
        >
          <Icon size={13} weight="bold" className="shrink-0" />
          <span className="truncate">{label}</span>
        </span>
        <span className="flex shrink-0 items-center gap-8">
          <StatusPill status={status} />
          {/* Hover affordance — open the record / trace the rollback. */}
          {interactive ? (
            drillable ? (
              <TreeStructure
                size={12}
                weight="bold"
                className="opacity-0 transition-opacity duration-150 group-hover:opacity-100"
                style={{ color: accentInk }}
                aria-hidden
              />
            ) : (
              <ArrowUpRight
                size={12}
                weight="bold"
                className="opacity-0 transition-opacity duration-150 group-hover:opacity-100"
                style={{ color: accentInk }}
                aria-hidden
              />
            )
          ) : null}
        </span>
      </div>

      {/* Date leads; the record code is secondary identification. */}
      <div className="px-12 pt-10">
        <p className="break-words font-mono text-[21px] font-medium leading-none tracking-[0.03em]">
          {date ?? code}
        </p>
        {date ? (
          <p className="mt-4 font-mono text-[11px] uppercase tracking-[0.06em] text-[var(--clr-dark-purple-40)]">
            {code}
          </p>
        ) : null}
      </div>

      {details.length > 0 ? (
        <div className="flex flex-col gap-4 px-12 pb-12 pt-10">
          {details.map((row) => (
            <div
              key={`${row.label}:${row.value}`}
              className="flex items-baseline justify-between gap-12"
            >
              <span className="whitespace-nowrap font-mono text-[9px] font-medium uppercase tracking-[0.07em] text-[var(--clr-dark-purple-40)]">
                {row.label}
              </span>
              <span className="text-right text-[12.5px] font-light leading-[1.3] break-words">
                {row.value}
              </span>
            </div>
          ))}
        </div>
      ) : (
        <div className="pb-12" />
      )}
    </div>
  );

  return (
    <>
      <Handle
        type="target"
        position={Position.Left}
        className="!bg-[var(--clr-purple)] !w-[6px] !h-[6px] !border-0"
      />

      {card}

      <Handle
        type="source"
        position={Position.Right}
        className="!bg-[var(--clr-purple)] !w-[6px] !h-[6px] !border-0"
      />
    </>
  );
}
