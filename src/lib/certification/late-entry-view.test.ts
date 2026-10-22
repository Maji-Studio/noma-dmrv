import { describe, expect, it } from "vitest";
import { CARRY_WAITING_REASONS } from "./emission-entry-carry";
import { lateEntryView, waitingAction, waitingDetail, waitingEntryTitle, type LateEntryFacts } from "./late-entry-view";
import { lateEntryRows } from "./late-entry-list";

const AFTER = { removalId: "rm-9", removalCode: "RM-26-009" };
const DEST = { removalId: "rm-10", removalCode: "RM-26-010", creditBatchCodes: ["CB-26-010"], creditBatchIds: ["cb-10"], anotherCreditBatch: true };

describe("lateEntryView", () => {
  it("is null for an entry that was not recorded after its Removal was sent", () => {
    expect(lateEntryView({}, "f1")).toBeNull();
    expect(lateEntryView({ carry: { receiver: DEST, waitingReason: null } }, "f1")).toBeNull();
  });

  it("is null when no Removal has it and nothing waits", () => {
    expect(lateEntryView({ recordedAfter: AFTER, carry: { receiver: null, waitingReason: null } }, "f1")).toBeNull();
  });

  it("links the origin Removal and a draft receiver", () => {
    const view = lateEntryView({ recordedAfter: AFTER, carry: { receiver: DEST, waitingReason: null } }, "f1");
    expect(view?.recordedAfter).toEqual({ removalCode: "RM-26-009", removalHref: "/certification/removals?facility=f1&removal=rm-9" });
    expect(view?.destination).toEqual({ kind: "draft", removalCode: "RM-26-010", removalHref: "/certification/removals?facility=f1&removal=rm-10", creditBatches: [{ code: "CB-26-010", href: "/credit-batches/cb-10?facility=f1" }], anotherCreditBatch: true });
  });

  it("reports a sent destination before any receiver", () => {
    const facts: LateEntryFacts = { recordedAfter: AFTER, reportedIn: DEST, carry: { receiver: DEST, waitingReason: null } };
    expect(lateEntryView(facts, "f1")?.destination.kind).toBe("reported");
  });

  it.each([
    ["noDraft", "New Removal", "/certification/removals?facility=f1&create=true"],
    ["incompatibleTemplate", "Open Removal templates", "/settings/removal-templates?facility=f1"],
    ["templateUnknown", "Open Removals", "/certification/removals?facility=f1"],
  ] as const)("waits for %s with the server text and one action", (reason, label, href) => {
    const view = lateEntryView({ recordedAfter: AFTER, carry: { receiver: null, waitingReason: reason } }, "f1");
    expect(view?.destination).toEqual({ kind: "waiting", reason, text: CARRY_WAITING_REASONS[reason], action: { label, href } });
    expect(waitingAction(reason, "f1")).toEqual({ label, href });
  });

  it("drops the lead sentence for the to-do detail", () => {
    expect(waitingDetail("noDraft")).toBe("No later draft is available at this facility.");
    expect(waitingEntryTitle("Diesel use", "2026-09-14")).toBe("Diesel use of Sep 14, 2026 is waiting for a Removal");
  });
});

describe("lateEntryRows", () => {
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
