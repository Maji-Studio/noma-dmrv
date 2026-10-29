// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { stoppedEntryMessage } from "./emission-ledger-entries";
import { ReviewNotice } from "./emission-line-body-parts";
import { TemplateSetupNotice } from "./template-setup-notice";
import { makeEntry, makeLine } from "./emission-line-test-fixtures";
import { removalTemplateBlocker } from "@/lib/certification/removal-template-blockers";

vi.mock("next/link", () => ({ default: ({ href, children }: { href: string; children: React.ReactNode }) => <a href={href}>{children}</a> }));

afterEach(cleanup);

describe("read-only Emissions copy", () => {
  it("H6: a stopped entry states the fact, with no confirm or delete instruction", () => {
    for (const entry of [makeEntry({ canConfirm: true }), makeEntry({ canConfirm: false })]) {
      expect(stoppedEntryMessage(entry, false, true)).toBe("Stopped counting after a template change.");
    }
    expect(stoppedEntryMessage(makeEntry({ canConfirm: true }), true)).toContain("confirm");
  });

  it("H7: the template setup notice drops its Settings action", () => {
    const blocker = removalTemplateBlocker("unpinnedTemplate");
    render(<TemplateSetupNotice blocker={blocker} facilityId="fac" creditBatchId="cb" readOnly />);
    expect(screen.queryByRole("link")).toBeNull();
    expect(screen.getByText(blocker.message)).toBeTruthy();
    cleanup();
    render(<TemplateSetupNotice blocker={blocker} facilityId="fac" creditBatchId="cb" />);
    expect(screen.getByRole("link", { name: "Set template" })).toBeTruthy();
  });

  it("H8: the review notice fallback has no Admin instruction when read only", () => {
    const line = makeLine({ state: "needsReview", blocker: undefined });
    render(<ReviewNotice line={line} scope={{ facilityId: "fac", creditBatchId: "cb" }} readOnly />);
    expect(screen.getByText("This component has no decision yet.")).toBeTruthy();
    expect(screen.queryByText(/Admin answers/)).toBeNull();
  });
});
