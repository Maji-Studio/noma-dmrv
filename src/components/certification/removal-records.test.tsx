// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { RemovalBatchRecords, RemovalRecord } from "@/lib/certification/removal-records";
import { RECORDS_SHOWN_FIRST, RemovalRecordsList } from "./removal-records";

vi.mock("next/link", () => ({ default: ({ children, ...props }: React.ComponentProps<"a">) => <a {...props}>{children}</a> }));
afterEach(cleanup);

function records(count: number, kind: RemovalRecord["kind"], prefix: string): RemovalRecord[] {
  return Array.from({ length: count }, (_, i) => ({
    id: `${prefix}-${i + 1}`,
    code: `${prefix.toUpperCase()}-${i + 1}`,
    kind,
    date: `2026-02-${String(i + 1).padStart(2, "0")}`,
    place: "Reactor 1",
    massKg: 3200,
    basis: "dry" as const,
  }));
}

function batch(runs: number, apps: number): RemovalBatchRecords {
  return {
    creditBatchId: "cb-1",
    code: "CB-26-001",
    startDate: "2026-02-01",
    endDate: "2026-03-01",
    productionRuns: records(runs, "productionRun", "pr"),
    applications: records(apps, "application", "ap"),
    deliveries: [],
    feedstock: [],
  };
}

function open() {
  fireEvent.click(screen.getByRole("button", { name: /Records of CB-26-001/ }));
}

describe("RemovalRecordsList", () => {
  it("keeps each credit batch closed until opened, with its code linking to the credit batch", () => {
    render(<RemovalRecordsList batches={[batch(5, 2)]} facilityId="f1" />);
    expect(screen.queryByText("Production runs")).toBeNull();
    expect(screen.getByRole("link", { name: "CB-26-001" }).getAttribute("href")).toContain("/credit-batches/cb-1");
    open();
    expect(screen.getByText("Production runs")).toBeTruthy();
  });

  it("shows the first three by date and offers Show all N for a longer group only", () => {
    render(<RemovalRecordsList batches={[batch(5, RECORDS_SHOWN_FIRST)]} facilityId="f1" />);
    open();
    const runs = screen.getByText("Production runs").parentElement!;
    expect(within(runs).getAllByRole("listitem")).toHaveLength(RECORDS_SHOWN_FIRST);
    expect(within(runs).getByRole("button", { name: /Show all 5/ })).toBeTruthy();
    const apps = screen.getByText("Applications").parentElement!;
    expect(within(apps).getAllByRole("listitem")).toHaveLength(RECORDS_SHOWN_FIRST);
    expect(within(apps).queryByRole("button")).toBeNull();
  });

  it("opens the rest in place and moves focus to the first newly shown record", () => {
    render(<RemovalRecordsList batches={[batch(5, 0)]} facilityId="f1" />);
    open();
    fireEvent.click(screen.getByRole("button", { name: /Show all 5/ }));
    const runs = screen.getByText("Production runs").parentElement!;
    expect(within(runs).getAllByRole("listitem")).toHaveLength(5);
    expect(document.activeElement).toBe(within(runs).getByRole("link", { name: "PR-4" }));
    expect(within(runs).queryByRole("button")).toBeNull();
  });

  it("names a record by date, place and mass with the code last as a link", () => {
    render(<RemovalRecordsList batches={[batch(1, 0)]} facilityId="f1" />);
    open();
    const line = screen.getByRole("link", { name: "PR-1" }).closest("li")!;
    expect(line.textContent).toMatch(/Feb 1, 2026 · Reactor 1 · 3\.2.t.dry.*PR-1$/);
  });
});
