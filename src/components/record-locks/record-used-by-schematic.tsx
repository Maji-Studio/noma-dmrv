"use client";

import Link from "next/link";
import { useRef, useState, type ReactNode } from "react";
import { CaretDownIcon, CertificateIcon } from "@phosphor-icons/react/dist/ssr";
import { buttonVariants, TextAction } from "@/components/ui";
import { RECORD_CODE_LINK } from "@/components/ui/record-code-link";
import { INLINE_HIT_AREA } from "@/components/ui/touch-target";
import { traceabilityApplicationHref, traceabilityBatchHref } from "@/lib/certification/links";
import { recordHref } from "@/lib/record-links";
import type { RecordUsedByBatch } from "@/lib/record-used-by-chain";
import { cn } from "@/lib/utils";
import { isKnownKind, kindHeading, kindMeta, nodeDay, nodeHref, type UsedByNode } from "./record-used-by-kinds";
import { BAND_INSET, BAND_LABEL_H, COL, COL_MAX, HEADER_H, NODE_H, SQUARE, columnHeading, layoutUsedBy, stacks, type UsedByGraph } from "./record-used-by-layout";

const ICON = 15;
const STACK_OFFSETS = [4, 2] as const;
const EDGE_STROKE = "var(--clr-dark-purple-30)";
const EDGE_WIDTH = 1.25;
const RING = "1.5px solid var(--ink)";
const RING_OFFSET = 3;
const BAND_CARET = 12;
const FOCUS = "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-border-primary)]";
/** INLINE_HIT_AREA without its `relative`, which would undo the header's `absolute`. */
const HEADER_HIT_AREA = "after:absolute after:inset-x-0 after:top-1/2 after:h-44 after:-translate-y-1/2 after:content-[''] ";
const LABEL_CLASS = "mt-4 block max-w-full truncate text-center font-mono text-[length:var(--text-xxs)] leading-none";

/** Where "Open in Traceability" goes for this record; null when no credit batch holds it. */
function traceabilityHref(graph: UsedByGraph): string | null {
  const { self, creditBatches } = graph;
  if (self.kind === "creditBatch" && self.facilityId) return traceabilityBatchHref(self.id, self.facilityId);
  const batch = creditBatches[0];
  if (!batch) return null;
  if (self.kind === "application") return traceabilityApplicationHref(batch.id, self.id);
  const href = traceabilityBatchHref(batch.id, batch.facilityId);
  return self.kind === "productionRun" ? `${href}&${new URLSearchParams({ run: self.id })}` : href;
}

function BandLabel({ batches }: { batches: RecordUsedByBatch[] }) {
  return (
    <span className="flex min-w-0 items-center gap-6 body-caption text-[var(--color-text-secondary)]">
      <CertificateIcon size={14} aria-hidden className="shrink-0" />
      <span className="shrink-0">{batches.length === 1 ? "Credit batch" : "Credit batches"}</span>
      <span className="flex min-w-0 gap-8 truncate">
        {batches.map((batch) => (
          <Link
            key={batch.id}
            href={recordHref("creditBatch", batch.id, { facilityId: batch.facilityId })}
            className={cn(RECORD_CODE_LINK, batch.name && "font-sans", INLINE_HIT_AREA)}
          >
            {batch.name ?? batch.code}
          </Link>
        ))}
      </span>
    </span>
  );
}

function Square({ kind, ring }: { kind: string; ring?: boolean }) {
  const meta = kindMeta(kind);
  const KindIcon = meta.icon;
  return (
    <span
      className="grid shrink-0 place-items-center"
      style={{ width: SQUARE, height: SQUARE, background: meta.accent, ...(ring ? { outline: RING, outlineOffset: RING_OFFSET } : {}) }}
    >
      <KindIcon size={ICON} weight="bold" color="var(--paper)" aria-hidden />
    </span>
  );
}

