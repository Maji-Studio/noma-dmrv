/**
 * PROTOTYPE ONLY. Variant C "Where it went": the Map's stage list turned
 * into a custody walk below this record. The credit batch is named once at
 * the top; then one step per stage (Biochar product, Delivery, Application,
 * Removal) on a rail, each step listing its records with day and mass,
 * first three then "Show all N".
 */
"use client";

import Link from "next/link";
import { useRef, useState } from "react";
import { flushSync } from "react-dom";
import { CertificateIcon } from "@phosphor-icons/react/dist/ssr";
import { TextAction } from "@/components/ui";
import { TraceThread, TraceTile, TILE_TEXT_INSET_PX } from "@/components/chain-of-custody/map/trace-tile";
import { RECORD_CODE_LINK } from "@/components/ui/record-code-link";
import { INLINE_HIT_AREA } from "@/components/ui/touch-target";
import { recordHref } from "@/lib/record-links";
import { prototypeNodeKey, type PrototypeUsedByGraph, type PrototypeUsedByNode } from "@/lib/prototype-used-by";
import { cn } from "@/lib/utils";
import { MaybeLink, SHOWN_FIRST, kindHeading, kindMeta, kindRank, massText, nodeDay, nodeHref } from "./record-used-by-prototype-shared";

const ROW_DIVIDER = "[border-top:var(--row-divider)] first:[border-top:none]";

interface Step { kind: string; nodes: PrototypeUsedByNode[] }

function stepsOf(graph: PrototypeUsedByGraph): Step[] {
  const byKind = new Map<string, PrototypeUsedByNode[]>();
  for (const node of graph.downstream) byKind.set(node.kind, [...(byKind.get(node.kind) ?? []), node]);
  return [...byKind]
    .sort(([a], [b]) => kindRank(a) - kindRank(b))
    .map(([kind, nodes]) => ({ kind, nodes: [...nodes].sort((a, b) => (a.at ?? "").localeCompare(b.at ?? "") || a.code.localeCompare(b.code)) }));
}

/** The mass that reached each record: summed over the links into it. */
function inboundMass(graph: PrototypeUsedByGraph, node: PrototypeUsedByNode): string | null {
  const key = prototypeNodeKey(node.kind, node.id);
  const edges = graph.edges.filter((edge) => edge.to === key && edge.mass);
  if (edges.length === 0) return null;
  const bases = new Set(edges.map((edge) => edge.mass!.basis));
  if (bases.size > 1) return null;
  return massText({ kg: edges.reduce((sum, edge) => sum + edge.mass!.kg, 0), basis: edges[0].mass!.basis });
}

function StepRecords({ step, graph, timeZone }: { step: Step; graph: PrototypeUsedByGraph; timeZone: string }) {
  const [showAll, setShowAll] = useState(false);
  const listRef = useRef<HTMLUListElement>(null);
  const hidden = step.nodes.length - SHOWN_FIRST;
  const shown = showAll || hidden <= 0 ? step.nodes : step.nodes.slice(0, SHOWN_FIRST);
  const heading = kindHeading(step.kind, step.nodes.length);

  function revealRest() {
    flushSync(() => setShowAll(true));
    listRef.current?.querySelectorAll<HTMLElement>("a, [aria-label]")[SHOWN_FIRST]?.focus();
  }

  return (
    <div className="flex flex-col" style={{ marginLeft: TILE_TEXT_INSET_PX }}>
      <ul ref={listRef} className="flex flex-col">
        {shown.map((node) => {
          const day = nodeDay(node, timeZone);
          const mass = inboundMass(graph, node);
          return (
            <li key={node.id} className={ROW_DIVIDER}>
              <MaybeLink
                href={nodeHref(node)}
                className="group flex min-h-44 items-center gap-12 py-6 body-small hover:bg-[var(--clr-dark-purple-5)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-border-primary)]"
              >
                <span className="flex min-w-0 flex-1 items-baseline gap-12">
                  <span className={cn("text-[var(--color-text-primary)] group-hover:underline", node.name ? "min-w-0 truncate" : "shrink-0 font-mono")}>{node.name ?? node.code}</span>
                  {day && <span className="min-w-0 truncate whitespace-nowrap tabular-nums text-[var(--color-text-secondary)]">{day}</span>}
                </span>
                {mass && <span className="shrink-0 whitespace-nowrap tabular-nums">{mass}</span>}
              </MaybeLink>
            </li>
          );
        })}
      </ul>
      {hidden > 0 && (
        <TextAction aria-expanded={showAll} onClick={showAll ? () => setShowAll(false) : revealRest}>
          {showAll ? "Show less" : `Show all ${step.nodes.length}`}
          <span className="sr-only"> {heading.toLowerCase()}</span>
        </TextAction>
      )}
    </div>
  );
}

export function UsedByWalk({ graph, timeZone }: { graph: PrototypeUsedByGraph; timeZone: string }) {
  const steps = stepsOf(graph);
  const last = steps.length - 1;
  return (
    <div className="flex flex-col gap-12">
      {graph.creditBatches.length > 0 && (
        <p className="flex flex-wrap items-center gap-x-8 body-small text-[var(--color-text-secondary)]">
          <CertificateIcon size={16} aria-hidden className="shrink-0" />
          <span>In {graph.creditBatches.length === 1 ? "credit batch" : "credit batches"}</span>
          {graph.creditBatches.map((batch, index) => {
            const label = batch.name ?? batch.code;
            const separator = index < graph.creditBatches.length - 1 ? "," : "";
            return batch.id.startsWith("fx-")
              ? <span key={batch.id} className={cn("text-[var(--color-text-primary)]", !batch.name && "font-mono")}>{label}{separator}</span>
              : (
                <span key={batch.id}>
                  <Link href={recordHref("creditBatch", batch.id, { facilityId: batch.facilityId })} className={cn(RECORD_CODE_LINK, batch.name && "font-sans", INLINE_HIT_AREA)}>{label}</Link>
                  {separator}
                </span>
              );
          })}
        </p>
      )}
      <ol className="flex flex-col">
        {steps.map((step, index) => {
          const meta = kindMeta(step.kind);
          return (
            <li key={step.kind} className="relative pb-12">
              {index < last ? <TraceThread /> : null}
              <h3 className="flex min-h-44 items-center gap-12 body-small font-medium">
                <TraceTile icon={meta.icon} accent={meta.accent} accentInk={meta.accentInk} />
                <span>{kindHeading(step.kind, step.nodes.length)}</span>
                {step.nodes.length > 1 && <span className="tabular-nums font-normal text-[var(--color-text-tertiary)]">{step.nodes.length}</span>}
              </h3>
              <StepRecords step={step} graph={graph} timeZone={timeZone} />
            </li>
          );
        })}
      </ol>
    </div>
  );
}
