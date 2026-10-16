"use client";

/**
 * PROTOTYPE (throwaway): the hover card for a credit batch on the timeline.
 * Base UI PreviewCard (hover card for links): it opens on hover or focus of the
 * bar, stays open while the pointer is on it, and its footer link is clickable.
 * Elevated surface per the design system: paper, full-ink border, no shadow.
 */
import Link from "next/link";
import type { ReactNode } from "react";
import { PreviewCard } from "@base-ui/react/preview-card";
import { ArrowRightIcon, CalendarBlankIcon, LeafIcon, WarningCircleIcon } from "@phosphor-icons/react/dist/ssr";
import { StatusBadge } from "@/components/ui/status-badge";
import { cn } from "@/lib/utils";
import { STATE_BADGE, type StubBatch } from "./list-model";
import { MUTED, periodLabel, tons } from "./list-parts";

const OPEN_DELAY_MS = 200;
const CLOSE_DELAY_MS = 120;
const SIDE_OFFSET_PX = 8;

function Figure({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex flex-col gap-2">
      <dt className={cn("body-caption", MUTED)}>{label}</dt>
      <dd className="body-large tabular-nums">{value}</dd>
    </div>
  );
}

function HoverCardBody({ batch, href }: { batch: StubBatch; href: string }) {
  const badge = STATE_BADGE[batch.state];
  const notIn = batch.applied - batch.inRemoval;
  return (
    <div className="flex w-[300px] flex-col">
      <div className="flex flex-col gap-10 px-16 pt-16 pb-12">
        <div className="flex items-center justify-between gap-12">
          <span className="body-medium font-medium tabular-nums">{batch.code}</span>
          <StatusBadge status={badge.status} label={badge.label} size="small" />
        </div>
        <div className={cn("flex flex-col gap-4 body-small", MUTED)}>
          <span className="inline-flex items-center gap-6">
            <LeafIcon size={16} aria-hidden />
            {batch.feedstock}
          </span>
          <span className="inline-flex items-center gap-6">
            <CalendarBlankIcon size={16} aria-hidden />
            {periodLabel(batch)}
          </span>
        </div>
      </div>
      {batch.state === "blocking" && (
        <div className="flex items-center gap-8 bg-[var(--st-bad-bg)] px-16 py-8 body-small font-medium">
          <WarningCircleIcon size={16} weight="fill" className="shrink-0 text-[var(--st-bad)]" aria-hidden />
          {batch.blocking} blocking {batch.blocking === 1 ? "item" : "items"}
        </div>
      )}
      <dl className="grid grid-cols-2 gap-12 border-t border-[var(--color-border-tertiary)] px-16 py-12">
        <Figure label="Produced" value={tons(batch.produced)} />
        <Figure label="Applied" value={tons(batch.applied)} />
      </dl>
      <div className="flex flex-wrap items-center gap-6 border-t border-[var(--color-border-tertiary)] px-16 py-10 body-small">
        {batch.removals.length > 0 ? (
          <>
            <span className={MUTED}>In</span>
            {batch.removals.map((code) => (
              <span key={code} className="border border-[var(--color-border-secondary)] px-6 body-caption font-medium tabular-nums">
                {code}
              </span>
            ))}
            {notIn > 0.005 && <span className={MUTED}>, {tons(notIn)} not in a Removal</span>}
          </>
        ) : (
          <span className={MUTED}>Not in a Removal</span>
        )}
      </div>
      <Link href={href} className="flex min-h-44 items-center justify-between gap-8 border-t border-[var(--ink)] px-16 label-button hover:bg-[var(--color-surface-medium)]">
        Open batch page
        <ArrowRightIcon size={16} aria-hidden />
      </Link>
    </div>
  );
}

/** The bar's link, with the hover card. `children` draws the bar. */
export function BatchHoverCard({ batch, href, label, className, children }: { batch: StubBatch; href: string; label: string; className?: string; children: ReactNode }) {
  return (
    <PreviewCard.Root>
      <PreviewCard.Trigger delay={OPEN_DELAY_MS} closeDelay={CLOSE_DELAY_MS} render={<Link href={href} aria-label={label} className={className} />}>
        {children}
      </PreviewCard.Trigger>
      <PreviewCard.Portal>
        <PreviewCard.Positioner side="top" sideOffset={SIDE_OFFSET_PX} className="z-[var(--z-layer-popover)]">
          <PreviewCard.Popup className="border border-[var(--ink)] bg-[var(--paper)] transition-opacity duration-150 data-[ending-style]:opacity-0 data-[starting-style]:opacity-0">
            <HoverCardBody batch={batch} href={href} />
          </PreviewCard.Popup>
        </PreviewCard.Positioner>
      </PreviewCard.Portal>
    </PreviewCard.Root>
  );
}
