import { UNKNOWN_FACILITY_TIMEZONE } from "@/lib/date-utils";
import { describe, expect, it } from "vitest";
import type { RemovalBarRemoval } from "@/lib/credit-batches/removal-bar";
import { compactLabel, removalDateLine } from "./credit-batch-removal-bar";

describe("removalDateLine", () => {
  const createdAt = new Date("2026-10-01T12:00:00Z");
  const submittedAt = new Date("2026-10-12T12:00:00Z");

  it("dates a submitted Removal by its submission", () => {
    expect(removalDateLine({ phase: "submitted", submittedAt, createdAt }, UNKNOWN_FACILITY_TIMEZONE)).toBe("Submitted Oct 12, 2026");
  });

  it("dates an interrupted submission, shown as a draft, by its creation", () => {
    expect(removalDateLine({ phase: "draft", submittedAt, createdAt }, UNKNOWN_FACILITY_TIMEZONE)).toBe("Created Oct 1, 2026");
  });
});

it("dates a Removal on the facility calendar", () => {
  const createdAt = new Date("2026-10-21T21:30:00Z");
  expect(removalDateLine({ phase: "draft", submittedAt: null, createdAt }, "Africa/Dar_es_Salaam")).toBe("Created Oct 22, 2026");
});

describe("compactLabel", () => {
  const removal = (phase: "draft" | "submitted", kind: "submitted" | "not-submitted" | "interrupted", label: string) =>
    ({ code: "RM-26-001", phase, status: { kind, label } }) as unknown as RemovalBarRemoval;

  it("names only what the swatch cannot show", () => {
    expect(compactLabel({ removal: removal("submitted", "submitted", "Submitted"), dryKg: 400 })).toBe("RM-26-001 · 0.40 t");
    expect(compactLabel({ removal: removal("draft", "not-submitted", "Not submitted"), dryKg: 400 })).toBe("RM-26-001 · Draft · 0.40 t");
    expect(compactLabel({ removal: removal("draft", "interrupted", "Submission interrupted"), dryKg: 400 }))
      .toBe("RM-26-001 · Submission interrupted · 0.40 t");
  });

  it("keeps a corrected Removal submitted, as its swatch and stepper do", () => {
    expect(compactLabel({ removal: removal("submitted", "not-submitted", "Not submitted"), dryKg: 400 })).toBe("RM-26-001 · 0.40 t");
  });
});
