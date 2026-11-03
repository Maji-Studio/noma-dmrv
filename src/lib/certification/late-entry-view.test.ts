import { describe, expect, it } from "vitest";
import { CARRY_WAITING_REASONS } from "./emission-entry-carry";
import { lateEntryView, waitingAction, waitingDetailCopy, waitingDetail, waitingEntryTitle, type LateEntryFacts } from "./late-entry-view";
import { lateEntryRows } from "./late-entry-list";

const AFTER = { removalId: "rm-9", removalCode: "RM-26-009" };
const DEST = { removalId: "rm-10", removalCode: "RM-26-010", creditBatchCodes: ["CB-26-010"], creditBatchIds: ["cb-10"], anotherCreditBatch: true };

describe("lateEntryView", () => {
  it("is null for an entry with no carry and nothing reporting it", () => {
    expect(lateEntryView({}, "f1")).toBeNull();
  });

  it("has a receiver without a Removal it was recorded after", () => {
    const view = lateEntryView({ carry: { receiver: DEST, waitingReason: null } }, "f1");
    expect(view?.recordedAfter).toBeNull();
    expect(view?.destination.kind).toBe("draft");
  });

  it("waits without a Removal it was recorded after", () => {
    const view = lateEntryView({ carry: { receiver: null, waitingReason: "noDraft" } }, "f1", { canManage: true });
    expect(view?.recordedAfter).toBeNull();
    expect(view?.destination).toMatchObject({ kind: "waiting", reason: "noDraft" });
  });

  it("is null for an entry a Removal of its own batch sent, in a later Removal or after a return", () => {
    const own = { ...DEST, anotherCreditBatch: false };
    expect(lateEntryView({ recordedAfter: AFTER, reportedIn: own, carry: { receiver: null, waitingReason: null } }, "f1")).toBeNull();
    expect(lateEntryView({ reportedIn: own }, "f1")).toBeNull();
  });

  it("is null when no Removal has it and nothing waits", () => {
    expect(lateEntryView({ recordedAfter: AFTER, carry: { receiver: null, waitingReason: null } }, "f1")).toBeNull();
  });

  it("links the origin Removal and a draft receiver", () => {
    const view = lateEntryView({ recordedAfter: AFTER, carry: { receiver: DEST, waitingReason: null } }, "f1");
    expect(view?.recordedAfter).toEqual({ removalCode: "RM-26-009", removalHref: "/removals?facility=f1&removal=rm-9" });
    expect(view?.destination).toEqual({ kind: "draft", removalCode: "RM-26-010", removalHref: "/removals?facility=f1&removal=rm-10", creditBatches: [{ code: "CB-26-010", href: "/credit-batches/cb-10?facility=f1" }], anotherCreditBatch: true });
  });

  it("reports a sent destination before any receiver", () => {
    const facts: LateEntryFacts = { recordedAfter: AFTER, reportedIn: DEST, carry: { receiver: DEST, waitingReason: null } };
    expect(lateEntryView(facts, "f1")?.destination.kind).toBe("reported");
  });

  it("links a revision before a waiting reason and keeps the recorded-after fact", () => {
    const facts = { revisionOf: AFTER, recordedAfter: AFTER, carry: { receiver: null, waitingReason: "noDraft" as const } };
    expect(lateEntryView(facts, "f1")).toEqual({
      recordedAfter: { removalCode: AFTER.removalCode, removalHref: "/removals?facility=f1&removal=rm-9" },
      destination: { kind: "revision", removalCode: AFTER.removalCode, removalHref: "/removals?facility=f1&removal=rm-9" },
    });
    expect(lateEntryView({ ...facts, carry: { receiver: DEST, waitingReason: null } }, "f1")?.destination.kind).toBe("draft");
    expect(lateEntryView({ ...facts, reportedIn: DEST }, "f1")?.destination.kind).toBe("reported");
    expect(lateEntryView({ ...facts, reportedIn: { ...DEST, anotherCreditBatch: false } }, "f1")).toBeNull();
  });

  it.each([
    ["noDraft", "New Removal", "/removals?facility=f1&create=true"],
    ["incompatibleTemplate", "Open Removal templates", "/settings/removal-templates?facility=f1"],
    ["templateUnknown", "Open Removals", "/removals?facility=f1"],
  ] as const)("waits for %s with the server text and one action", (reason, label, href) => {
    const view = lateEntryView({ recordedAfter: AFTER, carry: { receiver: null, waitingReason: reason } }, "f1", { canManage: true });
    expect(view?.destination).toEqual({ kind: "waiting", reason, text: CARRY_WAITING_REASONS[reason], action: { label, href } });
    expect(waitingAction(reason, "f1")).toEqual({ label, href });
  });

  it("opens the draft whose template is not read yet", () => {
    const carry = { receiver: null, waitingReason: "templateUnknown" as const, waitingFor: { removalId: "rm-11", removalCode: "RM-26-011" } };
    expect(lateEntryView({ carry }, "f1")?.destination).toMatchObject({ action: { label: "Open Removal", href: "/removals?facility=f1&removal=rm-11" } });
  });

  it("gives a member the template text without the templates action", () => {
    const carry = { receiver: null, waitingReason: "incompatibleTemplate" as const };
    const destination = lateEntryView({ recordedAfter: AFTER, carry }, "f1", { canManage: false })?.destination;
    expect(destination).toMatchObject({ kind: "waiting", action: null });
    expect(destination?.kind === "waiting" && destination.text).toContain("An Admin changes it in Settings, Removal templates.");
    expect(waitingDetail("incompatibleTemplate", false)).toContain("An Admin changes it");
    expect(waitingDetail("incompatibleTemplate", true)).not.toContain("An Admin");
  });

  it("drops the lead sentence for the to-do detail", () => {
    expect(waitingDetail("noDraft")).toBe("No later draft is available at this facility.");
    expect(waitingEntryTitle("Diesel use", "2026-09-14")).toBe("Diesel use of Sep 14, 2026 is waiting for a Removal");
  });
});

describe("lateEntryRows", () => {
  it("includes an entry returning to its own Removal revision", () => {
    const rows = lateEntryRows([{ displayName: "Diesel use", entries: [{ id: "revision", componentId: "d",
      occurredOn: "2026-09-14", kind: "value", hasEvidence: true, total: { magnitude: "120", unit: "L" },
      counts: true, revisionOf: AFTER, recordedAfter: AFTER }] }], "f1");
    expect(rows.map(row => [row.id, row.view.destination.kind])).toEqual([["revision", "revision"]]);
  });
  it("lists only late entries, oldest day first", () => {
    const rows = lateEntryRows([
      { displayName: "Diesel use", entries: [
        { id: "a", componentId: "d", kind: "value", hasEvidence: true, total: null, counts: true },
        { id: "b", occurredOn: "2026-09-14", recordedAfter: AFTER, carry: { receiver: null, waitingReason: "noDraft" }, componentId: "d", kind: "value", hasEvidence: true, total: { magnitude: "120", unit: "L" }, counts: true },
      ] },
    ], "f1");
    expect(rows.map((row) => row.id)).toEqual(["b"]);
  });
});


it.each([true, false])("keeps waiting copy unchanged when the viewer canManage=%s", (canManage) => {
  for (const reason of ["noDraft", "templateUnknown", "incompatibleTemplate"] as const) {
    const copy = waitingDetailCopy(reason, canManage);
    expect([copy.detail, copy.instruction].filter(Boolean).join(" ")).toBe(waitingDetail(reason, canManage));
    expect(copy.detail).not.toMatch(/Open the Removal|An Admin|in Settings/);
  }
});
