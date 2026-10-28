/**
 * Submission history: one plain line per submit attempt (icon, outcome,
 * time), the latest in colour and older ones muted. The raw sync events fold
 * away inside "Technical details for support".
 */
import { CaretDownIcon, CheckCircleIcon, WarningCircleIcon, WarningIcon } from "@phosphor-icons/react/dist/ssr";
import type { ReactNode } from "react";
import type { CertifierSyncEventRow } from "@/data-access/certification";
import type { SubmissionAttempt } from "@/lib/certification/submission-attempts";
import { formatFacilityDateTime } from "@/lib/format-utils";
import { DisclosureSummary } from "./disclosure-summary";
import { outcomeLine, outcomeTone } from "./submission-outcome-notice";
import { SyncEventList } from "./sync-event-log";

const ICON_PX = 16;
const COLOUR = {
  ok: "text-[var(--st-ok)]",
  stop: "text-[var(--st-bad)]",
  retry: "text-[var(--st-wait)]",
} as const;

function AttemptLine({ attempt, latest, facilityId, timeZone }: {
  attempt: SubmissionAttempt;
  latest: boolean;
  facilityId: string;
  timeZone: string;
}) {
  const tone = outcomeTone(attempt.outcome);
  const Icon = tone === "ok" ? CheckCircleIcon : tone === "stop" ? WarningCircleIcon : WarningIcon;
  return (
    <li className="flex items-start gap-8 body-small">
      <Icon
        size={ICON_PX}
        weight="fill"
        aria-hidden="true"
        className={`mt-2 shrink-0 ${latest ? COLOUR[tone] : "text-[var(--color-text-tertiary)]"}`}
      />
      <span className={`min-w-0 flex-1 ${latest ? "text-[var(--color-text-primary)]" : "text-[var(--color-text-secondary)]"}`}>
        {outcomeLine(attempt.outcome, facilityId)}
      </span>
      <span className="shrink-0 body-caption text-[var(--color-text-tertiary)]">
        {formatFacilityDateTime(attempt.at, timeZone)}
      </span>
    </li>
  );
}

/** A fold inside the history fold, with its own named group so the outer caret does not turn it. */
function InnerFold({ label, children }: { label: ReactNode; children: ReactNode }) {
  return (
    <details className="group/inner">
      <summary className="flex min-h-44 cursor-pointer list-none items-center gap-6 body-caption text-[var(--color-text-tertiary)] hover:text-[var(--color-text-secondary)] [&::-webkit-details-marker]:hidden">
        <CaretDownIcon size={ICON_PX} weight="bold" className="shrink-0 transition-transform duration-150 group-open/inner:rotate-180" />
        <span className="underline underline-offset-2">{label}</span>
      </summary>
      <div className="mt-8">{children}</div>
    </details>
  );
}

export function SubmissionHistory({ attempts, events, facilityId, timeZone }: {
  attempts: SubmissionAttempt[];
  events: CertifierSyncEventRow[];
  facilityId: string;
  timeZone: string;
}) {
  if (attempts.length === 0 && events.length === 0) return null;
  return (
    <details className="group">
      <DisclosureSummary>Submission history</DisclosureSummary>
      <div className="mt-8 flex flex-col gap-8">
        {attempts.length > 0 && (
          <ul className="flex flex-col gap-8">
            {attempts.map((attempt, index) => (
              <AttemptLine key={attempt.id} attempt={attempt} latest={index === 0} facilityId={facilityId} timeZone={timeZone} />
            ))}
          </ul>
        )}
        {events.length > 0 && (
          <InnerFold label="Technical details for support">
            <SyncEventList events={events} timeZone={timeZone} />
          </InnerFold>
        )}
      </div>
    </details>
  );
}
