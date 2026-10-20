import { describe, expect, it } from "vitest";
import type { Row } from "@tanstack/react-table";
import type { SubmittedOnState } from "@/lib/certification/submitted-on";
import {
  submittedOnSortingFn,
  submittedOnSortValue,
  submittedOnText,
} from "./submitted-on-cell";

type Item = { submittedOn: SubmittedOnState };
const row = (submittedOn: SubmittedOnState) => ({ original: { submittedOn } }) as Row<Item>;

describe("submittedOnText", () => {
  it("formats a submitted date with the shared date format", () => {
    expect(submittedOnText({ kind: "submitted", at: new Date(2026, 9, 2, 12) })).toBe("Oct 2, 2026");
  });

  it("says Not submitted for a row never submitted", () => {
    expect(submittedOnText({ kind: "never" })).toBe("Not submitted");
  });

  it("says Submitted in Isometric for a statement the registry already held", () => {
    expect(submittedOnText({ kind: "registryDiscovered" })).toBe("Submitted in Isometric");
  });
});

describe("submitted on sorting", () => {
  const older = row({ kind: "submitted", at: "2026-09-01T10:00:00.000Z" });
  const newer = row({ kind: "submitted", at: new Date("2026-10-05T09:00:00.000Z") });

  it("orders dates chronologically, not alphabetically", () => {
    // "Oct 5, 2026" sorts before "Sep 1, 2026" as text, but is the later date.
    expect(submittedOnSortingFn(older, newer)).toBeLessThan(0);
    expect(submittedOnSortingFn(newer, older)).toBeGreaterThan(0);
  });

  it("gives undated rows no sort value so sortUndefined keeps them last", () => {
    expect(submittedOnSortValue({ kind: "never" })).toBeUndefined();
    expect(submittedOnSortValue({ kind: "registryDiscovered" })).toBeUndefined();
    expect(submittedOnSortValue({ kind: "submitted", at: "2026-09-01T10:00:00.000Z" })).toBe("Sep 1, 2026");
  });
});
