import { recordHref } from "@/lib/record-links";
import { formatDate, formatDateRange } from "@/lib/format-utils";
import type { RecordLockLink, RecordLockView } from "@/lib/record-lock-view";

export const RECORD_LOCK_LEVEL_LABELS: Record<RecordLockView["level"], string> = {
  open: "Open",
  inUse: "In use",
  sent: "Sent",
};

/** The Sent tag when sending every holding Removal was started and not finished (matches the Removal's own badge). */
export const RECORD_LOCK_INTERRUPTED_LABEL = "Interrupted";
export const RECORD_LOCK_SENT_TITLE = "Sent to Isometric";
export const RECORD_LOCK_INTERRUPTED_TITLE = "Sending to Isometric was started and not finished";

/** Sent with every holder interrupted. Mixed or normal Sent keeps "Sent". */
export function isInterruptedLockDisplay(lock: RecordLockView | undefined): boolean {
  if (lock?.level !== "sent") return false;
  const interrupted = lock.interruptedHolders ?? [];
  return lock.heldBy.length > 0 && interrupted.length >= lock.heldBy.length;
}

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
    case "feedstock": return recordHref("feedstock", link.id, { facilityId: facility });
    case "productionRun": return facility ? recordHref("productionRun", link.id, { facilityId: facility }) : null;
    case "sample": return facility ? recordHref("sample", link.id, { facilityId: facility }) : null;
    case "biocharProduct": return recordHref("biocharProduct", link.id, { facilityId: facility });
    case "order": return recordHref("order", link.id, { facilityId: facility });
    case "delivery": return recordHref("delivery", link.id, { facilityId: facility });
    case "application": return recordHref("application", link.id, { facilityId: facility });
    case "creditBatch": return recordHref("creditBatch", link.id, { facilityId: facility });
    case "removal": return recordHref("removal", link.id, { facilityId: facility });
    case "ghgStatement": return recordHref("ghgStatement", link.id, { facilityId: facility });
    default: return null;
  }
}
