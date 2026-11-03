import { describe, expect, it } from "vitest";
import type { RecordLockLink } from "@/lib/record-lock-view";
import { recordLockLinkText, recordLockLinkTitle } from "./record-lock-labels";

const removal = (overrides: Partial<RecordLockLink> = {}): RecordLockLink => ({
  kind: "removal", id: "r1", label: "RM-26-001", facilityId: "f1", period: null, ...overrides,
});

describe("Removal links", () => {
  it("name the Removal by its code, with its period after", () => {
    expect(recordLockLinkTitle(removal())).toBe("Removal RM-26-001");
    expect(recordLockLinkTitle(removal({ period: { startedOn: "2026-01-01", completedOn: "2026-03-31" } }))).toBe("Removal RM-26-001, Jan 1 to Mar 31, 2026");
    expect(recordLockLinkText(removal())).toBe("Removal RM-26-001");
  });

  it("keep the period wording in sentences and fall back when no code is known", () => {
    const period = { startedOn: "2026-01-01", completedOn: "2026-03-31" };
    expect(recordLockLinkText(removal({ period }))).toBe("Removal Jan 1 to Mar 31, 2026");
    expect(recordLockLinkTitle(removal({ label: null }))).toBe("Removal");
  });
});
