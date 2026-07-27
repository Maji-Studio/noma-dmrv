import { describe, expect, it } from "vitest";
import { buildSubmissionWarningNotes } from "./submission-warning-notes";

const POST_WINDOW_SUFFIX =
  "§8.3.1 permits sampling from stored material only when samples are spatially distributed across the stored batch; confirm this with the registry. This sampling day does not count as within-batch temporal distribution.";

describe("buildSubmissionWarningNotes", () => {
  it("groups repeated post-production sample warnings into one plain-language note", () => {
    const warnings = [
      `Sample SAM-26-046 was taken on 2026-06-17, after credit batch CB-26-006's production window 2026-06-15–2026-06-15. ${POST_WINDOW_SUFFIX}`,
      `Sample SAM-26-047 was taken on 2026-06-18, after credit batch CB-26-006's production window 2026-06-15–2026-06-15. ${POST_WINDOW_SUFFIX}`,
      `Sample SAM-26-045 was taken on 2026-06-16, after credit batch CB-26-006's production window 2026-06-15–2026-06-15. ${POST_WINDOW_SUFFIX}`,
    ];

    expect(buildSubmissionWarningNotes(warnings)).toEqual([
      expect.objectContaining({
        summary: "3 samples were taken after production ended.",
        detail: expect.stringMatching(
          /SAM-26-046, SAM-26-047, and SAM-26-045.*Jun 16 – Jun 18, 2026.*Jun 15, 2026/,
        ),
      }),
    ]);
    expect(buildSubmissionWarningNotes(warnings)[0].detail).toContain(
      "does not count as within-batch temporal distribution",
    );
  });

  it("simplifies missing run/day provenance without losing the protocol context", () => {
    const [note] = buildSubmissionWarningNotes([
      "Credit batch CB-26-006: all 3 replicates have unknown run/day provenance — §8.3.1 expects ≥3 independent samples distributed across distinct runs/days. Confirm this is a registry-agreed sampling alternative.",
    ]);

    expect(note.summary).toBe(
      "Run/day details are missing for all 3 samples.",
    );
    expect(note.detail).toContain("CB-26-006");
    expect(note.detail).toContain("§8.3.1");
  });

  it("uses singular copy for one post-production sample", () => {
    const [note] = buildSubmissionWarningNotes([
      `Sample SAM-26-046 was taken on 2026-06-17, after credit batch CB-26-006's production window 2026-06-15–2026-06-15. ${POST_WINDOW_SUFFIX}`,
    ]);

    expect(note.summary).toBe("1 sample was taken after production ended.");
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
