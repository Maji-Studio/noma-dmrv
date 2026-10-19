import { formatDate, formatDateRange } from "@/lib/format-utils";
import { ghgStatementDeepLinkHref } from "@/lib/ghg-statement-links";
import { applicationDeepLinkHref } from "@/lib/application-links";
import { biocharProductDeepLinkHref } from "@/lib/biochar-product-links";
import { certificationRemovalsHref, productionRunDeepLinkHref } from "@/lib/certification/links";
import { creditBatchDeepLinkHref } from "@/lib/credit-batch-links";
import { deliveryDeepLinkHref } from "@/lib/delivery-links";
import { feedstockDeepLinkHref } from "@/lib/feedstock-links";
import { orderDeepLinkHref } from "@/lib/order-links";
import type { RecordLockLink, RecordLockView } from "@/lib/record-lock-view";
import { sampleDetailHref } from "@/lib/sample-create-intent";

export const RECORD_LOCK_LEVEL_LABELS: Record<RecordLockView["level"], string> = {
  open: "Open",
  inUse: "In use",
  sent: "Sent",
};

/** Mid-sentence nouns. Glossary terms keep their capital (Removal, Sample). */
const KIND_NOUNS: Record<string, string> = {
  feedstock: "feedstock", productionRun: "production run", sample: "Sample", biocharProduct: "biochar product",
  order: "order", delivery: "delivery", application: "application", creditBatch: "credit batch",
  removal: "Removal", stockEntry: "stock entry", storageLocation: "storage bin", ghgStatement: "GHG Statement",
};

function capitalize(text: string): string {
  return text.charAt(0).toUpperCase() + text.slice(1);
}

/** "production run PR-26-004", "Removal Jan 1 to Mar 31, 2026", "stock entry in North hopper". */
export function recordLockLinkText(link: RecordLockLink): string {
  if (link.kind === "binReference") return `${capitalize(link.label ?? "")} (${link.count ?? 0})`;
  const noun = KIND_NOUNS[link.kind] ?? "record";
  if (link.kind === "removal") {
    return link.period ? `${noun} ${formatDateRange(link.period.startedOn, link.period.completedOn)}` : noun;
  }
  if (link.kind === "ghgStatement") {
    if (link.period) return `${noun} ${formatDateRange(link.period.startedOn, link.period.completedOn)}`;
    return link.endsOn ? `${noun} ending ${formatDate(link.endsOn)}` : noun;
  }
  if (link.kind === "stockEntry") return link.label ? `${noun} in ${link.label}` : noun;
  return link.label ? `${noun} ${link.label}` : noun;
}

/** The same text, starting a line ("Used by" rows). */
export function recordLockLinkTitle(link: RecordLockLink): string {
  return capitalize(recordLockLinkText(link));
}

/**
 * The record's own sheet, through the shared deep links. Stock entries and bin
 * references have no sheet of their own and return null.
 */
export function recordLockLinkHref(link: RecordLockLink): string | null {
  const facility = link.facilityId ?? undefined;
  switch (link.kind) {
    case "feedstock": return feedstockDeepLinkHref(link.id, facility);
    case "productionRun": return facility ? productionRunDeepLinkHref(link.id, facility) : null;
    case "sample": return facility ? sampleDetailHref(facility, link.id) : null;
    case "biocharProduct": return biocharProductDeepLinkHref(link.id, facility);
    case "order": return orderDeepLinkHref(link.id, facility);
    case "delivery": return deliveryDeepLinkHref(link.id, facility);
    case "application": return applicationDeepLinkHref(link.id, facility);
    case "creditBatch": return creditBatchDeepLinkHref(link.id, facility);
    case "removal": return certificationRemovalsHref({ ...(facility ? { facility } : {}), removal: link.id });
    case "ghgStatement": return ghgStatementDeepLinkHref(link.id, facility);
    default: return null;
  }
}
