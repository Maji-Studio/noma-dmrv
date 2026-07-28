import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { SubmissionNotes } from "./submission-notes";

describe("SubmissionNotes", () => {
  it("renders a calm non-blocking notes summary", () => {
    const html = renderToStaticMarkup(
      <SubmissionNotes
        notes={[
          {
            key: "post-window",
            summary: "3 samples were taken after production ended.",
            detail: "Stored-material sampling detail.",
          },
          {
            key: "provenance",
            summary: "Run/day details are missing for all 3 samples.",
          },
        ]}
      />,
    );

    expect(html).toContain("Notes");
    expect(html).toContain("Does not block submission");
    expect(html).toContain(
      'class="body-small text-[var(--color-text-secondary)]">Advisory: 3 samples were taken after production ended.',
    );
    expect(html).toContain(
      'aria-label="Details for: 3 samples were taken after production ended."',
    );
  });

  it("does not render an empty notes surface", () => {
    expect(renderToStaticMarkup(<SubmissionNotes notes={[]} />)).toBe("");
  });
});
