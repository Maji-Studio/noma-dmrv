import { describe, expect, it } from "vitest";
import { REGISTRY_DISCOVERY_SOURCE } from "./submission-source";
import { submittedOnState } from "./submitted-on";

const SUBMITTED_AT = "2026-03-15T10:30:00.000Z";
const DISCOVERED_SNAPSHOT = {
  semantic: { source: REGISTRY_DISCOVERY_SOURCE },
};

describe("submittedOnState", () => {
  it("returns never without a ledger row", () => {
    expect(submittedOnState(null)).toEqual({ kind: "never" });
  });

  it.each([null, {}, DISCOVERED_SNAPSHOT])(
    "returns never when submittedAt is null, including registry discovery (%j)",
    (payloadSnapshot) => {
      expect(submittedOnState({ submittedAt: null, payloadSnapshot })).toEqual({
        kind: "never",
      });
    },
  );

  it.each([SUBMITTED_AT, new Date(SUBMITTED_AT)])(
    "preserves the submitted timestamp without conversion (%s)",
    (submittedAt) => {
      const state = submittedOnState({ submittedAt, payloadSnapshot: {} });
      expect(state).toEqual({ kind: "submitted", at: submittedAt });
      if (state.kind === "submitted") expect(state.at).toBe(submittedAt);
    },
  );

  it("distinguishes discovery time from operator submission time", () => {
    expect(
      submittedOnState({
        submittedAt: SUBMITTED_AT,
        payloadSnapshot: DISCOVERED_SNAPSHOT,
      }),
    ).toEqual({ kind: "registryDiscovered" });
  });

  it.each([
    undefined,
    null,
    false,
    0,
    "registry-discovery",
    [],
    {},
    { source: REGISTRY_DISCOVERY_SOURCE },
    { semantic: null },
    { semantic: "registry-discovery" },
    { semantic: [] },
    { semantic: {} },
    { semantic: { source: "operator" } },
    { semantic: { source: "registry-discovery-other" } },
  ])("treats other or malformed snapshots as submitted (%j)", (payloadSnapshot) => {
    expect(
      submittedOnState({ submittedAt: SUBMITTED_AT, payloadSnapshot }),
    ).toEqual({ kind: "submitted", at: SUBMITTED_AT });
  });
});
