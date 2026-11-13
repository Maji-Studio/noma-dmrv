/**
 * PROTOTYPE ONLY (Used by section round). What the three variants share:
 * kind labels, icons and accents (from the Flow chart), date and mass text,
 * links, and the section frame that lines up with the numbered sections.
 * Delete with the prototype once a variant is picked.
 */
"use client";

import Link from "next/link";
import type { CSSProperties, ReactNode } from "react";
import type { Icon } from "@phosphor-icons/react";
import { CertificateIcon, StackIcon, TestTubeIcon, WarehouseIcon } from "@phosphor-icons/react/dist/ssr";
import { LINEAGE_NODE_STYLES } from "@/components/chain-of-custody/chain-constants";
import { DetailSection } from "@/components/ui/detail-panel";
import { formatDateRange, formatFacilityShortDay, formatMass } from "@/lib/format-utils";
import { MISSING_VALUE } from "@/lib/copy-utils";
import { recordHref } from "@/lib/record-links";
import type { RecordLockLink } from "@/lib/record-lock-view";
import { prototypeNodeKey, type PrototypeUsedByGraph, type PrototypeUsedByMass, type PrototypeUsedByNode } from "@/lib/prototype-used-by";
import { cn } from "@/lib/utils";
import { recordLockLinkHref, recordLockLinkTitle } from "./record-lock-labels";

export interface KindMeta {
  singular: string;
  plural: string;
  icon: Icon;
  accent: string;
  accentInk: string;
}

const VERIFY_ACCENT = { accent: "var(--acc-infra)", accentInk: "var(--acc-infra-ink)" };
const flow = (kind: keyof typeof LINEAGE_NODE_STYLES) => ({ icon: LINEAGE_NODE_STYLES[kind].icon, accent: LINEAGE_NODE_STYLES[kind].accent, accentInk: LINEAGE_NODE_STYLES[kind].accentInk });

export const KIND_META: Record<string, KindMeta> = {
  feedstock: { singular: "Feedstock intake", plural: "Feedstock intake", ...flow("feedstock") },
  productionRun: { singular: "Production run", plural: "Production runs", ...flow("productionRun") },
  biocharProduct: { singular: "Biochar product", plural: "Biochar products", ...flow("biocharProduct") },
  order: { singular: "Order", plural: "Orders", ...flow("order") },
  delivery: { singular: "Delivery", plural: "Deliveries", ...flow("delivery") },
  application: { singular: "Application", plural: "Applications", ...flow("application") },
  sample: { singular: "Sample", plural: "Samples", icon: TestTubeIcon, ...VERIFY_ACCENT },
  creditBatch: { singular: "Credit batch", plural: "Credit batches", icon: CertificateIcon, ...VERIFY_ACCENT },
  removal: { singular: "Removal", plural: "Removals", icon: StackIcon, ...VERIFY_ACCENT },
};
const OTHER_META: KindMeta = { singular: "Stock entry", plural: "Stock entries", icon: WarehouseIcon, accent: "var(--color-text-tertiary)", accentInk: "var(--color-text-secondary)" };

export function kindMeta(kind: string): KindMeta {
  return KIND_META[kind] ?? OTHER_META;
}

export function kindHeading(kind: string, count: number): string {
  const meta = kindMeta(kind);
  return count === 1 ? meta.singular : meta.plural;
}

/** Custody order, then the verification records. */
export const KIND_ORDER = ["feedstock", "productionRun", "biocharProduct", "order", "delivery", "application", "removal", "sample", "creditBatch"];
export const kindRank = (kind: string) => {
  const index = KIND_ORDER.indexOf(kind);
  return index < 0 ? KIND_ORDER.length : index;
};

/** First three, then "Show all N" (the Records list rule). */
export const SHOWN_FIRST = 3;

/** "Oct 22" on the record's facility clock; null when the record has no date. */
export function nodeDay(node: Pick<PrototypeUsedByNode, "at" | "calendarDay">, timeZone: string): string | null {
  if (!node.at) return null;
  return formatFacilityShortDay(node.at, timeZone, { calendarDay: node.calendarDay });
}