/** One record's square and code; opens its sheet, or is plain when it has none. */
function NodeBox({ href, label, style, children }: { href: string | null; label: string; style: React.CSSProperties; children: ReactNode }) {
  const className = cn("group absolute flex flex-col items-center", FOCUS);
  if (href) return <Link href={href} className={className} aria-label={label} style={style}>{children}</Link>;
  return <span className={cn(className, "cursor-default")} aria-label={label} role="img" style={style}>{children}</span>;
}

/**
 * A small static version of the Traceability Flow chart for one record: what
 * it came from at the left, this record ringed, then what used it column by
 * column in custody order, with Flow's squares, accents and bezier edges but
 * no canvas and no zoom. The credit batch is a band behind this record and
 * everything after it, never a node. A column over four records stacks into
 * one group with its count; the header, the group square and "Show less" open
 * and close it. Inside its own frame the chart scrolls sideways on a phone,
 * with the ringed record scrolled into view on mount.
 */
export function UsedBySchematic({ graph, timeZone }: { graph: UsedByGraph; timeZone: string }) {
  const [open, setOpen] = useState<ReadonlySet<string>>(new Set());
  const scrolledToSelf = useRef(false);
  const layout = layoutUsedBy(graph, open);
  const { columns, selfIndex, hasBand, width, height, nodes, groups, paths, asides } = layout;
  const top = hasBand ? BAND_LABEL_H : 0;
  const pct = (px: number) => `${(px / width) * 100}%`;
  const href = traceabilityHref(graph);

  const toggle = (kind: string) => {
    const next = new Set(open);
    if (next.has(kind)) next.delete(kind);
    else next.add(kind);
    setOpen(next);
  };
  // Centre the ringed record in the frame once; later renders leave the reader's own scroll alone.
  const frameRef = (frame: HTMLDivElement | null) => {
    if (!frame || scrolledToSelf.current) return;
    scrolledToSelf.current = true;
    const centre = ((selfIndex * COL + COL / 2) / width) * frame.scrollWidth;
    frame.scrollLeft = Math.max(0, centre - frame.clientWidth / 2);
  };

  return (
    <div className="flex flex-col gap-8">
      <div ref={frameRef} className="overflow-x-auto" role="figure" aria-label="Where this record went">
        <div className="relative w-full" style={{ minWidth: width, maxWidth: columns.length * COL_MAX, height }}>
          <svg width="100%" height={height} viewBox={`0 0 ${width} ${height}`} preserveAspectRatio="none" className="absolute inset-0" aria-hidden>
            {hasBand && (
              <rect
                x={selfIndex * COL + BAND_INSET}
                y={0}
                width={(columns.length - selfIndex) * COL - BAND_INSET * 2}
                height={height}
                fill="var(--sea)"
                stroke="var(--clr-dark-purple-10)"
                vectorEffect="non-scaling-stroke"
              />
            )}
            {[...paths].map(([key, d]) => <path key={key} d={d} fill="none" stroke={EDGE_STROKE} strokeWidth={EDGE_WIDTH} vectorEffect="non-scaling-stroke" />)}
          </svg>
          {hasBand && (
            <div className="absolute flex items-center px-8" style={{ left: pct(selfIndex * COL + BAND_INSET), top: 0, height: BAND_LABEL_H, right: pct(BAND_INSET) }}>
              <BandLabel batches={graph.creditBatches} />
            </div>
          )}
          {columns.map((column, index) => {
            const heading = columnHeading(column);
            const style = { left: pct(index * COL), top, width: pct(COL), height: HEADER_H - 8 };
            const headerClass = "absolute flex items-end justify-center px-2 text-center body-caption leading-tight text-[var(--color-text-secondary)]";
            if (!stacks(column)) return <span key={`${column.role}:${column.kind}`} className={headerClass} style={style}>{heading}</span>;
            // A column that stacks: its header opens and closes it, like the group square.
            const expanded = open.has(column.kind);
            return (
              <button
                key={`${column.role}:${column.kind}`}
                type="button"
                aria-expanded={expanded}
                onClick={() => toggle(column.kind)}
                className={cn(headerClass, HEADER_HIT_AREA, "gap-2 hover:text-[var(--color-text-primary)]", FOCUS)}
                style={style}
              >
                <span>{heading}</span>
                <CaretDownIcon size={BAND_CARET} aria-hidden className={cn("mb-2 shrink-0 transition-transform", expanded && "rotate-180")} />
              </button>
            );
          })}
          {nodes.map(({ node, at, self }) => {
            const day = nodeDay(node, timeZone);
            const name = node.name ?? node.code;
            const label = `${kindMeta(node.kind).singular} ${name}${day ? `, ${day}` : ""}${self ? ", this record" : ""}`;
            return (
              <NodeBox key={at.key} href={self ? null : nodeHref(node)} label={label} style={{ left: pct(at.x - COL / 2), top: at.y, width: pct(COL), height: NODE_H }}>
                <Square kind={node.kind} ring={self} />
                <span className={cn(LABEL_CLASS, "group-hover:underline", self ? "font-medium text-[var(--ink)]" : "text-[var(--color-text-secondary)]")}>{name}</span>
              </NodeBox>
            );
          })}
          {groups.map(({ kind, count, at }) => {
            const meta = kindMeta(kind);
            const KindIcon = meta.icon;
            return (
              <button
                key={at.key}
                type="button"
                aria-expanded={false}
                onClick={() => toggle(kind)}
                aria-label={`Show all ${count} ${meta.plural.toLowerCase()}`}
                className={cn("absolute flex flex-col items-center", FOCUS)}
                style={{ left: pct(at.x - COL / 2), top: at.y, width: pct(COL), height: NODE_H }}
              >
                <span className="relative" style={{ width: SQUARE, height: SQUARE }}>
                  {STACK_OFFSETS.map((offset) => (
                    <span key={offset} aria-hidden className="absolute inset-0 border border-[var(--clr-dark-purple-30)] bg-[var(--paper)]" style={{ transform: `translate(${offset}px, ${-offset}px)` }} />
                  ))}
                  <span className="relative grid h-full w-full place-items-center" style={{ background: meta.accent }}>
                    <KindIcon size={ICON} weight="bold" color="var(--paper)" aria-hidden />
                  </span>
                </span>
                <span className={cn(LABEL_CLASS, "font-sans text-[var(--color-text-primary)] underline underline-offset-2")}>{count}</span>
              </button>
            );
          })}
        </div>
      </div>
      {open.size > 0 && (
        <TextAction aria-expanded onClick={() => setOpen(new Set())}>
          Show less
          <span className="sr-only"> {[...open].map((kind) => kindMeta(kind).plural.toLowerCase()).join(", ")}</span>
        </TextAction>
      )}
      {[...asides].map(([kind, asideNodes]) => (
        <p key={kind} className="flex flex-wrap items-baseline gap-x-8 body-small">
          <span className="text-[var(--color-text-secondary)]">{kindHeading(kind, asideNodes.length)}</span>
          {asideNodes.map((node) => <AsideCode key={`${node.kind}:${node.id}`} node={node} />)}
        </p>
      ))}
      {href && (
        <div className="-ml-16 self-start">
          <Link href={href} className={cn(buttonVariants({ variant: "noOutline" }), INLINE_HIT_AREA)}>Open in Traceability</Link>
        </div>
      )}
    </div>
  );
}

function AsideCode({ node }: { node: UsedByNode }) {
  const href = nodeHref(node);
  if (href) return <Link href={href} className={cn(RECORD_CODE_LINK, INLINE_HIT_AREA)}>{node.code}</Link>;
  return <span className={cn(isKnownKind(node.kind) && "font-mono")}>{node.code}</span>;
}
