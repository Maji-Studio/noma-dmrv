import { expect, it } from "vitest";
import { removalEntryOwner, type EntryContender, type RemovalEntryFact } from "./removal-emission-contributions";
const entry: RemovalEntryFact = { id: "entry", creditBatchId: "batch", componentId: "component", contentRevision: 1, kind: "value", lineRule: "additive", occurredOn: "2026-01-01", deletedAt: null, sentByRemovalId: null, confirmedForRemovalId: null, sendReservedBySubmissionId: null, counts: true, values: [], evidenceDocumentIds: [] };
const draft: EntryContender = { contenderKind: "draft", removalId: "draft", creditBatchIds: ["batch"], window: { start: "2026-01-01", end: "2026-01-02" }, createdAt: "2026-01-01" };
const correction: EntryContender = { ...draft, contenderKind: "correction", removalId: "correction", window: { ...draft.window, end: "2026-02-01" } };
it("prioritizes corrections, preserving existing claims and reservations", () => {
  expect(removalEntryOwner(entry, [draft, correction])).toBe("correction");
  expect(removalEntryOwner({ ...entry, sentByRemovalId: "draft" }, [draft, correction])).toBe("draft");
  expect(removalEntryOwner({ ...entry, reservedByRemovalId: "draft" }, [draft, correction])).toBe("draft");
  expect(removalEntryOwner({ ...entry, occurredOn: "2025-12-01" }, [draft, correction])).toBeNull();
});
