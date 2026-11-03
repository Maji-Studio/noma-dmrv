// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { stoppedEntryMessage } from "./emission-ledger-entries";
import { ReviewNotice } from "./emission-line-body-parts";
import { TemplateSetupNotice, templateSetupNoticeText } from "./template-setup-notice";
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

  it("H7: the template setup notice drops its Settings action and repair step", () => {
    const blocker = removalTemplateBlocker("unpinnedTemplate");
    render(<TemplateSetupNotice blocker={blocker} facilityId="fac" creditBatchId="cb" readOnly />);
    expect(screen.queryByRole("link")).toBeNull();
    expect(screen.getByText("This credit batch has no Removal template.")).toBeTruthy();
    expect(screen.queryByText(blocker.message)).toBeNull();
    cleanup();
    render(<TemplateSetupNotice blocker={blocker} facilityId="fac" creditBatchId="cb" />);
    expect(screen.getByRole("link", { name: "Set template" })).toBeTruthy();
    expect(screen.getByText(blocker.message)).toBeTruthy();
  });

  it("H7b: every template blocker reads as a fact on a read-only batch", () => {
    expect(templateSetupNoticeText(removalTemplateBlocker("notRemovalTemplate"), true)).toBe("This template is not a Removal template.");
    expect(templateSetupNoticeText(removalTemplateBlocker("missingFixedDatapoint"), true)).toBe("Some fixed values are not set in the Isometric template.");
    expect(templateSetupNoticeText(removalTemplateBlocker("templateNotFullyRead"), true)).toBe("Template not fully read.");
    expect(templateSetupNoticeText(removalTemplateBlocker("templateNotFound"), true)).toBe("Template no longer exists in Isometric.");
  });

  it("H8: the review notice fallback has no Admin instruction when read only", () => {
    const line = makeLine({ state: "needsReview", blocker: undefined });
    render(<ReviewNotice line={line} scope={{ facilityId: "fac", creditBatchId: "cb" }} readOnly />);
    expect(screen.getByText("This component has no decision yet.")).toBeTruthy();
    expect(screen.queryByText(/Admin answers/)).toBeNull();
  });
});
