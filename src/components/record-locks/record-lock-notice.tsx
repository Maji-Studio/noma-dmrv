import Link from "next/link";
import { Fragment, type ReactNode } from "react";
import { Notice } from "@/components/ui/notice";
import type { RecordLockLink, RecordLockView } from "@/lib/record-lock-view";
import { recordLockLinkHref, recordLockLinkText } from "./record-lock-labels";

/** Holders named inline; the rest are counted and listed under "Used by". */
const NAMED_HOLDERS = 2;

function HolderLink({ link }: { link: RecordLockLink }) {
  const href = recordLockLinkHref(link);
  const text = recordLockLinkText(link);
  return href ? <Link href={href} className="underline underline-offset-4 text-[var(--color-text-primary)]">{text}</Link> : <>{text}</>;
}

/** "production run PR-1, delivery DL-2 and 3 more", each named holder a link. */
function HolderList({ holders }: { holders: readonly RecordLockLink[] }) {
  const named = holders.slice(0, NAMED_HOLDERS);
  const more = holders.length - named.length;
  const parts: ReactNode[] = named.map(link => <HolderLink key={`${link.kind}:${link.id}`} link={link} />);
  if (more > 0) parts.push(`${more} more`);
  return (
    <>
      {parts.map((part, index) => (
        <Fragment key={index}>
          {index > 0 && (index === parts.length - 1 ? " and " : ", ")}
          {part}
        </Fragment>
      ))}
    </>
  );
}

/**
 * The one lock line: what holds the record, as links, and how to free it.
 * Open records have no line. Storage bins name their stock history instead
 * of a record, because no single record holds a bin.
 */
export function RecordLockNotice({ lock, subject = "record", inUseLocksNothing = false }: {
  lock: RecordLockView | undefined;
  subject?: "record" | "storageBin";
  /** The kind keeps every field free while In use (a Sample), so only Sent has a line. */
  inUseLocksNothing?: boolean;
}) {
  if (!lock || lock.level === "open") return null;
  if (lock.level === "inUse" && inUseLocksNothing) return null;
  if (subject === "storageBin") {
    return (
      <Notice tone="info" data-record-lock-notice={lock.level}>
        In use by its stock history, so the storage type and feedstock type are locked.
      </Notice>
    );
  }
  if (lock.level === "sent") {
    return (
      <Notice tone="info" data-record-lock-notice="sent">
        Sent with <HolderList holders={lock.heldBy} />, so every field is locked. {lock.howToFree}
      </Notice>
    );
  }
  const plural = lock.heldBy.length > 1;
  return (
    <Notice tone="info" data-record-lock-notice="inUse">
      In use by <HolderList holders={lock.heldBy} />, so fields that feed {plural ? "their" : "its"} numbers are locked. {lock.howToFree}
    </Notice>
  );
}
