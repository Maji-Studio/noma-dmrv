"use client";

/**
 * The Overview tab: batch details on the left (sticky on desktop), the
 * Removals bar once the batch is ready or holds a Removal, and the open items
 * grouped Blocking, Check, Waiting. Phones read the work first.
 */
import Link from "next/link";
import { ArrowRightIcon, CheckCircleIcon, LockSimpleIcon } from "@phosphor-icons/react/dist/ssr";
import { EmptyState } from "@/components/ui";
import { Button } from "@/components/ui/button";
import { Notice } from "@/components/ui/notice";
import { InfoHint } from "@/components/ui/tooltip";
import { MISSING_VALUE } from "@/lib/copy-utils";
import {
  CREDIT_BATCH_DETAILS_ROW,
  type CreditBatchOpenItem,
} from "@/lib/credit-batches/open-items";
import { removalBarGroups, showOverviewRemovals } from "@/lib/credit-batches/removal-bar";
import { formatDate } from "@/lib/format-utils";
import { cn } from "@/lib/utils";
import { isCreditBatchMembershipLocked } from "./credit-batch-update-patch";
import { useCreditBatchPage } from "./credit-batch-page-context";
import { FOCUS_RING, FocusRow, MUTED_TEXT, PagePanel, ROW_RULE } from "./credit-batch-page-parts";
import { CreditBatchRemovalTemplate } from "./credit-batch-removal-template";
import { CompactRemovalBar, NotAppliedCaption, tonnesFromKg } from "./credit-batch-removal-bar";
import { durabilityLabel } from "./credit-batch-view";

type GroupKey = "blocking" | "check" | "waiting";

const GROUPS: Record<GroupKey, { title: string; help: string; dot: string }> = {
  blocking: { title: "Blocking", help: "Fix these before the next Removal.", dot: "bg-[var(--st-bad)]" },
  check: { title: "Check", help: "Worth a look. These do not stop a Removal.", dot: "bg-[var(--st-wait)]" },
  waiting: { title: "Waiting", help: "With someone else. Nothing to do yet.", dot: "bg-[var(--st-off)]" },
};

const GROUP_ORDER: readonly GroupKey[] = ["blocking", "check", "waiting"];

/** The hover fill bleeds 12px past the text; beside an ⓘ only on the left. */
function itemRowClass(besideHint: boolean) {
  return cn(
    "group flex min-h-44 items-center justify-between gap-16 px-12 py-12 text-left hover:bg-[var(--color-surface-medium)]",
    besideHint ? "-ml-12 w-[calc(100%+12px)]" : "-mx-12 w-[calc(100%+24px)]",
    FOCUS_RING,
  );
}

/** One open item. The whole row is the target: a tab and row here, or the repair page. */
function OpenItemRow({ item }: { item: CreditBatchOpenItem }) {
  const { openItem } = useCreditBatchPage();
  const body = (
    <>
      <span className="flex min-w-0 flex-col gap-2">
        <span className="body-medium font-medium">{item.title}</span>
        {item.detail && <span className={cn("body-small", MUTED_TEXT)}>{item.detail}</span>}
      </span>
      <ArrowRightIcon size={16} className="shrink-0 text-[var(--color-text-tertiary)] group-hover:text-[var(--color-text-primary)]" aria-hidden />
    </>
  );
  const rowClass = itemRowClass(!!item.why);
  const target = "href" in item.target ? (
    <Link href={item.target.href} className={rowClass}>
      {body}
    </Link>
  ) : (
    <button type="button" className={rowClass} onClick={() => openItem(item)}>
      {body}
    </button>
  );
  return (
    <li className={ROW_RULE}>
      {item.why ? (
        // The ⓘ sits beside the row target, never inside it.
        <div className="flex items-center gap-4">
          <div className="min-w-0 flex-1">{target}</div>
          <InfoHint label="Why is this required?">{item.why}</InfoHint>
        </div>
      ) : target}
    </li>
  );
}

function OpenItemGroups() {
  const { openItems, blockingCount } = useCreditBatchPage();
  const shown = GROUP_ORDER.filter((group) => openItems[group].length > 0);
  if (shown.length === 0) {
    // Until the batch health answers, "nothing open" would be a guess.
    if (blockingCount == null) return <p className={cn("body-small", MUTED_TEXT)} aria-busy>Checking this credit batch…</p>;
    return <EmptyState padding="sm" icon={<CheckCircleIcon size={32} weight="thin" />} title="Nothing is open on this credit batch" />;
  }
  return (
    <div className="flex flex-col gap-28">
      {shown.map((group) => (
        <section key={group} aria-labelledby={`open-items-${group}`} className="flex flex-col gap-4">
          <div className="flex flex-col gap-2 border-b border-[var(--color-border-secondary)] pb-8">
            <h3 id={`open-items-${group}`} className="inline-flex items-center gap-8 body-small font-medium">
              <span className={cn("size-8 rounded-full", GROUPS[group].dot)} aria-hidden />
              {GROUPS[group].title}
              <span className={cn("tabular-nums", MUTED_TEXT)}>{openItems[group].length}</span>
            </h3>
            <span className={cn("body-caption", MUTED_TEXT)}>{GROUPS[group].help}</span>
          </div>
          <ul className="flex flex-col">
            {openItems[group].map((item) => (
              <OpenItemRow key={item.id} item={item} />
            ))}
          </ul>
        </section>
      ))}
    </div>
  );
}

function OpenItemsPanel() {
  const { blockingCount } = useCreditBatchPage();
  return (
    <PagePanel title="Open items" labelledBy="credit-batch-open-items">
      {blockingCount == null && <HealthUnavailable />}
      <OpenItemGroups />
    </PagePanel>
  );
}

