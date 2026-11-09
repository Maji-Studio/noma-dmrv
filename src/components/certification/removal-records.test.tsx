// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { RemovalBatchRecords, RemovalRecord } from "@/lib/certification/removal-records";
import { RECORDS_SHOWN_FIRST, RemovalRecords, RemovalRecordsList } from "./removal-records";

const mocks = vi.hoisted(() => ({ query: {} as Record<string, unknown>, refetch: vi.fn() }));
vi.mock("@/hooks/use-removal-records", () => ({ useRemovalRecords: () => mocks.query }));
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
    const runs = screen.getByRole("heading", { name: "Production runs" }).parentElement!;
    expect(within(runs).getAllByRole("listitem")).toHaveLength(RECORDS_SHOWN_FIRST);
    expect(within(runs).getByRole("button", { name: /Show all 5/ })).toBeTruthy();
    const apps = screen.getByRole("heading", { name: "Applications" }).parentElement!;
    expect(within(apps).getAllByRole("listitem")).toHaveLength(RECORDS_SHOWN_FIRST);
    expect(within(apps).queryByRole("button")).toBeNull();
  });

  it("opens the rest in place and moves focus to the first newly shown record", () => {
    render(<RemovalRecordsList batches={[batch(5, 0)]} facilityId="f1" />);
    open();
    fireEvent.click(screen.getByRole("button", { name: /Show all 5/ }));
    const runs = screen.getByRole("heading", { name: "Production runs" }).parentElement!;
    expect(within(runs).getAllByRole("listitem")).toHaveLength(5);
    expect(document.activeElement).toBe(within(runs).getByRole("link", { name: "PR-4" }));
    expect(within(runs).queryByRole("button")).toBeNull();
  });

  it("names a record by date, place and mass with the code last as a link", () => {
    render(<RemovalRecordsList batches={[batch(1, 0)]} facilityId="f1" />);
    open();
    const line = screen.getByRole("link", { name: "PR-1" }).closest("li")!;
    expect(line.textContent).toMatch(/^Feb 1 · Reactor 1 · 3\.2.t.dry.biochar.*PR-1$/);
  });
});

describe("batch row and links", () => {
  it("summarises the batch's dry biochar and opens record codes in the same tab", () => {
    render(<RemovalRecordsList batches={[batch(1, 2), { ...batch(1, 0), creditBatchId: "cb-2", code: "CB-26-002" }]} facilityId="f1" />);
    expect(screen.getByRole("button", { name: /Records of CB-26-001/ }).textContent).toMatch(/6\.4.t.dry/);
    open();
    const code = screen.getByRole("link", { name: "PR-1" });
    expect(code.getAttribute("target")).toBeNull();
    expect(code.className).toContain("min-h-44");
    expect(code.className).toContain("font-mono");
    expect(screen.getByRole("link", { name: "CB-26-001" }).className).toContain("min-h-44");
    expect(screen.getByRole("heading", { name: "Production runs" })).toBeTruthy();
  });
});

describe("a lone credit batch", () => {
  it("shows no dates or dry mass beside its code, since the Removal already says them", () => {
    render(<RemovalRecordsList batches={[batch(1, 2)]} facilityId="f1" />);
    expect(screen.getByRole("button", { name: /Records of CB-26-001/ }).textContent).not.toMatch(/dry/);
  });
});

describe("RemovalRecords states", () => {
  it("shows a loading skeleton, not text", () => {
    mocks.query = { isLoading: true };
    render(<RemovalRecords removalId="r" facilityId="f1" enabled />);
    expect(screen.getByLabelText("Loading records").getAttribute("aria-busy")).toBe("true");
  });

  it("offers Try again on a failed read, which refetches", () => {
    mocks.query = { isLoading: false, isError: true, isFetching: false, refetch: mocks.refetch };
    render(<RemovalRecords removalId="r" facilityId="f1" enabled />);
    expect(screen.getByRole("alert").textContent).toContain("could not be loaded");
    fireEvent.click(screen.getByRole("button", { name: "Try again" }));
    expect(mocks.refetch).toHaveBeenCalledTimes(1);
  });

  it("uses one EmptyState when there are no credit batches", () => {
    mocks.query = { isLoading: false, isError: false, data: [] };
    render(<RemovalRecords removalId="r" facilityId="f1" enabled />);
    expect(screen.getAllByRole("heading", { name: "No credit batches yet" })).toHaveLength(1);
    expect(document.body.textContent).not.toMatch(/none/i);
  });
});

describe("RemovalRecordsList link modes", () => {
  it("keeps the sheet's links in the same tab by default, with no external-link icon", () => {
    const { container } = render(<RemovalRecordsList batches={[batch(1, 0)]} facilityId="f1" />);
    open();
    expect(container.querySelectorAll("svg[aria-hidden]").length).toBe(1); // the batch caret only
    for (const link of screen.getAllByRole("link")) {
      expect(link.getAttribute("target")).toBeNull();
    }
  });

  it("opens the batch and record links in a new tab and reports the press when asked", () => {
    const onOpen = vi.fn();
    render(<RemovalRecordsList batches={[batch(1, 0)]} facilityId="f1" mode={{ newTab: true, onOpen }} />);
    open();
    const links = screen.getAllByRole("link");
    expect(links).toHaveLength(2);
    // Each link carries the external-link icon, as the step's other new-tab links do.
    for (const link of links) expect(link.querySelector("svg")).toBeTruthy();
    for (const link of links) {
      expect(link.getAttribute("target")).toBe("_blank");
      expect(link.getAttribute("rel")).toBe("noopener noreferrer");
      fireEvent.click(link);
    }
    expect(onOpen).toHaveBeenCalledTimes(2);
  });
});

describe("RemovalRecordsList summary", () => {
  const two = [batch(1, 2), { ...batch(1, 2), creditBatchId: "cb-2", code: "CB-26-002" }];

  it("shows each batch's dates and dry mass for two batches", () => {
    render(<RemovalRecordsList batches={two} facilityId="f1" />);
    expect(screen.getAllByText(/ dry$/).length).toBeGreaterThan(0);
  });

  it("leaves them out when the host already names them, keeping the batch button named", () => {
    render(<RemovalRecordsList batches={two} facilityId="f1" showSummary={false} />);
    expect(screen.queryByText(/ dry$/)).toBeNull();
    expect(screen.getByRole("button", { name: /Records of CB-26-002/ })).toBeTruthy();
  });
});
