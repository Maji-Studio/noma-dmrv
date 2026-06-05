/**
 * CertificationOverview — the certification work queue (route: /certification).
 * Operator-first, not a vanity dashboard: it leads with "Needs attention"
 * (removals ready to submit / blocked, statements awaiting the verifier or
 * failed), backed by a thin stat strip and the project-emissions drift entry.
 *
 * Readiness is server-owned (`useCertificationOverview` → the shared
 * `deriveRemovalReadiness` classifier); statement attention is derived from the
 * persisted submission overlay via the same helper the badge uses — so this
 * queue never disagrees with the table or the pre-flight.
 */
"use client";

import type { ElementType } from "react";
import Link from "next/link";
import {
  ArrowRight,
  CheckCircle,
  ClockCountdown,
  SealCheck,
  Stack,
  Warning,
} from "@phosphor-icons/react/dist/ssr";
import { EmptyState } from "@/components/ui";
import { StatCard } from "@/components/dashboard/stat-card";
import { useFacilityContext } from "@/hooks/use-facility-context";
import {
  useCertificationOverview,
  useGhgStatementsForFacility,
} from "@/hooks/use-certification";
import type {
  CertificationOverviewData,
  RemovalPreflightSummary,
} from "@/fn/certification";
import type { GhgStatementListItem } from "@/fn/certification/ghg-statements";
import { deriveSubmissionStatus } from "@/lib/certification/from-submission";
import { isLockedInFlight } from "@/lib/isometric/utils/lock";
import { EnvBanner } from "./env-banner";
import { EmissionsSetupSummary } from "./emissions-setup-summary";

const STAT_ICON_SIZE = 24;

type AttentionTone = "ready" | "blocked" | "waiting";

interface AttentionItem {
  key: string;
  tone: AttentionTone;
  title: string;
  detail: string;
  href: string;
}

export function CertificationOverview() {
  const { facilityId } = useFacilityContext();

  return (
    <div className="container-max flex flex-col gap-32 py-32">
      <header className="flex flex-col gap-8">
        <span className="title-chapter-title text-[var(--color-text-tertiary)]">
          Certification
        </span>
        <h1 className="title-heading-2">Overview</h1>
        <p className="body-medium text-[var(--color-text-secondary)] max-w-[680px]">
          What needs your attention to move MRV data through the registry —
          removals ready to submit, blockers to clear, and statements in the
          verifier&apos;s hands.
        </p>
      </header>

      {!facilityId ? (
        <EmptyState
          icon={<SealCheck size={48} />}
          title="Select a facility"
          description="Choose a facility from the sidebar to see its certification queue."
        />
      ) : (
        <OverviewBody facilityId={facilityId} />
      )}
    </div>
  );
}

function withFacility(href: string, facilityId: string): string {
  return `${href}?facility=${encodeURIComponent(facilityId)}`;
}

function shortId(id: string): string {
  return id.slice(0, 8);
}

// A ready removal deep-links to its quick-view sheet (`?removal=`), where a 1:1
// removal one-click-submits. Config blockers are fixed in Settings; coverage /
// lineage blockers are worked in the removal's guided Review (the Pre-flight
// step lists them).
function removalSheetHref(removalId: string, facilityId: string): string {
  return `/certification/removals?facility=${encodeURIComponent(
    facilityId,
  )}&removal=${encodeURIComponent(removalId)}`;
}

function blockedHref(
  removalId: string,
  reasons: string[],
  facilityId: string,
): string {
  // Config blockers (project link / template / blueprint) are fixed in
  // Settings; everything else is worked in the removal's Pre-flight. Match
  // "not linked" — not a bare "linked" — so the production blocker
  // ("No production data linked yet …") routes to Pre-flight, not Settings.
  const isConfig = reasons.some((r) => /not linked|template|blueprint/i.test(r));
  return isConfig
    ? withFacility("/certification/settings", facilityId)
    : `/certification/removals/${encodeURIComponent(
        removalId,
      )}/review?facility=${encodeURIComponent(facilityId)}&step=preflight`;
}

