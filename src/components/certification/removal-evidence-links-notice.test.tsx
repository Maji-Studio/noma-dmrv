// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import {
  EVIDENCE_LINKS_MISMATCH_TITLE,
  EVIDENCE_LINKS_UNCONFIRMED_TITLE,
  RemovalEvidenceLinksNotice,
} from "./removal-evidence-links-notice";

const CHECKED_AT = "2026-10-19T09:00:00.000Z";

describe("RemovalEvidenceLinksNotice", () => {
  afterEach(cleanup);

  it("renders nothing before enrichment or when every link is confirmed", () => {
    const { container, rerender } = render(<RemovalEvidenceLinksNotice links={null} />);
    expect(container.innerHTML).toBe("");
    rerender(
      <RemovalEvidenceLinksNotice links={{ unconfirmedCount: 0, mismatchCount: 0, checkedAt: CHECKED_AT }} />,
    );
    expect(container.innerHTML).toBe("");
  });

  it("names unconfirmed Biochar Applications as a warning", () => {
    render(
      <RemovalEvidenceLinksNotice links={{ unconfirmedCount: 1, mismatchCount: 0, checkedAt: CHECKED_AT }} />,
    );
    const notice = screen.getByRole("status");
    expect(notice.textContent).toContain(EVIDENCE_LINKS_UNCONFIRMED_TITLE);
    expect(notice.textContent).toContain("the evidence on 1 Biochar Application.");
    expect(notice.getAttribute("data-tone")).toBe("warning");
  });

  it("puts a mismatch ahead of unconfirmed links", () => {
    render(
      <RemovalEvidenceLinksNotice links={{ unconfirmedCount: 1, mismatchCount: 2, checkedAt: CHECKED_AT }} />,
    );
    const notice = screen.getByRole("status");
    expect(notice.textContent).toContain(EVIDENCE_LINKS_MISMATCH_TITLE);
    expect(notice.textContent).toContain("2 Biochar Applications");
    expect(notice.textContent).not.toContain(EVIDENCE_LINKS_UNCONFIRMED_TITLE);
  });
});
