import { describe, expect, it } from "vitest";
import { REGISTRY_DISCOVERY_SOURCE } from "./submission-source";
import { statementSubmittedOnState, submittedOnState } from "./submitted-on";

const SUBMITTED_AT = "2026-03-15T10:30:00.000Z";
const DISCOVERED = { semantic: { source: REGISTRY_DISCOVERY_SOURCE } };

describe("submittedOnState (Removals, ledger submitted_at)", () => {
  it("returns never without a row or a timestamp", () => {
    expect(submittedOnState(null)).toEqual({ kind: "never" });
    expect(submittedOnState({ submittedAt: null })).toEqual({ kind: "never" });
  });

  it.each([SUBMITTED_AT, new Date(SUBMITTED_AT)])(
    "preserves the submitted timestamp without conversion (%s)",
    (submittedAt) => {
      const state = submittedOnState({ submittedAt });
      expect(state).toEqual({ kind: "submitted", at: submittedAt });
      if (state.kind === "submitted") expect(state.at).toBe(submittedAt);
    },
  );
});

describe("statementSubmittedOnState (verifier submission)", () => {
  const draftRow = { payloadSnapshot: {}, metadata: { remoteStatus: "DRAFT" } };

  it("is never for a created statement still in draft", () => {
    expect(statementSubmittedOnState(null, draftRow)).toEqual({ kind: "never" });
    expect(statementSubmittedOnState(null, null)).toEqual({ kind: "never" });
  });

  it("uses the recorded verifier submission time", () => {
    const row = { payloadSnapshot: {}, metadata: { submittedToVerifierAt: SUBMITTED_AT } };
    expect(statementSubmittedOnState(row, row)).toEqual({ kind: "submitted", at: SUBMITTED_AT });
  });

  it("ignores an unparseable recorded time", () => {
    const row = { payloadSnapshot: {}, metadata: { submittedToVerifierAt: "garbage" } };
    expect(statementSubmittedOnState(row, row)).toEqual({ kind: "never" });
  });

  it("uses the registry's own timestamp for a discovered statement", () => {
    const row = { payloadSnapshot: DISCOVERED, metadata: { remoteStatus: "VERIFIED", submittedToVerifierAt: SUBMITTED_AT } };
    expect(statementSubmittedOnState(row, row)).toEqual({ kind: "submitted", at: SUBMITTED_AT });
  });

  it("says registry-submitted for a discovered statement past draft with no recorded date", () => {
    const row = { payloadSnapshot: DISCOVERED, metadata: { remoteStatus: "AWAITING_VERIFIER" } };
    expect(statementSubmittedOnState(null, row)).toEqual({ kind: "registryDiscovered" });
  });

  it("keeps a discovered statement still in draft as never", () => {
    const row = { payloadSnapshot: DISCOVERED, metadata: { remoteStatus: "DRAFT" } };
    expect(statementSubmittedOnState(null, row)).toEqual({ kind: "never" });
  });
});
