// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import type { RemovalCorrection } from "@/lib/certification/removal-entry-correction";
import { RemovalResubmitNotice, ResubmitRemovalAction } from "./removal-resubmit-notice";

afterEach(cleanup);

const FACILITY = "facility-1";
const correction = (overrides: Partial<RemovalCorrection> = {}): RemovalCorrection => ({
  removalId: "removal-1", removalCode: "RM-26-001", windowOpen: true, resubmitNeeded: false,
  statement: { id: "statement-1", status: "FAILED_VERIFICATION", reportingPeriodStartOn: "2026-07-01", reportingPeriodEndOn: "2026-09-30" },
  batches: [{ id: "batch-1", code: "CB-26-001" }, { id: "batch-2", code: "CB-26-002" }], changed: [], ...overrides,
});
const changed = [
  { componentId: "a", componentName: "Diesel use", batchId: "batch-1", batchCode: "CB-26-001" },
  { componentId: "b", componentName: "Transport to field", batchId: "batch-2", batchCode: "CB-26-002" },
];

describe("RemovalResubmitNotice", () => {
  it("names what changed, links each batch and asks to resubmit the Removal, then the GHG Statement", () => {
    render(<RemovalResubmitNotice correction={correction({ resubmitNeeded: true, changed })} facilityId={FACILITY} />);
    const notice = screen.getByRole("status");
    expect(notice.textContent).toBe(
      "Diesel use (CB-26-001) and Transport to field (CB-26-002) changed since this Removal was sent. Resubmit it, then resubmit GHG Statement Jul 1 to Sep 30, 2026.",
    );
    expect(screen.getByRole("link", { name: "CB-26-001" }).getAttribute("href")).toBe("/credit-batches/batch-1?facility=facility-1&tab=emissions");
    expect(screen.getByRole("link", { name: "GHG Statement Jul 1 to Sep 30, 2026" }).getAttribute("href"))
      .toBe("/certification/ghg-statements?facility=facility-1&statement=statement-1");
    // The status badge already says it, so the notice carries no title and no action link.
    expect(screen.queryByText("Returned by Isometric")).toBeNull();
    expect(screen.queryByRole("link", { name: "Open GHG Statement" })).toBeNull();
  });

  it("falls back to a plain sentence when the Removal needs resubmitting but no component is listed", () => {
    render(<RemovalResubmitNotice correction={correction({ resubmitNeeded: true, changed: [] })} facilityId={FACILITY} />);
    expect(screen.getByRole("status").textContent).toBe(
      "Entries changed since this Removal was sent. Resubmit it, then resubmit GHG Statement Jul 1 to Sep 30, 2026.",
    );
  });

  it.each([
    ["FAILED_VERIFICATION", "failed verification"],
    ["DRAFT", "is back in draft"],
  ] as const)("says the statement came back and where to correct the sent entries when nothing changed: %s", (status, phrase) => {
    render(<RemovalResubmitNotice correction={correction({ statement: { ...correction().statement, status } })} facilityId={FACILITY} />);
    const notice = screen.getByRole("status");
    expect(notice.textContent).toContain("Returned by Isometric");
    expect(notice.textContent).toContain(`GHG Statement Jul 1 to Sep 30, 2026 ${phrase}. Correct the sent entries on CB-26-001 and CB-26-002, then resubmit this Removal.`);
    expect(screen.getByRole("link", { name: "CB-26-002" }).getAttribute("href")).toBe("/credit-batches/batch-2?facility=facility-1&tab=emissions");
    expect(screen.getByRole("link", { name: "Open GHG Statement" }).getAttribute("href"))
      .toBe("/certification/ghg-statements?facility=facility-1&statement=statement-1");
  });
});

describe("ResubmitRemovalAction", () => {
  it("reopens the Removal in the New Removal wizard, only once something changed", () => {
    render(<ResubmitRemovalAction correction={correction({ resubmitNeeded: true, changed })} facilityId={FACILITY} />);
    expect(screen.getByRole("link", { name: "Resubmit Removal" }).getAttribute("href")).toBe("/certification/removals?facility=facility-1&resume=removal-1");
    cleanup();
    const nothing = render(<>
      <ResubmitRemovalAction correction={correction()} facilityId={FACILITY} />
      <ResubmitRemovalAction correction={undefined} facilityId={FACILITY} />
    </>);
    expect(nothing.container.textContent).toBe("");
  });
});
