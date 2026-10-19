import Link from "next/link";
import { MultilineDetail } from "../multiline-detail";
import { Notice } from "@/components/ui/notice";
import { removalLineBlockerMessage, type RemovalAdvisory, type RemovalBlocker } from "@/lib/certification/removal-blockers";
import { removalFindingFixLink } from "@/lib/certification/removal-finding-links";

interface CompilationBlockersProps {
  blockers: string[];
  showHeading?: boolean;
}

interface CompilationWarningsProps {
  warnings: string[];
  showEmpty?: boolean;
}

export function CompilationBlockers({
  blockers,
  showHeading = true,
}: CompilationBlockersProps) {
  if (blockers.length === 0) return null;

  return (
    <Notice tone="error" title={showHeading ? "Compilation blocked" : undefined}>
      <ul className="list-disc pl-16">
        {blockers.map((blocker) => (
          <li key={blocker}><MultilineDetail>{blocker}</MultilineDetail></li>
        ))}
      </ul>
    </Notice>
  );
}

export function CompilationWarnings({
  warnings,
  showEmpty = false,
}: CompilationWarningsProps) {
  if (warnings.length === 0) {
    return showEmpty ? (
      <p className="body-small text-[var(--color-text-tertiary)]">
        No omitted captured values.
      </p>
    ) : null;
  }

  return (
    <ul className="list-disc space-y-2 pl-16 body-small text-[var(--color-text-secondary)]">
      {warnings.map((warning) => (
        <li key={warning}>{warning}</li>
      ))}
    </ul>
  );
}

interface FindingListProps {
  facilityId: string;
  /** Ids of the Removal's credit batches; one batch makes batch-level links land on it. */
  memberBatchIds?: readonly string[];
}

/** The finding's one repair destination, or nothing when it has none. */
function FindingFixLink({ finding, facilityId, memberBatchIds }: { finding: Pick<RemovalBlocker, "fixTarget"> } & FindingListProps) {
  const fix = removalFindingFixLink(finding, facilityId, memberBatchIds);
  if (!fix) return null;
  return (
    <Link
      href={fix.href}
      className="inline-flex min-h-44 items-center body-caption font-medium text-[var(--color-interaction)] underline-offset-2 hover:underline"
    >
      {fix.label}
    </Link>
  );
}

/** Blockers stop submission. Each names the affected line where it has one and links to its fix. */
export function RemovalBlockerList({ blockers, facilityId, memberBatchIds }: FindingListProps & { blockers: RemovalBlocker[] }) {
  if (blockers.length === 0) return null;
  return (
    <Notice tone="error">
      <ul role="list" className="flex flex-col gap-8">
        {blockers.map((blocker) => (
          <li key={`${blocker.code}:${blocker.lineRef?.componentId ?? ""}:${blocker.message}`} className="flex flex-col gap-2">
            <span><MultilineDetail>{removalLineBlockerMessage(blocker)}</MultilineDetail></span>
            <FindingFixLink finding={blocker} facilityId={facilityId} memberBatchIds={memberBatchIds} />
          </li>
        ))}
      </ul>
    </Notice>
  );
}

/** Advisories never block. They render as plain list items for a warning Notice. */
export function RemovalAdvisoryList({ advisories, facilityId, memberBatchIds }: FindingListProps & { advisories: RemovalAdvisory[] }) {
  if (advisories.length === 0) return null;
  return (
    <ul role="list" className="flex flex-col gap-8 body-small text-[var(--color-text-secondary)]">
      {advisories.map((advisory) => (
        <li key={`${advisory.code}:${advisory.message}`} className="flex flex-col gap-2">
          <span>{advisory.message}</span>
          <FindingFixLink finding={advisory} facilityId={facilityId} memberBatchIds={memberBatchIds} />
        </li>
      ))}
    </ul>
  );
}
