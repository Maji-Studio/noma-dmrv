import Link from "next/link";
import { DetailSection } from "@/components/ui/detail-panel";
import { MISSING_VALUE } from "@/lib/copy-utils";
import type { RecordLockView } from "@/lib/record-lock-view";
import { recordLockLinkHref, recordLockLinkTitle } from "./record-lock-labels";

/**
 * "Used by": every record that took a number from this one, each opening its
 * own sheet through the shared deep links. Shown on every read sheet, after
 * the record's own sections; nothing renders until the lock read answers.
 */
export function RecordUsedBy({ lock }: { lock: RecordLockView | undefined }) {
  if (!lock) return null;
  return (
    <DetailSection title="Used by">
      {lock.usedBy.length === 0 ? (
        <p className="body-medium text-[var(--color-text-tertiary)]" data-empty>{MISSING_VALUE.none}</p>
      ) : (
        <ul className="flex flex-col" aria-label="Used by">
          {lock.usedBy.map((link) => {
            const href = recordLockLinkHref(link);
            const title = recordLockLinkTitle(link);
            return (
              <li key={`${link.kind}:${link.id}`} className="flex min-h-44 items-center body-medium">
                {href ? <Link href={href} className="underline underline-offset-4">{title}</Link> : title}
              </li>
            );
          })}
        </ul>
      )}
    </DetailSection>
  );
}
