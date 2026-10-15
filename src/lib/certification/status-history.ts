/**
 * Status history for one Removal or GHG Statement: the statuses the record
 * went through, when, and who changed it.
 *
 * Two raw sources, merged at read time:
 *  - the Submission ledger (`certificationSubmissions`): every version's
 *    `createdAt`, `submittedAt` and `supersededAt`, plus its current status;
 *  - `status_changed` activity events (#1038), which carry the actor and every
 *    local or remote change since recording began.
 *
 * A ledger timestamp only stands in for a change no event recorded. Both are
 * replayed per ledger version, and the record's status at each step is the
 * status of its highest version, labelled with the same `deriveRemovalStatus`
 * / `deriveStatementStatus` mappers the badge uses, on reduced input (no lock
 * in flight, no pending total). An entry is emitted whenever that label
 * changes. Pure and client-safe.
 */
import type { StatusValue } from "@/components/ui/status-badge";
import type { ACTIVITY_SOURCES } from "@/db/schema/common";
import { CERTIFICATION_STATUS_RECORDING_STARTED_AT } from "@/config/certification";
import { REMOTE_GHG_STATUSES } from "./from-submission";
import {
  deriveRemovalStatus,
  deriveStatementStatus,
  type DerivedStatus,
  type LocalSubmissionStatus,
  type RemoteGhgStatus,
} from "./status";

export const STATUS_HISTORY_ENTITY_TYPES = ["removal", "ghg_statement"] as const;
export type StatusHistoryEntityType = (typeof STATUS_HISTORY_ENTITY_TYPES)[number];
export type StatusHistorySource = (typeof ACTIVITY_SOURCES)[number];

/** One Submission ledger row, as the history needs it. */
export interface StatusHistoryLedgerRow {
  id: string;
  version: number;
  status: LocalSubmissionStatus;
  /** Persisted `metadata.remoteStatus`, raw. */
  remoteStatus: string | null;
  createdAt: Date;
  submittedAt: Date | null;
  supersededAt: Date | null;
  updatedAt: Date;
}

/** One `status_changed` activity event, with its actor's display name. */
export interface StatusHistoryEvent {
  id: string;
  occurredAt: Date;
  sequence: number;
  fromStatus: string | null;
  toStatus: string | null;
  fromRemote: string | null;
  toRemote: string | null;
  submissionId: string | null;
  version: number | null;
  source: StatusHistorySource;
  actorName: string | null;
  hasActor: boolean;
}

export interface SubmissionStatusHistoryEntry {
  id: string;
  occurredAt: Date;
  /** Ledger version that set the record's status at this step. */
  version: number;
  label: string;
  value: StatusValue;
  /**
   * `activity` entries come from a recorded event and carry who made the
   * change; `ledger` entries are reconstructed from ledger timestamps.
   */
  origin: "activity" | "ledger";
  source: StatusHistorySource | null;
  /** Display name of the user behind the change, when one is known. */
  actorName: string | null;
  /** An actor was recorded but their name can no longer be read. */
  actorUnavailable: boolean;
}

export interface SubmissionStatusHistory {
  /** Newest first. */
  entries: SubmissionStatusHistoryEntry[];
  /** Set when the record has ledger history from before recording began. */
  recordingBeganAt: Date | null;
}

interface Transition {
  id: string;
  at: Date;
  /** Tiebreak for transitions at the same instant: ledger first, then events. */
  rank: number;
  key: string;
  version: number;
  status: LocalSubmissionStatus | null;
  remote: string | null | undefined;
  origin: "activity" | "ledger";
  event: StatusHistoryEvent | null;
}

interface VersionState {
  version: number;
  status: LocalSubmissionStatus;
  remote: string | null;
}

const LEDGER_RANK = 0;
const EVENT_RANK = 1;
const LOCAL_STATUSES: readonly LocalSubmissionStatus[] = [
  "draft",
  "submitted",
  "accepted",
  "rejected",
  "superseded",
];

function asLocalStatus(value: string | null): LocalSubmissionStatus | null {
  return LOCAL_STATUSES.find((status) => status === value) ?? null;
}

function asRemoteStatus(value: string | null): RemoteGhgStatus | null {
  return REMOTE_GHG_STATUSES.find((status) => status === value) ?? null;
}

export function deriveHistoryStatus(
  entityType: StatusHistoryEntityType,
  state: Pick<VersionState, "status" | "remote">,
): DerivedStatus {
  return entityType === "removal"
    ? deriveRemovalStatus({ local: state.status, lockInFlight: false })
    : deriveStatementStatus({
        local: state.status,
        lockInFlight: false,
        remoteStatus: asRemoteStatus(state.remote),
      });
}

/**
 * `submittedAt` is stamped only when a claimed draft is sent
 * (`markSubmissionSubmitted`, draft to submitted), and each send overwrites
 * it. A resubmission from a terminal status (`clearTerminalStatusForResubmit`)
 * leaves it alone, so only a recorded draft-to-submitted event covers it.
 */
function recordedSubmission(events: StatusHistoryEvent[], submissionId: string): boolean {
  return events.some(
    (event) =>
      event.submissionId === submissionId &&
      event.fromStatus === "draft" &&
      event.toStatus === "submitted",
  );
}

/** `superseded` is terminal: any recorded move into it is the one `supersededAt` marks. */
function recordedSupersession(events: StatusHistoryEvent[], submissionId: string): boolean {
  return events.some(
    (event) =>
      event.submissionId === submissionId &&
      event.toStatus === "superseded" &&
      event.fromStatus !== "superseded",
  );
}

