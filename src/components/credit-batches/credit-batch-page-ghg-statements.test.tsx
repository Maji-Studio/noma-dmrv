// @vitest-environment jsdom
/** The GHG Statement panel lists every statement of a split credit batch, newest period first (#1655). */
import { cleanup, render, screen, within } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { CreditBatchPageModel } from "@/data-access/credit-batch-page-model";
import { CreditBatchPageProvider, type CreditBatchPageContextValue } from "./credit-batch-page-context";
import { GhgStatementPanel } from "./credit-batch-page-removals";

vi.mock("next/link", () => ({ default: ({ href, children, className }: { href: string; children: ReactNode; className?: string }) => <a href={href} className={className}>{children}</a> }));

const BATCH = { id: "batch-1", facilityId: "facility-1" };

function statement(id: string, start: string, end: string, dryKg: number, label: string) {
  return {
    id,
    reportingPeriodStartOn: start,
    reportingPeriodEndOn: end,
    hasMissingPeriod: false,
    status: { value: "draft", label, kind: "draft" },
    submittedToVerifierAt: null,
    creditsIssuedAt: null,
    dryKg,
  };
}

function mount(statements: ReturnType<typeof statement>[]) {
  const model = { milestones: { ghgStatements: statements } } as unknown as CreditBatchPageModel;
  render(
    <CreditBatchPageProvider value={{ batch: BATCH } as unknown as CreditBatchPageContextValue}>
      <GhgStatementPanel model={model} />
    </CreditBatchPageProvider>,
  );
}

afterEach(cleanup);

describe("GhgStatementPanel", () => {
  it("lists two statements in order with their tonnes and badges, under a plural title", () => {
    mount([
      statement("s2", "2026-07-01", "2026-09-30", 2000, "Submitted"),
      statement("s1", "2026-04-01", "2026-06-30", 500, "Draft"),
    ]);
    expect(screen.getByText("GHG Statements")).toBeTruthy();
    const rows = screen.getAllByRole("listitem");
    expect(rows).toHaveLength(2);
    expect(rows[0].textContent).toContain("GHG Statement Jul 1 to Sep 30, 2026 · 2.00 t");
    expect(within(rows[0]).getByText("Submitted")).toBeTruthy();
    expect(rows[1].textContent).toContain("GHG Statement Apr 1 to Jun 30, 2026 · 0.50 t");
    expect(within(rows[1]).getByText("Draft")).toBeTruthy();
    expect(within(rows[0]).getByRole("link").getAttribute("href")).toContain("s2");
  });

  it("uses the singular title for one statement", () => {
    mount([statement("s1", "2026-07-01", "2026-09-30", 2000, "Draft")]);
    expect(screen.getByText("GHG Statement")).toBeTruthy();
    expect(screen.queryByText("GHG Statements")).toBeNull();
  });
});
