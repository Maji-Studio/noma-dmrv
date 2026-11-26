"use client";

import Link from "next/link";
import { useId, useState } from "react";
import { ArrowRightIcon, CertificateIcon, StackIcon } from "@phosphor-icons/react/dist/ssr";
import { RECORD_CODE_LINK, RECORD_NAME_LINK } from "@/components/ui/record-code-link";
import { INLINE_HIT_AREA } from "@/components/ui/touch-target";
import { recordHref } from "@/lib/record-links";
import { usedByNodeKey, type RecordUsedByBatch } from "@/lib/record-used-by-chain";
import { cn } from "@/lib/utils";
import { isKnownKind, kindHeading, kindMeta, nodeDay, nodeHref, type UsedByNode } from "./record-used-by-kinds";
import { dayRange, directUserGroups, laterRemovals, namedBatches, SHOWN_PER_KIND, type UsedByGraph } from "./record-used-by-graph";

const SQUARE = 28;
const SQUARE_ICON = 15;
const LINE_ICON = 12;
const ARROW_ICON = 14;
const FOCUS = "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-border-primary)]";
const QUIET_UNDERLINE = "underline decoration-[color:var(--color-border-primary)] underline-offset-4 group-hover:decoration-current";
/** The compact list's frame: about seven 44px rows, then it scrolls on its own. */
const LIST_FRAME = "max-h-320 overflow-y-auto border-y border-[var(--color-border-secondary)]";

const keyOf = (node: UsedByNode) => usedByNodeKey(node.kind, node.id);

/** Mid-sentence kind noun; glossary terms keep their capital (Samples, Removals). */
function kindNoun(kind: string, count: number): string {
  const heading = kindHeading(kind, count);
  return kind === "sample" || kind === "removal" ? heading : heading.toLowerCase();
}

/** A record's code, or a stock entry's plain label. */
function nodeLabel(node: UsedByNode): string {
  return node.name ?? node.code;
}

/** The Flow chart's square for the kind, in its accent. */
function KindSquare({ kind }: { kind: string }) {
  const meta = kindMeta(kind);
  const KindIcon = meta.icon;
  return (
    <span className="grid shrink-0 place-items-center" style={{ width: SQUARE, height: SQUARE, background: meta.accent }} aria-hidden>
      <KindIcon size={SQUARE_ICON} weight="bold" color="var(--paper)" />
    </span>
  );
}

/** One record: its square, code and day; opens its sheet. */
function NextTile({ node, timeZone }: { node: UsedByNode; timeZone: string }) {
  const href = nodeHref(node);
  const day = nodeDay(node, timeZone);
  const body = (
    <>
      <KindSquare kind={node.kind} />
      <span className="flex flex-col">
        <span className={cn("text-[length:var(--text-xs)] leading-snug text-[var(--color-text-primary)]", isKnownKind(node.kind) && "font-mono", href && QUIET_UNDERLINE)}>
          {nodeLabel(node)}
        </span>
        {day && <span className="body-caption text-[var(--color-text-tertiary)]">{day}</span>}
      </span>
    </>
  );
  const className = cn("group flex min-h-44 items-center gap-8", FOCUS);
  if (!href) return <span className={className}>{body}</span>;
  return <Link href={href} className={className} aria-label={`${kindMeta(node.kind).singular} ${nodeLabel(node)}${day ? `, ${day}` : ""}`}>{body}</Link>;
}

/** Show all / Show less: small, quiet and underlined, belonging to the tiles above it. */
function GroupToggle({ open, controls, onToggle }: { open: boolean; controls: string; onToggle: () => void }) {
  return (
    <button
      type="button"
      aria-expanded={open}
      aria-controls={open ? controls : undefined}
      onClick={onToggle}
      className={cn(
        "self-start body-small text-[var(--color-text-secondary)] underline decoration-[color:var(--color-border-primary)] underline-offset-4 hover:text-[var(--color-text-primary)] hover:decoration-current",
        INLINE_HIT_AREA,
        FOCUS,
      )}
    >
      {open ? "Show less" : "Show all"}
    </button>
  );
}

