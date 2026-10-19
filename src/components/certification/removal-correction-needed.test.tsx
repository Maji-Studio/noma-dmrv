// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import type { RecordLockView } from "@/lib/record-lock-view";
import { RemovalCorrectionCell, RemovalCorrectionNotice } from "./removal-correction-needed";

afterEach(cleanup);

const FACILITY = "facility-1";
const returned = (level: RecordLockView["level"], status = "FAILED_VERIFICATION"): RecordLockView => ({
  level, heldBy: [], usedBy: [], freeFields: [], howToFree: null,
  returnedBy: [{
    removal: { kind: "removal", id: "removal-1", label: null, facilityId: FACILITY, period: { startedOn: "2026-07-01", completedOn: "2026-09-30" } },
    statement: { kind: "ghgStatement", id: "statement-1", label: null, facilityId: FACILITY, period: { startedOn: "2026-07-01", completedOn: "2026-09-30" } },
    statementStatus: status,
  }],
});
const STATEMENT_HREF = `/certification/ghg-statements?facility=${FACILITY}&statement=statement-1`;

describe("Removal correction needed", () => {
  it("marks a returned Removal's row and points to the GHG Statement that resubmits it", () => {
    render(<RemovalCorrectionCell lock={returned("open")} />);
    expect(screen.getByText("Correction needed")).toBeTruthy();
    expect(screen.getByText("GHG Statement Jul 1 to Sep 30, 2026 failed verification. Correct this Removal's records, then resubmit.")).toBeTruthy();
    expect(screen.getByRole("link", { name: "Open GHG Statement" }).getAttribute("href")).toBe(STATEMENT_HREF);
  });

  it("says the same on the sheet, naming where resubmission happens", () => {
    render(<RemovalCorrectionNotice lock={returned("open", "DRAFT")} />);
    expect(screen.getByRole("status").textContent).toContain(
      "GHG Statement Jul 1 to Sep 30, 2026 is back in draft. Correct this Removal's records, then resubmit from the GHG Statement.",
    );
    expect(screen.getByRole("link", { name: "Open GHG Statement" }).getAttribute("href")).toBe(STATEMENT_HREF);
  });

  it("shows nothing while Sent, unreturned or unknown", () => {
    const { container } = render(<>
      <RemovalCorrectionCell lock={{ ...returned("sent") }} />
      <RemovalCorrectionNotice lock={{ ...returned("open"), returnedBy: [] }} />
      <RemovalCorrectionCell lock={undefined} />
    </>);
    expect(container.textContent).toBe("");
  });
});
