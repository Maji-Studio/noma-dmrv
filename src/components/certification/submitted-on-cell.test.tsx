import { UNKNOWN_FACILITY_TIMEZONE } from "@/lib/date-utils";
import { describe, expect, it } from "vitest";
import { submittedOnText } from "./submitted-on-cell";


describe("submittedOnText", () => {
  it("formats a submitted date with the shared date format", () => {
    expect(submittedOnText({ kind: "submitted", at: new Date("2026-10-02T12:00:00Z") }, UNKNOWN_FACILITY_TIMEZONE)).toBe("Oct 2, 2026");
  });

  it("says Not submitted for a row never submitted", () => {
    expect(submittedOnText({ kind: "never" }, UNKNOWN_FACILITY_TIMEZONE)).toBe("Not submitted");
  });

  it("says Submitted in Isometric for a statement the registry already held", () => {
    expect(submittedOnText({ kind: "registryDiscovered" }, UNKNOWN_FACILITY_TIMEZONE)).toBe("Submitted in Isometric");
  });
});

it("uses the facility calendar for submission instants", () => {
  expect(submittedOnText({ kind: "submitted", at: new Date("2026-10-21T21:30:00Z") }, "Africa/Dar_es_Salaam")).toBe("Oct 22, 2026");
});