/** The rest of a big group as 44px rows, code and day, oldest first; two columns from 640px, its own scroll past about seven rows. */
function CompactList({ id, nodes, timeZone, label }: { id: string; nodes: UsedByNode[]; timeZone: string; label: string }) {
  return (
    // A scroll region is focusable so the keyboard can scroll it.
    <div id={id} role="region" aria-label={label} tabIndex={0} className={cn(LIST_FRAME, FOCUS)}>
      <ul className="grid gap-x-48 sm:grid-cols-2">
        {nodes.map((node) => {
          const href = nodeHref(node);
          const day = nodeDay(node, timeZone);
          const row = (
            <>
              <span className={cn("text-[length:var(--text-xs)] text-[var(--color-text-primary)]", isKnownKind(node.kind) && "font-mono", href && QUIET_UNDERLINE)}>
                {nodeLabel(node)}
              </span>
              {day && <span className="body-caption text-[var(--color-text-tertiary)]">{day}</span>}
            </>
          );
          const rowClass = cn("group flex min-h-44 items-center gap-12", FOCUS);
          return <li key={keyOf(node)}>{href ? <Link href={href} className={rowClass}>{row}</Link> : <span className={rowClass}>{row}</span>}</li>;
        })}
      </ul>
    </div>
  );
}

/**
 * One kind: its caption and up to three tiles. More than three (a big mixed
 * bin feeding 48 production runs) adds one quiet line, "and 45 more, Apr 8 to
 * Jun 28", whose Show all opens the rest as a compact list and closes it again.
 */
function KindGroup({ kind, nodes, timeZone }: { kind: string; nodes: UsedByNode[]; timeZone: string }) {
  const [open, setOpen] = useState(false);
  const id = useId();
  const shown = nodes.slice(0, SHOWN_PER_KIND);
  const rest = nodes.slice(SHOWN_PER_KIND);
  const range = dayRange(rest, timeZone);
  return (
    <div className="flex flex-col gap-4">
      <span className="body-caption text-[var(--color-text-secondary)]">{kindHeading(kind, nodes.length)}</span>
      <ul className="flex flex-wrap gap-x-32 gap-y-4">
        {shown.map((node) => <li key={keyOf(node)}><NextTile node={node} timeZone={timeZone} /></li>)}
      </ul>
      {rest.length > 0 && (
        <>
          <p className="flex flex-wrap items-baseline gap-x-12 body-small text-[var(--color-text-secondary)]">
            <span>and {rest.length} more{range ? `, ${range}` : ""}</span>
            <GroupToggle open={open} controls={id} onToggle={() => setOpen(!open)} />
          </p>
          {open && <CompactList id={id} nodes={rest} timeZone={timeZone} label={`${rest.length} more ${kindNoun(kind, rest.length)}`} />}
        </>
      )}
    </div>
  );
}

/** "A", "A and B", "A, B and C", in running text. */
function joinWithAnd(parts: React.ReactNode[]): React.ReactNode[] {
  return parts.flatMap((part, index) => (index === 0 ? [part] : [index === parts.length - 1 ? " and " : ", ", part]));
}

function NodeLink({ node }: { node: UsedByNode }) {
  const href = nodeHref(node);
  if (!href) return <span className="whitespace-nowrap font-mono">{nodeLabel(node)}</span>;
  return <Link href={href} className={cn(RECORD_CODE_LINK, INLINE_HIT_AREA)}>{nodeLabel(node)}</Link>;
}

function BatchLink({ batch }: { batch: RecordUsedByBatch }) {
  return (
    <Link href={recordHref("creditBatch", batch.id, { facilityId: batch.facilityId })} className={cn(batch.name ? RECORD_NAME_LINK : RECORD_CODE_LINK, INLINE_HIT_AREA)}>
      {batch.name ?? batch.code}
    </Link>
  );
}

/** Appended to a batch the record reaches only through a failed run's emissions (#1714). */
export const EMISSIONS_ONLY_SUFFIX = ", emissions only";

