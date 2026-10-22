// @vitest-environment jsdom
import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { CreditBatchLateEntries } from "./credit-batch-late-entries";

const lateEntryRows = vi.fn();
vi.mock("@/hooks/use-emission-entries", () => ({ useBatchEmissionLines: () => ({ data: [] }) }));
vi.mock("@/lib/certification/late-entry-list", () => ({ lateEntryRows: (...args: unknown[]) => lateEntryRows(...args) }));

const row = (id: string, code: string, removalId: string) => ({
  id, componentName: "Diesel use", occurredOn: "2026-09-14", total: { magnitude: "120", unit: "l" },
  view: {
    recordedAfter: { removalCode: code, removalHref: `/certification/removals?facility=f1&removal=${removalId}` },
    destination: { kind: "draft", removalCode: "RM-26-010", removalHref: "/x", creditBatches: [{ code: "CB-26-010", href: "/credit-batches/cb-10?facility=f1" }], anotherCreditBatch: true },
  },
});

describe("CreditBatchLateEntries", () => {
  it("renders nothing without late entries", () => {
    lateEntryRows.mockReturnValue([]);
    expect(render(<CreditBatchLateEntries facilityId="f1" creditBatchId="cb" />).container.innerHTML).toBe("");
  });

  it("links the Removal code in the heading", () => {
    lateEntryRows.mockReturnValue([row("a", "RM-26-009", "rm-9"), row("b", "RM-26-009", "rm-9")]);
    const { container } = render(<CreditBatchLateEntries facilityId="f1" creditBatchId="cb" />);
    expect(container.querySelector("h3")?.textContent).toContain("Recorded after RM-26-009 was sent");
    expect(screen.getAllByRole("link", { name: "RM-26-009" })).toHaveLength(1);
    expect(screen.getAllByRole("link", { name: "RM-26-009" })[0].getAttribute("href")).toBe("/certification/removals?facility=f1&removal=rm-9");
    expect(screen.getAllByRole("link", { name: "CB-26-010" })[0].getAttribute("href")).toBe("/credit-batches/cb-10?facility=f1");
  });
});
