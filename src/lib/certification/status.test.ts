import { describe, expect, it } from "vitest";
import {
  deriveRemovalStatus,
  deriveStatementStatus,
  type LocalSubmissionStatus,
  type RemoteGhgStatus,
} from "./status";

describe("deriveRemovalStatus", () => {
  it("reports an in-flight lock above any local status", () => {
    const s = deriveRemovalStatus({ local: "draft", lockInFlight: true });
    expect(s.label).toBe("In progress");
    expect(s.value).toBe("running");
    expect(s.isActionable).toBe(false);
  });

  it("treats a missing row as not submitted and actionable", () => {
    const s = deriveRemovalStatus({ local: null, lockInFlight: false });
    expect(s.label).toBe("Not submitted");
    expect(s.isActionable).toBe(true);
    expect(s.isTerminal).toBe(false);
  });

  it("treats a stale draft row as not submitted and actionable", () => {
    const s = deriveRemovalStatus({ local: "draft", lockInFlight: false });
    expect(s.label).toBe("Not submitted");
    expect(s.isActionable).toBe(true);
  });

  it("marks a submitted removal terminal (no remote accept/reject exists)", () => {
    const s = deriveRemovalStatus({ local: "submitted", lockInFlight: false });
    expect(s.label).toBe("Submitted");
    expect(s.value).toBe("issued");
    expect(s.isTerminal).toBe(true);
    expect(s.isActionable).toBe(false);
  });

  it("renders a superseded removal with the distinct superseded value", () => {
    const s = deriveRemovalStatus({ local: "superseded", lockInFlight: false });
    expect(s.label).toBe("Superseded");
    expect(s.value).toBe("superseded");
    expect(s.isTerminal).toBe(true);
  });

  it("maps a rejected removal back to actionable", () => {
    const s = deriveRemovalStatus({ local: "rejected", lockInFlight: false });
    expect(s.label).toBe("Rejected");
    expect(s.isActionable).toBe(true);
  });

  it("covers every local status without throwing", () => {
    const all: LocalSubmissionStatus[] = [
      "draft",
      "submitted",
      "accepted",
      "rejected",
      "superseded",
    ];
    for (const local of all) {
      expect(() =>
        deriveRemovalStatus({ local, lockInFlight: false }),
      ).not.toThrow();
    }
  });
});

describe("deriveStatementStatus", () => {
  const base = { local: "submitted" as LocalSubmissionStatus, lockInFlight: false };

  it("reports an in-flight lock above everything", () => {
    const s = deriveStatementStatus({
      ...base,
      remoteStatus: "AWAITING_VERIFICATION",
      lockInFlight: true,
    });
    expect(s.label).toBe("In progress");
  });

  it("treats a missing row as the ladder's first rung, Draft", () => {
    const s = deriveStatementStatus({
      local: null,
      lockInFlight: false,
      remoteStatus: null,
    });
    expect(s.label).toBe("Draft");
    expect(s.isActionable).toBe(true);
  });

  it("surfaces In verification from the remote overlay (not 'Submitted')", () => {
    const s = deriveStatementStatus({
      ...base,
      remoteStatus: "AWAITING_VERIFICATION",
    });
    expect(s.label).toBe("In verification");
    expect(s.value).toBe("pending");
    expect(s.isTerminal).toBe(false);
  });

  it("surfaces Issued — the payoff state — from the remote overlay", () => {
    const s = deriveStatementStatus({ ...base, remoteStatus: "CREDITS_ISSUED" });
    expect(s.label).toBe("Issued");
    expect(s.value).toBe("issued");
    expect(s.isTerminal).toBe(true);
  });

  it("surfaces Verified", () => {
    const s = deriveStatementStatus({ ...base, remoteStatus: "VERIFIED" });
    expect(s.label).toBe("Verified");
    expect(s.value).toBe("verified");
  });

  it("makes a failed verification actionable for resubmit", () => {
    const s = deriveStatementStatus({
      ...base,
      remoteStatus: "FAILED_VERIFICATION",
    });
    expect(s.label).toBe("Verification failed");
    expect(s.isActionable).toBe(true);
  });

  it("shows 'In registry' when created but remote is still DRAFT (was the colliding 'Submitted')", () => {
    const s = deriveStatementStatus({ ...base, remoteStatus: "DRAFT" });
    expect(s.label).toBe("In registry");
    expect(s.value).toBe("running");
    expect(s.isTerminal).toBe(false);
  });

  it("falls back to local 'Draft' before any submission", () => {
    const s = deriveStatementStatus({
      local: "draft",
      lockInFlight: false,
      remoteStatus: null,
    });
    expect(s.label).toBe("Draft");
    expect(s.isActionable).toBe(true);
  });

  it("covers every remote status without throwing", () => {
    const all: RemoteGhgStatus[] = [
      "DRAFT",
      "AWAITING_VERIFICATION",
      "VERIFIED",
      "CREDITS_ISSUED",
      "FAILED_VERIFICATION",
    ];
    for (const remoteStatus of all) {
      expect(() =>
        deriveStatementStatus({ ...base, remoteStatus }),
      ).not.toThrow();
    }
  });
});