function byTime(a: Transition, b: Transition): number {
  return (
    a.at.getTime() - b.at.getTime() ||
    a.rank - b.rank ||
    (a.event?.sequence ?? 0) - (b.event?.sequence ?? 0) ||
    a.version - b.version
  );
}

function ledgerTransition(
  row: StatusHistoryLedgerRow,
  step: string,
  at: Date,
  status: LocalSubmissionStatus,
  remote?: string | null,
): Transition {
  return {
    id: `${row.id}:${step}`,
    at,
    rank: LEDGER_RANK,
    key: row.id,
    version: row.version,
    status,
    remote,
    origin: "ledger",
    event: null,
  };
}

function eventTransition(event: StatusHistoryEvent): Transition {
  return {
    id: event.id,
    at: event.occurredAt,
    rank: EVENT_RANK,
    key: event.submissionId ?? `version:${event.version ?? 0}`,
    version: event.version ?? 0,
    status: asLocalStatus(event.toStatus),
    remote: event.toRemote,
    origin: "activity",
    event,
  };
}

function apply(states: Map<string, VersionState>, transition: Transition) {
  const previous = states.get(transition.key);
  const status = transition.status ?? previous?.status;
  if (!status) return;
  states.set(transition.key, {
    version: transition.version,
    status,
    remote:
      transition.remote === undefined
        ? (previous?.remote ?? null)
        : transition.remote,
  });
}

/**
 * The state an event says its version left. It differs from the replayed
 * state when the change before it was never recorded (it predates recording,
 * or fell outside the event window). Applied without an entry of its own,
 * since its start time is unknown, so the recorded change still shows even
 * when it returns to a label the ledger replay already reached.
 */
function eventPredecessor(
  states: Map<string, VersionState>,
  transition: Transition,
): VersionState | null {
  const event = transition.event;
  const fromStatus = event ? asLocalStatus(event.fromStatus) : null;
  if (!event || !fromStatus) return null;
  const replayed = states.get(transition.key);
  if (replayed?.status === fromStatus && replayed.remote === event.fromRemote) return null;
  return { version: transition.version, status: fromStatus, remote: event.fromRemote };
}

function latestState(states: Map<string, VersionState>): VersionState | null {
  let latest: VersionState | null = null;
  for (const state of states.values()) {
    if (!latest || state.version > latest.version) latest = state;
  }
  return latest;
}

/**
 * Ledger transitions for one row. Creation is never an event, so it always
 * comes from the ledger; `submittedAt` and `supersededAt` only when no event
 * recorded that change. When the row's own replay still ends short of its
 * current status (a change made before recording began), a final step at
 * `updatedAt` brings it level, so the newest entry agrees with the badge.
 */
function ledgerTransitions(
  entityType: StatusHistoryEntityType,
  row: StatusHistoryLedgerRow,
  events: StatusHistoryEvent[],
): Transition[] {
  const transitions = [ledgerTransition(row, "created", row.createdAt, "draft", null)];
  if (row.submittedAt && !recordedSubmission(events, row.id)) {
    transitions.push(ledgerTransition(row, "submitted", row.submittedAt, "submitted"));
  }
  if (row.supersededAt && !recordedSupersession(events, row.id)) {
    transitions.push(ledgerTransition(row, "superseded", row.supersededAt, "superseded"));
  }

  const own = [
    ...transitions,
    ...events.filter((event) => event.submissionId === row.id).map(eventTransition),
  ].sort(byTime);
  const states = new Map<string, VersionState>();
  for (const transition of own) apply(states, { ...transition, key: row.id });
  const replayed = states.get(row.id);
  const current = { status: row.status, remote: row.remoteStatus };
  if (
    !replayed ||
    deriveHistoryStatus(entityType, replayed).label !==
      deriveHistoryStatus(entityType, current).label
  ) {
    const last = own.at(-1)?.at ?? row.createdAt;
    const at = row.updatedAt > last ? row.updatedAt : last;
    transitions.push(ledgerTransition(row, "current", at, row.status, row.remoteStatus));
  }
  return transitions;
}

export function buildSubmissionStatusHistory(
  entityType: StatusHistoryEntityType,
  ledger: StatusHistoryLedgerRow[],
  events: StatusHistoryEvent[],
  recordingStartedAt: Date = new Date(CERTIFICATION_STATUS_RECORDING_STARTED_AT),
): SubmissionStatusHistory {
  const transitions = [
    ...ledger.flatMap((row) => ledgerTransitions(entityType, row, events)),
    ...events.map(eventTransition),
  ].sort(byTime);

  const states = new Map<string, VersionState>();
  const entries: SubmissionStatusHistoryEntry[] = [];
  let lastLabel: string | null = null;
  for (const transition of transitions) {
    const predecessor = eventPredecessor(states, transition);
    if (predecessor) {
      states.set(transition.key, predecessor);
      const before = latestState(states);
      if (before) lastLabel = deriveHistoryStatus(entityType, before).label;
    }
    apply(states, transition);
    const latest = latestState(states);
    if (!latest) continue;
    const derived = deriveHistoryStatus(entityType, latest);
    if (derived.label === lastLabel) continue;
    lastLabel = derived.label;
    const event = transition.event;
    entries.push({
      id: transition.id,
      occurredAt: transition.at,
      version: latest.version,
      label: derived.label,
      value: derived.value,
      origin: transition.origin,
      source: event?.source ?? null,
      actorName: event?.actorName ?? null,
      actorUnavailable: Boolean(event?.hasActor && !event.actorName),
    });
  }

  const predatesRecording = ledger.some((row) => row.createdAt < recordingStartedAt);
  return {
    entries: entries.reverse(),
    recordingBeganAt: predatesRecording ? recordingStartedAt : null,
  };
}
