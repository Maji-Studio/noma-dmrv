import { describe, expect, it } from "vitest";
import { buildSubmissionWarningNotes } from "./submission-warning-notes";

const POST_WINDOW_SUFFIX =
  "§8.3.1 permits sampling from stored material only when Samples are spatially distributed across the stored batch. Confirm this with the registry.";

describe("buildSubmissionWarningNotes", () => {
  it("groups repeated post-production sample warnings into one plain-language note", () => {
    const warnings = [
      `Sample SAM-26-046 was taken on 2026-06-17, after credit batch CB-26-006's production window, 2026-06-15 to 2026-06-15. ${POST_WINDOW_SUFFIX}`,
      `Sample SAM-26-047 was taken on 2026-06-18, after credit batch CB-26-006's production window, 2026-06-15 to 2026-06-15. ${POST_WINDOW_SUFFIX}`,
      `Sample SAM-26-045 was taken on 2026-06-16, after credit batch CB-26-006's production window, 2026-06-15 to 2026-06-15. ${POST_WINDOW_SUFFIX}`,
    ];

    expect(buildSubmissionWarningNotes(warnings)).toEqual([
      expect.objectContaining({
        summary: "3 Samples were taken after production ended.",
        detail: expect.stringMatching(
          /SAM-26-046, SAM-26-047, and SAM-26-045.*Jun 16 to Jun 18, 2026.*Jun 15, 2026/,
        ),
      }),
    ]);
    expect(buildSubmissionWarningNotes(warnings)[0].detail).toContain(
      "stored-material Samples must represent the batch's full range",
    );
  });

  it("uses singular copy for one post-production sample", () => {
    const [note] = buildSubmissionWarningNotes([
      `Sample SAM-26-046 was taken on 2026-06-17, after credit batch CB-26-006's production window, 2026-06-15 to 2026-06-15. ${POST_WINDOW_SUFFIX}`,
    ]);

    expect(note.summary).toBe("1 Sample was taken after production ended.");
    expect(note.detail).toContain("SAM-26-046 was sampled");
  });

  it("keeps an unrecognised warning visible", () => {
    expect(buildSubmissionWarningNotes(["A new warning."])).toEqual([
      {
        key: "warning-0",
        summary: "A new warning.",
      },
    ]);
  });

  it("gives repeated recognized warnings unique render keys", () => {
    const warning =
      "Diesel fuel (genset and/or startup/preprocessing) cannot be mapped.";
    const notes = buildSubmissionWarningNotes([warning, warning]);

    expect(notes.map((note) => note.key)).toEqual([
      "unmapped-diesel-0",
      "unmapped-diesel-1",
    ]);
  });
});