function removalAttention(
  removals: RemovalPreflightSummary[],
  facilityId: string,
): AttentionItem[] {
  const items: AttentionItem[] = [];
  for (const removal of removals) {
    const { state, reasons } = removal.readiness;
    if (state === "ready") {
      items.push({
        key: `removal-${removal.removalId}`,
        tone: "ready",
        title: `Removal ${shortId(removal.removalId)}`,
        detail: "Ready to submit",
        href: removalSheetHref(removal.removalId, facilityId),
      });
    } else if (state === "blocked") {
      items.push({
        key: `removal-${removal.removalId}`,
        tone: "blocked",
        title: `Removal ${shortId(removal.removalId)}`,
        detail: reasons.join(" · "),
        href: blockedHref(removal.removalId, reasons, facilityId),
      });
    }
  }
  return items;
}

function statementPeriodLabel(statement: GhgStatementListItem["statement"]): string {
  return statement.reportingPeriodStartOn
    ? `${statement.reportingPeriodStartOn} → ${statement.reportingPeriodEndOn}`
    : `ending ${statement.reportingPeriodEndOn}`;
}

function statementAttention(
  statements: GhgStatementListItem[],
  facilityId: string,
): AttentionItem[] {
  const items: AttentionItem[] = [];
  for (const item of statements) {
    const locked = item.latestSubmission
      ? isLockedInFlight(item.latestSubmission)
      : false;
    const status = deriveSubmissionStatus(
      item.latestSubmission,
      locked,
      "ghgStatement",
    );
    const href = `/certification/ghg-statements?facility=${encodeURIComponent(
      facilityId,
    )}&statement=${encodeURIComponent(item.statement.id)}`;
    const period = statementPeriodLabel(item.statement);
    if (status.value === "pending") {
      items.push({
        key: `statement-${item.statement.id}`,
        tone: "waiting",
        title: `GHG Statement ${period}`,
        detail: "Awaiting verifier",
        href,
      });
    } else if (status.value === "rejected") {
      items.push({
        key: `statement-${item.statement.id}`,
        tone: "blocked",
        title: `GHG Statement ${period}`,
        detail: "Verification failed — review and resubmit",
        href,
      });
    }
  }
  return items;
}

function OverviewBody({ facilityId }: { facilityId: string }) {
  const overview = useCertificationOverview(facilityId);
  const statements = useGhgStatementsForFacility(facilityId);

  if (overview.isLoading) {
    return (
      <>
        <StatStrip />
        <section className="border border-[var(--color-border-secondary)] bg-[var(--color-background-white)] p-20">
          <p className="body-medium text-[var(--color-text-tertiary)]">
            Loading certification queue…
          </p>
        </section>
      </>
    );
  }

  if (overview.error || !overview.data) {
    return (
      <div className="border border-[var(--color-border-secondary)] bg-[var(--color-background-white)] p-20">
        <p className="body-medium text-[var(--clr-red)]" role="alert">
          Unable to load the certification queue. Try refreshing the page.
        </p>
      </div>
    );
  }

  const data = overview.data;
  const statementItems = statements.data
    ? statementAttention(statements.data, facilityId)
    : [];
  const attention = [
    ...removalAttention(data.removals, facilityId),
    ...statementItems,
  ];
  // A failed statements fetch must not read as "all caught up" — surface it as
  // its own attention item rather than silently dropping to an empty list.
  if (statements.error) {
    attention.push({
      key: "statements-error",
      tone: "blocked",
      title: "GHG statements",
      detail: "Couldn't load statements — refresh to retry",
      href: withFacility("/certification/ghg-statements", facilityId),
    });
  } else if (statements.isLoading) {
    attention.push({
      key: "statements-loading",
      tone: "waiting",
      title: "GHG statements",
      detail: "Loading statement status",
      href: withFacility("/certification/ghg-statements", facilityId),
    });
  }

  return (
    <>
      <EnvBanner isProduction={data.isProduction} />
      <StatStrip data={data} />
      <NeedsAttention
        items={attention}
        hasRemovals={data.removals.length > 0}
        readyToStartCount={data.readyToStartBatchCount}
        facilityId={facilityId}
      />
      <EmissionsSetupSummary />
    </>
  );
}

