import { describe, expect, it } from "vitest";
import { lateRunEntryDate } from "./late-run-entry-date";

describe("lateRunEntryDate", () => {
  it("uses the batch start when the run started before the batch", () => {
    expect(lateRunEntryDate("2026-08-31", "2026-09-01")).toBe("2026-09-01");
  });
  it("uses the run start day when it is inside the batch", () => {
    expect(lateRunEntryDate("2026-09-09", "2026-09-01")).toBe("2026-09-09");
  });
  it("uses the shared day when the run starts on the batch start", () => {
    expect(lateRunEntryDate("2026-09-01", "2026-09-01")).toBe("2026-09-01");
  });
});
