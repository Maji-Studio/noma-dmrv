/**
 * PROTOTYPE ONLY. Variant B "Schematic": a small, static Flow chart for one
 * record. What it came from at the left, this record ringed, then what used
 * it column by column in custody order; Flow's squares, accents, icons and
 * bezier edges, no canvas and no zoom. The credit batch is a band behind the
 * record and everything downstream, not a node. A column with more than
 * four records stacks into one group with its count; a click opens it.
 */
"use client";

import Link from "next/link";
import { useState } from "react";
import { CaretDownIcon, CertificateIcon } from "@phosphor-icons/react/dist/ssr";
import { buttonVariants, TextAction } from "@/components/ui";
import { INLINE_HIT_AREA } from "@/components/ui/touch-target";
import { traceabilityApplicationHref, traceabilityBatchHref } from "@/lib/certification/links";
import { RECORD_CODE_LINK } from "@/components/ui/record-code-link";
import { recordHref } from "@/lib/record-links";
import { prototypeNodeKey, type PrototypeUsedByBatch, type PrototypeUsedByGraph, type PrototypeUsedByNode } from "@/lib/prototype-used-by";
import { cn } from "@/lib/utils";
import { KIND_META, MaybeLink, kindHeading, kindMeta, kindRank, nodeDay, nodeHref } from "./record-used-by-prototype-shared";

/**
 * Geometry, px at the narrowest column. Columns stretch with the sheet up to
 * COL_MAX; below six columns of COL the chart scrolls inside itself, never the page.
 */
const COL = 76;
const COL_MAX = 112;
const SQUARE = 28;
const ICON = 15;
const NODE_H = 48;
const ROW = 56;
const BAND_LABEL_H = 32;
const HEADER_H = 40;
const BOTTOM_PAD = 8;
const BAND_INSET = 2;
const STACK_OFFSETS = [4, 2] as const;
/** A column with more records than this stacks into a group. */
const GROUP_THRESHOLD = 4;
const EDGE_STROKE = "var(--clr-dark-purple-30)";
/** INLINE_HIT_AREA without its `relative`, which would undo the header's `absolute`. */
const HEADER_HIT_AREA = "after:absolute after:inset-x-0 after:top-1/2 after:h-44 after:-translate-y-1/2 after:content-['']";
const LABEL_CLASS = "mt-4 block max-w-full truncate text-center font-mono text-[length:var(--text-xxs)] leading-none";

type Placed = { key: string; x: number; y: number };
interface Column { kind: string; nodes: PrototypeUsedByNode[]; role: "upstream" | "self" | "downstream" }

/** Kinds that hold material or its claim, in custody order; anything else is listed under the chart. */
const CUSTODY_KINDS = new Set(["feedstock", "productionRun", "biocharProduct", "order", "delivery", "application", "removal"]);

function buildColumns(graph: PrototypeUsedByGraph): Column[] {
  const byKind = new Map<string, PrototypeUsedByNode[]>();
  for (const node of graph.downstream) if (CUSTODY_KINDS.has(node.kind)) byKind.set(node.kind, [...(byKind.get(node.kind) ?? []), node]);
  const downstream = [...byKind].sort(([a], [b]) => kindRank(a) - kindRank(b)).map(([kind, nodes]) => ({ kind, nodes, role: "downstream" as const }));
  return [
    ...(graph.upstream.length ? [{ kind: graph.upstream[0].kind, nodes: graph.upstream, role: "upstream" as const }] : []),
    { kind: graph.self.kind, nodes: [graph.self], role: "self" as const },
    ...downstream,
  ];
}

/** Rows follow their parents' rows, so edges cross as little as they can. */
function orderColumn(nodes: PrototypeUsedByNode[], graph: PrototypeUsedByGraph, rowOf: Map<string, number>): PrototypeUsedByNode[] {
  const parentRow = (node: PrototypeUsedByNode) => {
    const rows = graph.edges.filter((edge) => edge.to === prototypeNodeKey(node.kind, node.id)).map((edge) => rowOf.get(edge.from) ?? 0);
    return rows.length ? Math.min(...rows) : 0;
  };
  return [...nodes].sort((a, b) => parentRow(a) - parentRow(b) || (a.at ?? "").localeCompare(b.at ?? "") || a.code.localeCompare(b.code));
}