/** The batch health failed: say so once, with a retry, instead of an empty list. */
function HealthUnavailable() {
  const { healthError, retryHealth, retryingHealth } = useCreditBatchPage();
  if (!healthError) return null;
  return (
    <Notice
      tone="warning"
      action={<Button variant="weak" size="small" busy={retryingHealth} onClick={retryHealth}>Retry</Button>}
    >
      Blocking items could not be checked. Retry to load them.
    </Notice>
  );
}

function RemovalsPanel() {
  const { batch, pageModel, go } = useCreditBatchPage();
  if (!pageModel) return null;
  const groups = removalBarGroups(pageModel);
  return (
    <PagePanel
      title="Removals"
      labelledBy="credit-batch-overview-removals"
      action={
        <span className="inline-flex items-center gap-16">
          <span className="body-medium tabular-nums">{tonnesFromKg(pageModel.mass.appliedDryKg)} applied</span>
          <button
            type="button"
            onClick={() => go("removals")}
            className={cn("inline-flex min-h-24 items-center gap-4 body-small underline-offset-2 hover:underline", MUTED_TEXT, FOCUS_RING)}
          >
            Details
            <ArrowRightIcon size={16} aria-hidden />
          </button>
        </span>
      }
    >
      {pageModel.removals.length === 0 && (
        <p className={cn("body-small", MUTED_TEXT)}>Nothing blocks this credit batch. Start a Removal to submit its applied biochar.</p>
      )}
      <CompactRemovalBar groups={groups} facilityId={batch.facilityId} />
      <NotAppliedCaption model={pageModel} />
    </PagePanel>
  );
}

function DetailRow({ label, value, locked }: { label: string; value: string | null; locked?: boolean }) {
  return (
    <div className={cn("grid grid-cols-[128px_minmax(0,1fr)] items-baseline gap-12 py-10", ROW_RULE)}>
      <dt className={cn("body-small", MUTED_TEXT)}>{label}</dt>
      <dd className="flex min-w-0 items-center gap-6 body-medium">
        {value == null ? (
          <span data-empty className="text-[var(--color-text-tertiary)]">{MISSING_VALUE.notRecorded}</span>
        ) : (
          <span className="min-w-0 break-words">{value}</span>
        )}
        {locked && (
          <>
            <LockSimpleIcon size={16} className="shrink-0 text-[var(--color-text-secondary)]" aria-hidden />
            <span className="sr-only">(locked)</span>
          </>
        )}
      </dd>
    </div>
  );
}

const MEMBERSHIP_LOCK_TEXT =
  "A Removal holds biochar from this credit batch, so its feedstock type and dates are locked. Notes stay open.";
const SENT_LOCK_TEXT = "This credit batch was sent with its Removal, so every field is locked.";

/** Shown only when something is locked; an editable batch carries no symbol. */
function LockMark({ text }: { text: string }) {
  return (
    <span className="inline-flex items-center gap-2 text-[var(--color-text-secondary)]">
      <LockSimpleIcon size={20} aria-hidden />
      <InfoHint label="Why fields are locked">{text}</InfoHint>
    </span>
  );
}

/** Batch details: the definition, sampling, notes and the Removal template. Edit starts from the header. */
function DetailsPanel() {
  const { batch, lock, canManage, focus } = useCreditBatchPage();
  const sent = lock?.level === "sent";
  const membershipLocked = isCreditBatchMembershipLocked(lock);
  // When everything is locked the panel says so once and the rows stay quiet.
  const rowLock = membershipLocked && !sent;
  const lockText = sent ? SENT_LOCK_TEXT : membershipLocked ? MEMBERSHIP_LOCK_TEXT : null;
  return (
    <FocusRow rowId={CREDIT_BATCH_DETAILS_ROW}>
      <PagePanel title="Batch details" labelledBy="credit-batch-details" titleAddon={lockText ? <LockMark text={lockText} /> : undefined}>
        <dl className="flex flex-col">
          <DetailRow label="Feedstock type" value={batch.feedstockTypeName} locked={rowLock} />
          <DetailRow label="Durability" value={durabilityLabel(batch.durabilityOption)} />
          <DetailRow label="Start date" value={formatDate(batch.startDate)} locked={rowLock} />
          <DetailRow label="End date" value={formatDate(batch.endDate)} locked={rowLock} />
          <DetailRow label="Sampling" value={batch.sampling === "unsampled" ? "Unsampled" : "Sampled"} />
          <DetailRow label="Notes" value={batch.siteManagementNotes?.trim() || null} />
        </dl>
        <div className="border-t border-[var(--color-border-secondary)] pt-16">
          <CreditBatchRemovalTemplate creditBatch={batch} canManage={canManage} locked={sent} activeFocusTarget={focus} />
        </div>
      </PagePanel>
    </FocusRow>
  );
}

export function CreditBatchOverview() {
  const { pageModel, blockingCount } = useCreditBatchPage();
  return (
    <div className="grid grid-cols-[minmax(0,1fr)] items-start gap-24 lg:grid-cols-[360px_minmax(0,1fr)]">
      {/* Sticky beside the work on desktop (main is the scrollport); it scrolls on its own when taller than the window. */}
      <div className="order-last min-w-0 lg:sticky lg:top-24 lg:order-first lg:max-h-[calc(100vh-48px)] lg:overflow-y-auto">
        <DetailsPanel />
      </div>
      <div className="flex min-w-0 flex-col gap-24">
        {showOverviewRemovals(pageModel, blockingCount) && <RemovalsPanel />}
        <OpenItemsPanel />
      </div>
    </div>
  );
}
