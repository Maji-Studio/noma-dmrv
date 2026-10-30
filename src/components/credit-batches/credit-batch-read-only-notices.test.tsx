// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { CreditBatchLateRunsNotice, CreditBatchMissingRunsNotice } from "./credit-batch-missing-runs-notice";
import { linesToDecideNoticeText } from "./credit-batch-removal-template";

vi.mock("next/link", () => ({ default: ({ href, children }: { href: string; children: React.ReactNode }) => <a href={href}>{children}</a> }));

afterEach(cleanup);

const LATE = { id: "run-1", code: "PR-1", title: "PR-1 was recorded after RM-1 was sent", titleAfterCode: " was recorded after RM-1 was sent", detail: "It is not in this credit batch.", instruction: "Record its diesel and power on the Emissions tab, dated Oct 1, 2026." };

describe("credit batch preview notices", () => {
  it("H5: a late run reads as a fact with the run link kept and no Open Emissions button", () => {
    render(<CreditBatchLateRunsNotice runs={[LATE]} creditBatchId="cb" facilityId="fac" readOnly />);
    expect(screen.getByText("It is not in this credit batch.")).toBeTruthy();
    expect(screen.queryByText(/Record its diesel/)).toBeNull();
    expect(screen.queryByRole("link", { name: "Open Emissions" })).toBeNull();
    expect(screen.getByRole("link", { name: "PR-1" })).toBeTruthy();
  });

  it("H5: editable late runs keep the instruction and the button", () => {
    render(<CreditBatchLateRunsNotice runs={[LATE]} creditBatchId="cb" facilityId="fac" />);
    expect(screen.getByText(/Record its diesel/)).toBeTruthy();
    expect(screen.getByRole("link", { name: "Open Emissions" })).toBeTruthy();
  });

  it("H5: missing runs state the fact with no next step or button when read only", () => {
    render(<CreditBatchMissingRunsNotice runs={[{ id: "run-2", code: "PR-2" }]} facilityId="fac" canManage={false} onEdit={vi.fn()} readOnly />);
    expect(screen.queryByText(/An admin can add/)).toBeNull();
    expect(screen.queryByRole("button", { name: "Add in Edit" })).toBeNull();
    expect(screen.getByRole("link", { name: "PR-2" })).toBeTruthy();
  });

  it("H8: components to decide read as the lead sentence alone when read only", () => {
    expect(linesToDecideNoticeText(2, false, false, true)).not.toMatch(/Admin/);
    expect(linesToDecideNoticeText(2, false)).toMatch(/Admin/);
  });
});
