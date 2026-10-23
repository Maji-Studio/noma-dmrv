/**
 * An entry that another credit batch's Removal reports or will report (#1059):
 * a fact line ("Recorded after RM-26-009 was sent.", when a Removal was sent
 * first) and one line that says where it goes. Waiting reads in warning ink with the one action that clears it; the
 * row around it stays white. Shared by the entry row and the credit batch
 * Overview.
 */
"use client";

import { Fragment } from "react";
import { RECORD_CODE_LINK } from "@/components/ui/record-code-link";
import Link from "next/link";
import { ArrowBendDownRightIcon, CheckIcon, ClockIcon } from "@phosphor-icons/react/dist/ssr";
import { lateEntryView, type LateEntryDestination, type LateEntryFacts } from "@/lib/certification/late-entry-view";
import { cn } from "@/lib/utils";
import { useCanManageTemplates } from "./template-permission";

const ICON = 14;
const ACTION_LINK = "inline-flex min-h-44 items-center font-medium md:min-h-24 text-[var(--color-text-interaction-primary)] underline decoration-[color:var(--color-border-primary)] underline-offset-4 hover:decoration-current";
const LINE = "flex items-start gap-x-4 body-caption";

/** Rows are click targets; a link inside must not also open the row. */
function stop(event: { stopPropagation: () => void }) {
  event.stopPropagation();
}

function CodeLink({ href, children }: { href: string; children: string }) {
  return <Link href={href} className={RECORD_CODE_LINK} onClick={stop}>{children}</Link>;
}

/** "Goes into RM-26-010 of credit batch CB-26-010." or "Reported in RM-26-010 of credit batch CB-26-010." */
function placedText(destination: Extract<LateEntryDestination, { kind: "draft" | "reported" }>) {
  const removal = <CodeLink href={destination.removalHref}>{destination.removalCode}</CodeLink>;
  const lead = destination.kind === "reported" ? "Reported in" : "Goes into";
  const { creditBatches } = destination;
  if (creditBatches.length === 0) return <>{lead} {removal}.</>;
  return (
    <>
      {lead} {removal} of {creditBatches.length === 1 ? "credit batch" : "credit batches"}{" "}
      {creditBatches.map((batch, index) => (
        <Fragment key={batch.href}>{index > 0 && ", "}<CodeLink href={batch.href}>{batch.code}</CodeLink></Fragment>
      ))}.
    </>
  );
}

export function LateEntryDestinationLine({ destination, className, withAction = true }: {
  destination: LateEntryDestination;
  className?: string;
  withAction?: boolean;
}) {
  if (destination.kind === "waiting") {
    return (
      <span className={cn(LINE, "flex-col gap-y-2 text-[var(--st-wait)]", className)}>
        <span className="flex items-start gap-x-4">
          <ClockIcon size={ICON} weight="bold" aria-hidden className="mt-2 shrink-0" />
          <span>{destination.text}</span>
        </span>
        {withAction && destination.action && <Link href={destination.action.href} className={cn(ACTION_LINK, "ml-18")} onClick={stop}>{destination.action.label}</Link>}
      </span>
    );
  }
  const Icon = destination.kind === "reported" ? CheckIcon : ArrowBendDownRightIcon;
  const tone = destination.kind === "reported" ? "text-[var(--st-ok)]" : "text-[var(--color-text-tertiary)]";
  return (
    <span className={cn(LINE, "text-[var(--color-text-primary)]", className)}>
      <Icon size={ICON} weight="bold" aria-hidden className={cn("mt-2 shrink-0", tone)} />
      <span>{placedText(destination)}</span>
    </span>
  );
}

/** Both lines under an entry. Nothing for an entry no other credit batch's Removal reports or will report. */
export function LateEntryStatus({ entry, facilityId, className }: { entry: LateEntryFacts; facilityId: string; className?: string }) {
  const canManage = useCanManageTemplates();
  const view = lateEntryView(entry, facilityId, { canManage });
  if (!view) return null;
  return (
    <span className={cn("flex flex-col gap-2", className)} data-late-entry>
      {view.recordedAfter && (
        <span className="body-caption text-[var(--color-text-secondary)]">
          Recorded after <CodeLink href={view.recordedAfter.removalHref}>{view.recordedAfter.removalCode}</CodeLink> was sent.
        </span>
      )}
      <LateEntryDestinationLine destination={view.destination} />
    </span>
  );
}