/** "1.9 t dry biochar", "7.5 t wet", no-break spaces so a phone never splits it. */
export function massText(mass: PrototypeUsedByMass | null | undefined): string | null {
  // A reversal can leave a few grams behind; a figure that rounds to 0 kg is left out.
  if (!mass || Math.round(mass.kg) <= 0) return null;
  return `${formatMass(mass.kg)} ${mass.basis === "wet" ? "wet" : "dry biochar"}`.replace(/ /g, " ");
}

export function nodeHref(node: PrototypeUsedByNode): string | null {
  if (node.fixture) return null;
  const facilityId = node.facilityId ?? undefined;
  if ((node.kind === "productionRun" || node.kind === "sample") && !facilityId) return null;
  return recordHref(node.kind, node.id, { facilityId });
}

/** One row of the Used by list: from the lock read, with what the prototype read adds. */
export interface UsedByRow {
  key: string;
  kind: string;
  /** Name before code where the record has one (credit batches). */
  title: string;
  /** The code when the title is a name. */
  code: string | null;
  day: string | null;
  mass: string | null;
  href: string | null;
}

export function usedByRows(links: RecordLockLink[], graph: PrototypeUsedByGraph | null | undefined, timeZone: string): UsedByRow[] {
  const nodes = new Map((graph?.downstream ?? []).map((node) => [prototypeNodeKey(node.kind, node.id), node]));
  const batches = new Map((graph?.creditBatches ?? []).map((batch) => [batch.id, batch]));
  return links.map((link) => {
    const key = prototypeNodeKey(link.kind, link.id);
    const node = nodes.get(key);
    const batch = link.kind === "creditBatch" ? batches.get(link.id) : undefined;
    const known = link.kind in KIND_META;
    const name = batch?.name ?? (node?.kind === "creditBatch" ? node.name : null);
    const code = link.label ?? node?.code ?? null;
    let day: string | null = node ? nodeDay(node, timeZone) : null;
    if (batch) day = formatDateRange(batch.startDate, batch.endDate);
    else if (link.kind === "removal" && link.period) day = formatDateRange(link.period.startedOn, link.period.completedOn);
    return {
      key,
      kind: link.kind,
      title: !known ? recordLockLinkTitle(link) : name ?? code ?? recordLockLinkTitle(link),
      code: name ? code : null,
      day,
      mass: massText(graph?.took[key]),
      href: link.id.startsWith("fx-") ? null : recordLockLinkHref(link),
    };
  });
}

/** Rows grouped by kind in custody order. */
export function groupRows(rows: UsedByRow[]): { kind: string; rows: UsedByRow[] }[] {
  const groups = new Map<string, UsedByRow[]>();
  for (const row of rows) groups.set(row.kind, [...(groups.get(row.kind) ?? []), row]);
  return [...groups].sort(([a], [b]) => kindRank(a) - kindRank(b)).map(([kind, grouped]) => ({ kind, rows: grouped }));
}

/**
 * Lines the section up with the numbered sections' content (24px rail + 12px
 * gap) when the sheet above is numbered, and drops the hairline the numbered
 * sections do not have.
 */
const ALIGN_WITH_NUMBERED = "[div:has(>section)+&]:pl-36 [div:has(>section)+&]:border-t-0";

export function UsedBySection({ children }: { children: ReactNode }) {
  return (
    <DetailSection title="Used by" className={ALIGN_WITH_NUMBERED}>
      {children}
    </DetailSection>
  );
}

export function UsedByNone() {
  return <p className="body-medium text-[var(--color-text-tertiary)]" data-empty>{MISSING_VALUE.none}</p>;
}

/** A row or node that opens its record's sheet; fixture records render the same box without a link. */
export function MaybeLink({ href, className, children, label, style }: { href: string | null; className?: string; children: ReactNode; label?: string; style?: CSSProperties }) {
  if (href) return <Link href={href} className={className} aria-label={label} style={style}>{children}</Link>;
  return <span className={cn(className, "cursor-default")} aria-label={label} role={label ? "img" : undefined} style={style}>{children}</span>;
}
