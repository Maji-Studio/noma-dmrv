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
      id: "removal", submissions: [{ status: "submitted", externalId: "entry", submittedAt: "2026-10-01T00:00:00Z" }], statements: [{
        id: "statement", status, fresh: true, submittedToVerifier: true, returnedAt: "2026-10-02T00:00:00Z", removalExternalIds: ["entry"],
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

it.each([['2026-10-03', 'sent'], ['2026-10-01', 'open']])('version 2 submitted at %s yields %s after return', (submittedAt, level) => {
  expect(recordLocks.removal({ dependents: [], removals: [{ id: 'removal', submissions: [
    { id: 'v1', status: 'superseded', externalId: 'entry1', hasRemoteMutation: true, submittedAt: '2026-09-30' },
    { id: 'v2', status: 'submitted', externalId: 'entry2', submittedAt },
  ], statements: [{ id: 'statement', status: 'FAILED_VERIFICATION', fresh: true, submittedToVerifier: true,
    returnedAt: '2026-10-02', removalExternalIds: ['entry1', 'entry2'] }] }] }).level).toBe(level);
});
it('a returned statement cannot release a version it does not cover', () => {
  expect(recordLocks.removal({ dependents: [], removals: [{ id: 'removal', submissions: [
    { status: 'submitted', externalId: 'entry2', submittedAt: '2026-10-01' },
  ], statements: [{ id: 'statement', status: 'FAILED_VERIFICATION', fresh: true, submittedToVerifier: true,
    returnedAt: '2026-10-02', removalExternalIds: ['entry1'] }] }] }).level).toBe('sent');
});

it.each([
  { submittedAt: null, createdAt: null },
  { submittedAt: null, createdAt: "2026-10-01" },
  { submittedAt: "invalid", createdAt: "2026-10-01" },
])("keeps a remote attempt locked without a known submission time: %j", times => {
  expect(recordLocks.removal({ dependents: [], removals: [{
    id: "removal", submissions: [{ status: "submitted", externalId: "entry", ...times }],
    statements: [{ id: "statement", status: "FAILED_VERIFICATION", fresh: true,
      submittedToVerifier: true, returnedAt: "2026-10-02", removalExternalIds: ["entry"] }],
  }] }).level).toBe("sent");
});

it.each([null, undefined, "invalid"])("keeps a remote attempt locked without a known return time: %s", returnedAt => {
  expect(recordLocks.removal({ dependents: [], removals: [{
    id: "removal", submissions: [{ status: "submitted", externalId: "entry", submittedAt: "2026-10-01" }],
    statements: [{ id: "statement", status: "FAILED_VERIFICATION", fresh: true,
      submittedToVerifier: true, returnedAt, removalExternalIds: ["entry"] }],
  }] }).level).toBe("sent");
});


it.each(["sent", "inUse"] as const)("names holders and gives release guidance for %s", async level => {
  const { withRecordLockGuidance } = await import("./record-lock");
  const message = withRecordLockGuidance("Cannot edit this record.", {
    level, heldBy: [{ kind: "productionRun", id: "internal-id", label: "RUN-42" }], freeFields: [],
    howToFree: "Correct the production run first.",
  });
  expect(message).toBe("Cannot edit this record. Held by production run RUN-42. Correct the production run first.");
});

it("words the In use refusal for one holder or several, and keeps custom sentences", async () => {
  const { withRecordLockGuidance, inUseHowToFree, IN_USE_HOW_TO_FREE } = await import("./record-lock");
  const holder = (id: string) => ({ kind: "delivery", id, label: id });
  const lock = (heldBy: ReturnType<typeof holder>[], howToFree: string) => ({ level: "inUse" as const, heldBy, freeFields: [], howToFree });
  expect(withRecordLockGuidance("No.", lock([holder("DL-1")], IN_USE_HOW_TO_FREE)))
    .toBe("No. Held by delivery DL-1. To change this, first correct or remove the record that uses it.");
  expect(withRecordLockGuidance("No.", lock([holder("DL-1"), holder("DL-2")], IN_USE_HOW_TO_FREE)))
    .toBe("No. Held by delivery DL-1, delivery DL-2. To change this, first correct or remove the records that use it.");
  expect(withRecordLockGuidance("No.", lock([holder("DL-1")], "Custom."))).toBe("No. Held by delivery DL-1. Custom.");
  expect(inUseHowToFree("notice", 1)).toBe("To change them, first correct or remove that record.");
  expect(inUseHowToFree("notice", 3)).toBe(IN_USE_HOW_TO_FREE);
});

describe("returned Removals", () => {
  const returned = (submittedAt: string) => ({ id: "removal", submissions: [{ status: "submitted", externalId: "entry", submittedAt }], statements: [{
    id: "statement", status: "FAILED_VERIFICATION", fresh: true, submittedToVerifier: true, returnedAt: "2026-10-02T00:00:00Z", removalExternalIds: ["entry"],
  }] });

  it("names the returned Removal and its statement once Sent is lifted", () => {
    expect(recordLocks.productionRun({ dependents: [], removals: [returned("2026-10-01T00:00:00Z")] })).toMatchObject({
      level: "open", returnedBy: [{ removalId: "removal", statements: [{ id: "statement", status: "FAILED_VERIFICATION" }] }],
    });
  });

  it("is not returned when an attempt is newer than the return, which keeps it Sent", () => {
    const lock = recordLocks.productionRun({ dependents: [], removals: [returned("2026-10-03T00:00:00Z")] });
    expect(lock.level).toBe("sent");
    expect(lock.returnedBy).toBeUndefined();
  });

  it("is not returned when nothing ever reached Isometric", () => {
    expect(recordLocks.productionRun({ dependents: [], removals: [{ id: "removal", submissions: [{ status: "rejected" }], statements: [] }] }).returnedBy).toBeUndefined();
  });
});
