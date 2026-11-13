import type { Icon } from "@phosphor-icons/react";
import { CertificateIcon, StackIcon, TestTubeIcon, WarehouseIcon } from "@phosphor-icons/react/dist/ssr";
import { LINEAGE_NODE_STYLES } from "@/components/chain-of-custody/chain-constants";
import { formatFacilityShortDay } from "@/lib/format-utils";
import { RECORD_LINKS, recordHref, type RecordKind } from "@/lib/record-links";
import type { RecordUsedByNode } from "@/lib/record-used-by-chain";

/** A chain node, or a user the lock read names that the chain read does not reach (any kind string). */
export type UsedByNode = Omit<RecordUsedByNode, "kind"> & { kind: string };

interface KindMeta {
  singular: string;
  plural: string;
  icon: Icon;
  accent: string;
}

const VERIFY_ACCENT = "var(--acc-infra)";
const flow = (kind: keyof typeof LINEAGE_NODE_STYLES) => ({ icon: LINEAGE_NODE_STYLES[kind].icon, accent: LINEAGE_NODE_STYLES[kind].accent });

/** The Flow chart's squares for custody kinds; verification records share one accent. */
const KIND_META: Record<string, KindMeta> = {
  feedstock: { singular: "Feedstock intake", plural: "Feedstock intake", ...flow("feedstock") },
  productionRun: { singular: "Production run", plural: "Production runs", ...flow("productionRun") },
  biocharProduct: { singular: "Biochar product", plural: "Biochar products", ...flow("biocharProduct") },
  order: { singular: "Order", plural: "Orders", ...flow("order") },
  delivery: { singular: "Delivery", plural: "Deliveries", ...flow("delivery") },
  application: { singular: "Application", plural: "Applications", ...flow("application") },
  sample: { singular: "Sample", plural: "Samples", icon: TestTubeIcon, accent: VERIFY_ACCENT },
  creditBatch: { singular: "Credit batch", plural: "Credit batches", icon: CertificateIcon, accent: VERIFY_ACCENT },
  removal: { singular: "Removal", plural: "Removals", icon: StackIcon, accent: VERIFY_ACCENT },
};
const OTHER_META: KindMeta = { singular: "Stock entry", plural: "Stock entries", icon: WarehouseIcon, accent: "var(--color-text-tertiary)" };

/** Kinds that hold material or its claim, in custody order; anything else is listed under the chart. */
export const CUSTODY_KINDS = ["feedstock", "productionRun", "biocharProduct", "order", "delivery", "application", "removal"];

export function isKnownKind(kind: string): boolean {
  return kind in KIND_META;
}

export function kindMeta(kind: string): KindMeta {
  return KIND_META[kind] ?? OTHER_META;
}

export function kindHeading(kind: string, count: number): string {
  const meta = kindMeta(kind);
  return count === 1 ? meta.singular : meta.plural;
}

/** Custody order, then everything else. */
export function kindRank(kind: string): number {
  const index = CUSTODY_KINDS.indexOf(kind);
  return index < 0 ? CUSTODY_KINDS.length : index;
}

/** "Oct 22" on the record's facility clock; null when the record has no date. */
export function nodeDay(node: Pick<UsedByNode, "at" | "calendarDay">, timeZone: string): string | null {
  if (!node.at) return null;
  return formatFacilityShortDay(node.at, timeZone, { calendarDay: node.calendarDay });
}

/** The record's sheet; null when it has none (production runs and samples need their facility). */
export function nodeHref(node: UsedByNode): string | null {
  if (!(node.kind in RECORD_LINKS)) return null;
  const facilityId = node.facilityId ?? undefined;
  if ((node.kind === "productionRun" || node.kind === "sample") && !facilityId) return null;
  return recordHref(node.kind as RecordKind, node.id, { facilityId });
}