function edgePath(from: Placed, to: Placed): string {
  const x1 = from.x + SQUARE / 2;
  const x2 = to.x - SQUARE / 2;
  const y1 = from.y + SQUARE / 2;
  const y2 = to.y + SQUARE / 2;
  const mid = (x1 + x2) / 2;
  return `M ${x1} ${y1} C ${mid} ${y1}, ${mid} ${y2}, ${x2} ${y2}`;
}

function traceabilityHref(graph: PrototypeUsedByGraph): string | null {
  const { self } = graph;
  if (self.fixture) return null;
  if (self.kind === "creditBatch" && self.facilityId) return traceabilityBatchHref(self.id, self.facilityId);
  const batch = graph.creditBatches.find((candidate) => !candidate.id.startsWith("fx-"));
  if (!batch) return null;
  if (self.kind === "application") return traceabilityApplicationHref(batch.id, self.id);
  const href = traceabilityBatchHref(batch.id, batch.facilityId);
  return self.kind === "productionRun" ? `${href}&${new URLSearchParams({ run: self.id })}` : href;
}

function BandLabel({ batches }: { batches: PrototypeUsedByBatch[] }) {
  return (
    <span className="flex min-w-0 items-center gap-6 body-caption text-[var(--color-text-secondary)]">
      <CertificateIcon size={14} aria-hidden className="shrink-0" />
      <span className="shrink-0">{batches.length === 1 ? "Credit batch" : "Credit batches"}</span>
      <span className="flex min-w-0 gap-8 truncate">
        {batches.map((batch) => {
          const label = batch.name ?? batch.code;
          return batch.id.startsWith("fx-")
            ? <span key={batch.id} className={cn(!batch.name && "font-mono")}>{label}</span>
            : <Link key={batch.id} href={recordHref("creditBatch", batch.id, { facilityId: batch.facilityId })} className={cn(RECORD_CODE_LINK, batch.name && "font-sans", INLINE_HIT_AREA)}>{label}</Link>;
        })}
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
      style={{ width: SQUARE, height: SQUARE, background: meta.accent, ...(ring ? { outline: "1.5px solid var(--ink)", outlineOffset: 3 } : {}) }}
    >
      <KindIcon size={ICON} weight="bold" color="var(--paper)" aria-hidden />
    </span>
  );
}

