import { describe, expect, it } from "vitest";
import { describeStatusChangeActor } from "./status-change-actor";

const recorded = { origin: "activity" as const, actorUnavailable: false };

describe("describeStatusChangeActor", () => {
  it("names no one for an entry rebuilt from the ledger", () => {
    expect(describeStatusChangeActor({ origin: "ledger", source: null, actorName: null, actorUnavailable: false })).toBeNull();
  });

  it("names the user for a change made in the app", () => {
    expect(describeStatusChangeActor({ ...recorded, source: "form", actorName: "Ada Operator" })).toBe("Ada Operator");
  });

  it.each([
    ["rest", "Ada Operator (REST API)"],
    ["mcp", "Ada Operator (MCP)"],
    ["registry", "Ada Operator (registry update)"],
  ] as const)("names the user with the %s channel", (source, expected) => {
    expect(describeStatusChangeActor({ ...recorded, source, actorName: "Ada Operator" })).toBe(expected);
  });

  it("uses the shared token when the recorded user can no longer be named", () => {
    expect(describeStatusChangeActor({ origin: "activity", source: "form", actorName: null, actorUnavailable: true }))
      .toBe("Changed by: Not available");
  });

  it.each([
    ["registry", "Registry update"],
    ["system", "System"],
    ["script", "Script"],
  ] as const)("labels a %s change that has no user", (source, expected) => {
    expect(describeStatusChangeActor({ ...recorded, source, actorName: null })).toBe(expected);
  });

  it("names no one for a user-less change from a channel that always has a user", () => {
    expect(describeStatusChangeActor({ ...recorded, source: "form", actorName: null })).toBeNull();
  });
});
