import { describe, expect, it } from "vitest";
import { recordLocks } from "./record-lock";

describe.each(Object.entries(recordLocks))("%s record lock", (_kind, lock) => {
  it("is Open without dependencies and In use when a later record uses it", () => {
    expect(lock({ dependents: [], removals: [] }).level).toBe("open");
    expect(lock({ dependents: [{ kind: "application", id: "application" }], removals: [] }))
      .toMatchObject({ level: "inUse", heldBy: [{ kind: "application", id: "application" }] });
  });

  it.each(["FAILED_VERIFICATION", "DRAFT"])("reopens after a fresh %s from Certify, retaining dependency locks", status => {
    expect(lock({ dependents: [{ kind: "application", id: "application" }], removals: [{
      id: "removal", submissions: [{ status: "submitted" }], statements: [{
        id: "statement", status, fresh: true, submittedToVerifier: true,
      }],
    }] }).level).toBe("inUse");
  });

  it.each(["AWAITING_VERIFICATION", "VERIFIED", "CREDITS_ISSUED", "UNKNOWN"])("another %s statement prevents reopening", status => {
    expect(lock({ dependents: [], removals: [{ id: "removal", submissions: [{ status: "submitted" }], statements: [
      { id: "returned", status: "FAILED_VERIFICATION", fresh: true, submittedToVerifier: true },
      { id: "other", status, fresh: true, submittedToVerifier: true },
    ] }] }).level).toBe("sent");
  });

  it.each([
    { status: "DRAFT", fresh: true, submittedToVerifier: false },
    { status: "FAILED_VERIFICATION", fresh: false, submittedToVerifier: true },
    { status: "DRAFT", fresh: true, submittedToVerifier: true, inFlight: true },
  ])("does not reopen without fresh return evidence or while in flight: %j", statement => {
    expect(lock({ dependents: [], removals: [{ id: "removal", submissions: [{ status: "submitted" }],
      statements: [{ id: "statement", ...statement }],
    }] }).level).toBe("sent");
  });

  it("fails closed on an unknown ledger status", () => {
    expect(lock({ dependents: [], removals: [{ id: "removal", submissions: [{ status: "unknown" }], statements: [] }] }).level).toBe("sent");
  });
  it("stays Sent when a failed second attempt follows a submitted first version", () => {
    expect(lock({
      dependents: [],
      removals: [{ id: "removal", submissions: [
        { status: "submitted" }, { status: "rejected" },
      ], statements: [] }],
    })).toMatchObject({ level: "sent", freeFields: [] });
  });
});