/** One "Credit batch: A and B" group; `suffix` closes an emissions-only group ("CB-26-001, emissions only"). */
function BatchGroup({ batches, suffix }: { batches: RecordUsedByBatch[]; suffix?: string }) {
  return (
    <span className="flex flex-wrap items-center gap-x-6">
      <CertificateIcon size={LINE_ICON} aria-hidden className="shrink-0" />
      {batches.length === 1 ? "Credit batch:" : "Credit batches:"}
      <span>{joinWithAnd(batches.map((batch) => <BatchLink key={batch.id} batch={batch} />))}{suffix}</span>
    </span>
  );
}

/**
 * "Credit batch: CB-26-003" and "Removal: RM-26-003", the forms' label wording, as one quiet caption line under the records.
 * A batch reached only through a failed run's emissions reads "CB-26-003, emissions only" (#1714).
 */
function BatchLine({ batches, removals }: { batches: RecordUsedByBatch[]; removals: UsedByNode[] }) {
  if (batches.length === 0 && removals.length === 0) return null;
  const material = batches.filter((batch) => !batch.dependency);
  const emissionsOnly = batches.filter((batch) => batch.dependency === "production-emissions");
  return (
    <p className="flex flex-wrap items-center gap-x-24 gap-y-8 body-caption text-[var(--color-text-secondary)]">
      {material.length > 0 && <BatchGroup batches={material} />}
      {emissionsOnly.length > 0 && <BatchGroup batches={emissionsOnly} suffix={EMISSIONS_ONLY_SUFFIX} />}
      {removals.length > 0 && (
        <span className="flex flex-wrap items-center gap-x-6">
          <StackIcon size={LINE_ICON} aria-hidden className="shrink-0" />
          {removals.length === 1 ? "Removal:" : "Removals:"}
          {joinWithAnd(removals.map((node) => <NodeLink key={keyOf(node)} node={node} />))}
        </span>
      )}
    </p>
  );
}

/**
 * A Failed run's quiet emissions caption on its sheet (#1714), in the credit
 * batch caption's frame: no credit batch matches yet, and one link goes to the
 * credit batches. Warnings and failed reads are a `Notice` instead; a counted
 * run is listed in Used by as "CB-26-003, emissions only".
 */
export function EmissionsLine({ lead, action }: {
  lead: string;
  action?: { label: string; href: string } | null;
}) {
  return (
    <p className="flex flex-wrap items-center gap-x-6 gap-y-4 body-caption text-[var(--color-text-secondary)]">
      <CertificateIcon size={LINE_ICON} aria-hidden className="shrink-0" />
      <span>{lead}</span>
      {action && <Link href={action.href} className={cn("underline underline-offset-4", INLINE_HIT_AREA)}>{action.label}</Link>}
    </p>
  );
}

/**
 * "Open in Traceability", the section's one action, quiet at the right of its
 * title row: sentence case with a trailing arrow like the dashboard's section
 * links, so it never competes with the records or their Show all.
 */
export function TraceabilityLink({ href }: { href: string }) {
  return (
    <Link
      href={href}
      className={cn("inline-flex items-center gap-6 body-small font-medium text-[var(--color-text-primary)] hover:underline hover:underline-offset-4", INLINE_HIT_AREA, FOCUS)}
    >
      Open in Traceability
      <ArrowRightIcon size={ARROW_ICON} weight="bold" className="shrink-0 text-[var(--color-interaction)]" aria-hidden />
    </Link>
  );
}

/**
 * Only the records that used this one directly, one group per kind, as Flow
 * squares with code and day. The credit batch and the Removal the chain
 * reaches later close it as one quiet caption line.
 */
export function UsedByNextStep({ graph, timeZone }: { graph: UsedByGraph; timeZone: string }) {
  return (
    // 24px before the caption line keeps it apart from the records it describes.
    <div className="flex flex-col gap-24">
      {directUserGroups(graph).map(([kind, nodes]) => <KindGroup key={kind} kind={kind} nodes={nodes} timeZone={timeZone} />)}
      <BatchLine batches={namedBatches(graph)} removals={laterRemovals(graph)} />
    </div>
  );
}