export function UsedBySchematic({ graph, timeZone }: { graph: PrototypeUsedByGraph; timeZone: string }) {
  const [open, setOpen] = useState<Set<string>>(new Set());
  const columns = buildColumns(graph);
  const selfIndex = columns.findIndex((column) => column.role === "self");
  const band = graph.creditBatches.length > 0;
  const top = band ? BAND_LABEL_H : 0;

  // Place every column; a collapsed one is a single group square.
  const placed = new Map<string, Placed>();
  const rowOf = new Map<string, number>();
  const groups: { kind: string; count: number; at: Placed }[] = [];
  const nodesShown: { node: PrototypeUsedByNode; at: Placed; self: boolean }[] = [];
  let maxRows = 1;
  columns.forEach((column, index) => {
    const x = index * COL + COL / 2;
    const ordered = orderColumn(column.nodes, graph, rowOf);
    const collapsed = column.role === "downstream" && ordered.length > GROUP_THRESHOLD && !open.has(column.kind);
    if (collapsed) {
      const at = { key: `group:${column.kind}`, x, y: top + HEADER_H };
      groups.push({ kind: column.kind, count: ordered.length, at });
      for (const node of ordered) {
        placed.set(prototypeNodeKey(node.kind, node.id), at);
        rowOf.set(prototypeNodeKey(node.kind, node.id), 0);
      }
      return;
    }
    ordered.forEach((node, row) => {
      const key = prototypeNodeKey(node.kind, node.id);
      const at = { key, x, y: top + HEADER_H + row * ROW };
      placed.set(key, at);
      rowOf.set(key, row);
      nodesShown.push({ node, at, self: column.role === "self" });
    });
    maxRows = Math.max(maxRows, ordered.length);
  });
  const width = columns.length * COL;
  const pct = (px: number) => `${(px / width) * 100}%`;
  const height = top + HEADER_H + (maxRows - 1) * ROW + NODE_H + BOTTOM_PAD;

  const paths = new Map<string, string>();
  for (const edge of graph.edges) {
    const from = placed.get(edge.from);
    const to = placed.get(edge.to);
    if (!from || !to || from.key === to.key || to.x <= from.x) continue;
    paths.set(`${from.key}>${to.key}`, edgePath(from, to));
  }
  const href = traceabilityHref(graph);
  const openKinds = [...open];
  const toggle = (kind: string) => {
    const next = new Set(open);
    if (next.has(kind)) next.delete(kind);
    else next.add(kind);
    setOpen(next);
  };
  const asides = new Map<string, PrototypeUsedByNode[]>();
  for (const node of graph.downstream) if (!CUSTODY_KINDS.has(node.kind)) asides.set(node.kind, [...(asides.get(node.kind) ?? []), node]);

  return (
    <div className="flex flex-col gap-8">
      <div className="overflow-x-auto" role="figure" aria-label="Where this record went">
        <div className="relative w-full" style={{ minWidth: width, maxWidth: columns.length * COL_MAX, height }}>
          <svg width="100%" height={height} viewBox={`0 0 ${width} ${height}`} preserveAspectRatio="none" className="absolute inset-0" aria-hidden>
            {band && (
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
            {[...paths].map(([key, d]) => <path key={key} d={d} fill="none" stroke={EDGE_STROKE} strokeWidth={1.25} vectorEffect="non-scaling-stroke" />)}
          </svg>
          {band && (
            <div className="absolute flex items-center px-8" style={{ left: pct(selfIndex * COL + BAND_INSET), top: 0, height: BAND_LABEL_H, right: pct(BAND_INSET) }}>
              <BandLabel batches={graph.creditBatches} />
            </div>
          )}
          {columns.map((column, index) => {
            const heading = kindHeading(column.kind, column.nodes.length);
            const style = { left: pct(index * COL), top, width: pct(COL), height: HEADER_H - 8 };
            const headerClass = "absolute flex items-end justify-center px-2 text-center body-caption leading-tight text-[var(--color-text-secondary)]";
            if (column.role !== "downstream" || column.nodes.length <= GROUP_THRESHOLD) {
              return <span key={`${column.role}:${column.kind}`} className={headerClass} style={style}>{heading}</span>;
            }
            // A column that stacks: its header opens and closes it, like the group square.
            const expanded = open.has(column.kind);
            return (
              <button
                key={`${column.role}:${column.kind}`}
                type="button"
                aria-expanded={expanded}
                onClick={() => toggle(column.kind)}
                className={cn(headerClass, HEADER_HIT_AREA, "gap-2 hover:text-[var(--color-text-primary)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-border-primary)]")}
                style={style}
              >
                <span>{heading}</span>
                <CaretDownIcon size={12} aria-hidden className={cn("mb-2 shrink-0 transition-transform", expanded && "rotate-180")} />
              </button>
            );
          })}
          {nodesShown.map(({ node, at, self }) => {
            const day = nodeDay(node, timeZone);
            const label = `${kindMeta(node.kind).singular} ${node.name ?? node.code}${day ? `, ${day}` : ""}${self ? ", this record" : ""}`;
            return (
              <MaybeLink
                key={at.key}
                href={self ? null : nodeHref(node)}
                label={label}
                style={{ left: pct(at.x - COL / 2), top: at.y, width: pct(COL), height: NODE_H }}
                className="group absolute flex flex-col items-center focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-border-primary)]"
              >
                <Square kind={node.kind} ring={self} />
                <span className={cn(LABEL_CLASS, "group-hover:underline", self ? "font-medium text-[var(--ink)]" : "text-[var(--color-text-secondary)]")}>{node.name ?? node.code}</span>
              </MaybeLink>
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
                className="absolute flex flex-col items-center focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-border-primary)]"
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
      {openKinds.length > 0 && (
        <TextAction aria-expanded onClick={() => setOpen(new Set())}>
          Show less
          <span className="sr-only"> {openKinds.map((kind) => kindMeta(kind).plural.toLowerCase()).join(", ")}</span>
        </TextAction>
      )}
      {[...asides].map(([kind, nodes]) => (
        <p key={kind} className="flex flex-wrap items-baseline gap-x-8 body-small">
          <span className="text-[var(--color-text-secondary)]">{kindHeading(kind, nodes.length)}</span>
          {nodes.map((node) => {
            const nodeLink = nodeHref(node);
            return nodeLink
              ? <Link key={node.id} href={nodeLink} className={cn(RECORD_CODE_LINK, INLINE_HIT_AREA)}>{node.code}</Link>
              : <span key={node.id} className={cn(node.kind in KIND_META && "font-mono")}>{node.code}</span>;
          })}
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
