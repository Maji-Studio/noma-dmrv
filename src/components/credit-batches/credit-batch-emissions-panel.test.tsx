// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";

const query = vi.hoisted(() => ({ data: undefined as unknown, isLoading: false, error: null as Error | null }));
vi.mock("@/hooks/use-batch-emission-lines", () => ({
  useBatchEmissionLines: () => ({ ...query, refetch: vi.fn(), isRefetching: false }),
}));
vi.mock("next/link", () => ({ default: ({ href, children, ...rest }: { href: string; children: React.ReactNode }) => <a href={href} {...rest}>{children}</a> }));
vi.mock("@/components/forms/section-label", () => ({ SectionLabel: ({ children }: { children: React.ReactNode }) => <h3>{children}</h3> }));

import { CreditBatchEmissionsPanel } from "./credit-batch-emissions-panel";

const line = (componentId: string, label: string, state: string) => ({ componentId, label, state });
const render_ = (enabled = true) => render(<CreditBatchEmissionsPanel creditBatchId="cb-1" facilityId="f-1" enabled={enabled} />);

beforeEach(() => { query.data = undefined; query.isLoading = false; query.error = null; });
afterEach(cleanup);

describe("CreditBatchEmissionsPanel", () => {
  it("renders nothing when the gate is off", () => {
    query.data = [line("a", "Diesel", "empty")];
    const { container } = render_(false);
    expect(container.firstChild).toBeNull();
  });

  it("lists only open lines with their state and links to the batch", () => {
    query.data = [line("a", "Diesel", "empty"), line("b", "Grid", "filled"), line("c", "Lab", "missingEvidence"), line("d", "Zero", "confirmedZero")];
    render_();
    expect(screen.getByText("Diesel")).toBeTruthy();
    expect(screen.getByText("Not recorded")).toBeTruthy();
    expect(screen.getByText("Lab")).toBeTruthy();
    expect(screen.getByText("File missing")).toBeTruthy();
    expect(screen.queryByText("Grid")).toBeNull();
    expect(screen.queryByText("Zero")).toBeNull();
    expect(screen.getByRole("link", { name: /Open emissions/ }).getAttribute("href")).toBe("/emissions/cb-1");
  });

  it("states that all lines are recorded and keeps the link", () => {
    query.data = [line("b", "Grid", "filled")];
    render_();
    expect(screen.getByText("All lines recorded")).toBeTruthy();
    expect(screen.getByRole("link", { name: /Open emissions/ }).getAttribute("href")).toBe("/emissions/cb-1");
  });
});
