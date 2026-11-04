// @vitest-environment jsdom
/**
 * The Overview of a read-only batch (#1512): the membership lock marks and
 * their "notes stay open" reason are repair-flow cues for an editor, so they
 * go away when nothing can be edited.
 */
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

const harness = vi.hoisted(() => ({ readOnly: false, withItems: false }));

vi.mock("./credit-batch-page-context", () => ({
  useCreditBatchPage: () => ({
    batch: { id: "cb-1", facilityId: "f-1", feedstockTypeName: "Maize", startDate: "2026-09-01", endDate: "2026-09-30", durabilityOption: "1000_year", sampling: "sampled", siteManagementNotes: null },
    lock: { level: "draft", usedBy: [{ kind: "removal" }] },
    canManage: true,
    focus: null,
    linesToDecide: 0,
    readOnly: harness.readOnly ? { message: "read only" } : undefined,
    pageModel: null,
    blockingCount: 0,
    openItems: harness.withItems
      ? { blocking: [{ id: "b", title: "Blocking item", target: null }], check: [{ id: "c", title: "Check item", target: null }], waiting: [{ id: "w", title: "Waiting item", target: null }] }
      : { blocking: [], check: [], waiting: [] },
  }),
}));
vi.mock("./credit-batch-removal-template", () => ({ CreditBatchRemovalTemplate: () => null }));
vi.mock("./credit-batch-late-entries", () => ({ CreditBatchLateEntries: () => null }));
vi.mock("./credit-batch-view", () => ({ durabilityLabel: () => "1000 year" }));
vi.mock("./credit-batch-page-parts", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./credit-batch-page-parts")>()),
  FocusRow: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}));
vi.mock("next/link", () => ({ default: ({ href, children }: { href: string; children: React.ReactNode }) => <a href={href}>{children}</a> }));

import { CreditBatchOverview } from "./credit-batch-page-overview";

afterEach(cleanup);

describe("CreditBatchOverview membership lock", () => {
  it("marks locked rows and explains the lock on an editable batch", () => {
    harness.readOnly = false;
    render(<CreditBatchOverview />);
    expect(screen.getAllByText("(locked)").length).toBeGreaterThan(0);
    expect(screen.getByRole("button", { name: "Why fields are locked" })).toBeTruthy();
  });

  it("shows no lock marks or lock reason on a read-only batch", () => {
    harness.readOnly = true;
    render(<CreditBatchOverview />);
    expect(screen.queryByText("(locked)")).toBeNull();
    expect(screen.queryByRole("button", { name: "Why fields are locked" })).toBeNull();
  });
});

describe("CreditBatchOverview to-do groups", () => {
  const HELP = [/Fix these before the next Removal\./, /Worth a look\./, /Nothing to do yet\./];

  it("explains each group on an editable batch", () => {
    harness.readOnly = false;
    harness.withItems = true;
    render(<CreditBatchOverview />);
    for (const help of HELP) expect(screen.getByText(help)).toBeTruthy();
  });

  it("drops the group help on a read-only batch, where no work lies ahead", () => {
    harness.readOnly = true;
    harness.withItems = true;
    render(<CreditBatchOverview />);
    expect(screen.getByText("Blocking item")).toBeTruthy();
    for (const help of HELP) expect(screen.queryByText(help)).toBeNull();
  });

  it("heads the waiting group Waiting on an editable batch", () => {
    harness.readOnly = false;
    harness.withItems = true;
    render(<CreditBatchOverview />);
    expect(screen.getByRole("heading", { name: /^Waiting/ })).toBeTruthy();
    expect(screen.queryByRole("heading", { name: /^Status/ })).toBeNull();
  });

  it("heads the waiting group Status on a read-only batch, since its items are statuses", () => {
    harness.readOnly = true;
    harness.withItems = true;
    render(<CreditBatchOverview />);
    expect(screen.getByRole("heading", { name: /^Status/ })).toBeTruthy();
    expect(screen.queryByRole("heading", { name: /^Waiting/ })).toBeNull();
  });
});
