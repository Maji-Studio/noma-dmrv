import { describe, expect, it } from "vitest";
import {
  buildSubmissionStatusHistory,
  type StatusHistoryEvent,
  type StatusHistoryLedgerRow,
} from "./status-history";

const RECORDING_STARTED_AT = new Date("2026-10-15T13:40:53Z");
const day = (iso: string) => new Date(`${iso}T09:00:00Z`);

function ledgerRow(overrides: Partial<StatusHistoryLedgerRow> = {}): StatusHistoryLedgerRow {
  return {
    id: "submission-1",
    version: 1,
    status: "submitted",
    remoteStatus: null,
    createdAt: day("2026-09-01"),
    submittedAt: null,
    supersededAt: null,
    updatedAt: day("2026-09-01"),
    ...overrides,
  };
}

let sequence = 0;
function event(overrides: Partial<StatusHistoryEvent> & Pick<StatusHistoryEvent, "occurredAt">): StatusHistoryEvent {
  sequence += 1;
  return {
    id: `event-${sequence}`,
    sequence,
    fromStatus: null,
    toStatus: null,
    fromRemote: null,
    toRemote: null,
    submissionId: "submission-1",
    version: 1,
    source: "form",
    actorName: "Ada Operator",
    hasActor: true,
    ...overrides,
  };
}

const summary = (history: ReturnType<typeof buildSubmissionStatusHistory>) =>
  history.entries.map(({ label, occurredAt, origin, actorName }) => ({
    label,
    occurredAt: occurredAt.toISOString().slice(0, 10),
    origin,
    actorName,
  }));

describe("buildSubmissionStatusHistory", () => {
  it("keeps the original submission when a terminal Statement is resubmitted", () => {
    // Submitted Sep 2 before recording; verification failed; resubmitted Oct 16.
    // clearTerminalStatusForResubmit never touches submittedAt.
    const row = ledgerRow({
      status: "submitted",
      submittedAt: day("2026-09-02"),
      updatedAt: day("2026-10-16"),
    });
    const resubmit = event({
      occurredAt: day("2026-10-16"),
      fromStatus: "rejected",
      toStatus: "submitted",
    });

    const history = buildSubmissionStatusHistory("ghg_statement", [row], [resubmit], RECORDING_STARTED_AT);

    expect(summary(history)).toEqual([
      { label: "In registry", occurredAt: "2026-10-16", origin: "activity", actorName: "Ada Operator" },
      { label: "In registry", occurredAt: "2026-09-02", origin: "ledger", actorName: null },
      { label: "Draft", occurredAt: "2026-09-01", origin: "ledger", actorName: null },
    ]);
  });

  it("still drops the ledger submission a recorded submit already covers", () => {
    const row = ledgerRow({ status: "submitted", createdAt: day("2026-10-16"), submittedAt: day("2026-10-17") });
    const submit = event({ occurredAt: day("2026-10-17"), fromStatus: "draft", toStatus: "submitted" });

    const history = buildSubmissionStatusHistory("removal", [row], [submit], RECORDING_STARTED_AT);

    expect(summary(history)).toEqual([
      { label: "Submitted", occurredAt: "2026-10-17", origin: "activity", actorName: "Ada Operator" },
      { label: "Not submitted", occurredAt: "2026-10-16", origin: "ledger", actorName: null },
    ]);
  });

  it("keeps a recorded remote reversal whose predecessor predates recording", () => {
    // Older Statement: the registry moved it to verification before recording
    // began, then back to DRAFT after. The ledger alone only knows "In registry".
    const row = ledgerRow({
      status: "submitted",
      remoteStatus: "DRAFT",
      submittedAt: day("2026-09-02"),
      updatedAt: day("2026-10-20"),
    });
    const reversal = event({
      occurredAt: day("2026-10-20"),
      source: "registry",
      fromStatus: "submitted",
      toStatus: "submitted",
      fromRemote: "AWAITING_VERIFICATION",
      toRemote: "DRAFT",
    });

    const history = buildSubmissionStatusHistory("ghg_statement", [row], [reversal], RECORDING_STARTED_AT);

    expect(summary(history)).toEqual([
      { label: "In registry", occurredAt: "2026-10-20", origin: "activity", actorName: "Ada Operator" },
      { label: "In registry", occurredAt: "2026-09-02", origin: "ledger", actorName: null },
      { label: "Draft", occurredAt: "2026-09-01", origin: "ledger", actorName: null },
    ]);
    expect(history.recordingBeganAt).toEqual(RECORDING_STARTED_AT);
  });

  it("does not invent an entry for the unrecorded predecessor", () => {
    const row = ledgerRow({
      status: "accepted",
      remoteStatus: "VERIFIED",
      submittedAt: day("2026-09-02"),
      updatedAt: day("2026-10-20"),
    });
    const verified = event({
      occurredAt: day("2026-10-20"),
      source: "registry",
      fromStatus: "submitted",
      toStatus: "accepted",
      fromRemote: "AWAITING_VERIFICATION",
      toRemote: "VERIFIED",
    });

    const history = buildSubmissionStatusHistory("ghg_statement", [row], [verified], RECORDING_STARTED_AT);

    expect(history.entries.map((entry) => entry.label)).toEqual(["Verified", "In registry", "Draft"]);
  });
});