function StatStrip({ data }: { data?: CertificationOverviewData }) {
  const loading = !data;
  const readyCount = data
    ? data.removals.filter((r) => r.readiness.state === "ready").length
    : 0;
  const submittedCount = data
    ? data.removals.filter((r) => r.readiness.state === "submitted").length
    : 0;
  const readyToStartCount = data ? data.readyToStartBatchCount : 0;

  return (
    <div className="grid grid-cols-1 gap-24 md:grid-cols-2 xl:grid-cols-4">
      <StatCard
        title="Removals"
        value={loading ? "—" : data.removals.length}
        icon={<SealCheck size={STAT_ICON_SIZE} weight="bold" />}
        description="Submission units for this facility"
        isLoading={loading}
      />
      <StatCard
        title="Ready to submit"
        value={loading ? "—" : readyCount}
        icon={<CheckCircle size={STAT_ICON_SIZE} weight="bold" />}
        description="All preconditions met"
        isLoading={loading}
      />
      <StatCard
        title="Submitted"
        value={loading ? "—" : submittedCount}
        icon={<ClockCountdown size={STAT_ICON_SIZE} weight="bold" />}
        description="Sent to the registry"
        isLoading={loading}
      />
      <StatCard
        title="Ready to start"
        value={loading ? "—" : readyToStartCount}
        icon={<Stack size={STAT_ICON_SIZE} weight="bold" />}
        description="Healthy batches you can put in a removal"
        isLoading={loading}
      />
    </div>
  );
}

const TONE_ICON: Record<AttentionTone, ElementType> = {
  ready: CheckCircle,
  blocked: Warning,
  waiting: ClockCountdown,
};

const TONE_COLOR: Record<AttentionTone, string> = {
  ready: "var(--color-signal-green)",
  blocked: "var(--color-signal-orange)",
  waiting: "var(--color-text-tertiary)",
};

function NeedsAttention({
  items,
  hasRemovals,
  readyToStartCount,
  facilityId,
}: {
  items: AttentionItem[];
  hasRemovals: boolean;
  readyToStartCount: number;
  facilityId: string;
}) {
  return (
    <section className="flex flex-col gap-16">
      <h2 className="title-heading-3">
        Needs attention{" "}
        <span className="body-small text-[var(--color-text-tertiary)]">
          ({items.length})
        </span>
      </h2>

      {items.length === 0 ? (
        <EmptyState
          icon={<CheckCircle size={40} />}
          title={hasRemovals ? "You're all caught up" : "No removals yet"}
          description={
            hasRemovals
              ? readyToStartCount > 0
                ? `Nothing is blocked. ${readyToStartCount} batch${readyToStartCount === 1 ? "" : "es"} ${readyToStartCount === 1 ? "is" : "are"} ready to start a new removal.`
                : "Nothing is waiting on you right now."
              : readyToStartCount > 0
                ? `${readyToStartCount} batch${readyToStartCount === 1 ? "" : "es"} ${readyToStartCount === 1 ? "is" : "are"} ready — start a removal to begin submitting.`
                : "Add credit batches to start a removal."
          }
          action={
            !hasRemovals || readyToStartCount > 0 ? (
              <Link
                href={withFacility("/certification/removals", facilityId)}
                className="body-small underline underline-offset-2 hover:text-[var(--color-text-secondary)]"
              >
                Go to Removals →
              </Link>
            ) : undefined
          }
          padding="md"
        />
      ) : (
        <div className="flex flex-col border border-[var(--color-border-secondary)] bg-[var(--color-background-white)]">
          {items.map((item, index) => (
            <AttentionRow
              key={item.key}
              item={item}
              withTopBorder={index > 0}
            />
          ))}
        </div>
      )}
    </section>
  );
}

function AttentionRow({
  item,
  withTopBorder,
}: {
  item: AttentionItem;
  withTopBorder: boolean;
}) {
  const Icon = TONE_ICON[item.tone];
  return (
    <Link
      href={item.href}
      className={[
        "group flex items-center gap-12 px-20 py-16 transition-colors hover:bg-[var(--color-background-medium)]",
        withTopBorder ? "border-t border-[var(--color-border-tertiary)]" : "",
      ].join(" ")}
    >
      <Icon
        size={18}
        weight="fill"
        aria-hidden
        className="shrink-0"
        style={{ color: TONE_COLOR[item.tone] }}
      />
      <div className="flex flex-col gap-2 min-w-0 flex-1">
        <span className="body-small font-mono text-[var(--color-text-primary)] truncate">
          {item.title}
        </span>
        <span className="body-caption text-[var(--color-text-secondary)]">
          {item.detail}
        </span>
      </div>
      <ArrowRight
        size={16}
        weight="bold"
        aria-hidden
        className="shrink-0 text-[var(--color-text-tertiary)] transition-transform duration-150 group-hover:translate-x-[3px]"
      />
    </Link>
  );
}
