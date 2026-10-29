// @vitest-environment jsdom
/**
 * The Production tab of a batch in an archived facility lists its members from
 * the linked read, and leaves the form-option read idle (#1502).
 */
import { cleanup, render, screen } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { CreditBatchPageProvider, type CreditBatchPageContextValue } from "./credit-batch-page-context";
import { CreditBatchProductionTab } from "./credit-batch-page-tabs";

const harness = vi.hoisted(() => ({
  optionParams: [] as Array<{ facilityId?: string }>,
  linkedEnabled: [] as boolean[],
}));
const RUN = { id: "run-1", code: "PR-26-001", date: "2026-09-02", biocharStorageName: "Bin A", feedstockMassDryKg: 1000, biocharDryMassKg: 200, feedstockTypeIds: [], status: "completed" };

vi.mock("next/link", () => ({ default: ({ href, children }: { href: string; children: ReactNode }) => <a href={href}>{children}</a> }));
vi.mock("@/components/activity", () => ({ CreditBatchActivityView: () => null }));
vi.mock("./credit-batch-durability-panel", () => ({ CreditBatchDurabilityPanel: () => null }));
vi.mock("@/hooks/use-credit-batches", () => ({
  useCreditBatchProductionRunOptions: (params: { facilityId?: string }) => {
    harness.optionParams.push(params);
    return { data: [], isLoading: false, error: null, isFetching: false, refetch: vi.fn() };
  },
}));
vi.mock("@/hooks/use-linked-credit-batch-members", () => ({
  useLinkedCreditBatchMembers: (_id: string, enabled: boolean) => {
    harness.linkedEnabled.push(enabled);
    return { data: enabled ? [RUN] : undefined, isLoading: false, error: null, isFetching: false, refetch: vi.fn() };
  },
}));

const BATCH = { id: "batch-1", facilityId: "facility-1", startDate: "2026-09-01", endDate: "2026-09-30", productionRunIds: ["run-1"], productionRunCount: 1 };

function mount(extra: Partial<CreditBatchPageContextValue>) {
  render(
    <CreditBatchPageProvider value={{ batch: BATCH, ...extra } as CreditBatchPageContextValue}>
      <CreditBatchProductionTab />
    </CreditBatchPageProvider>,
  );
}

afterEach(() => {
  cleanup();
  harness.optionParams = [];
  harness.linkedEnabled = [];
});

describe("credit batch Production tab", () => {
  it("lists the members of a batch in an archived facility from the linked read", () => {
    mount({ facilityTimeZone: "Africa/Dar_es_Salaam" });
    expect(screen.getByText("PR-26-001")).toBeTruthy();
    expect(harness.linkedEnabled.every(Boolean)).toBe(true);
    expect(harness.optionParams.every((params) => params.facilityId === undefined)).toBe(true);
  });

  it("keeps the linked read idle for a batch that is not archived", () => {
    mount({});
    expect(screen.queryByText("PR-26-001")).toBeNull();
    expect(harness.linkedEnabled.every((enabled) => !enabled)).toBe(true);
    expect(harness.optionParams.every((params) => params.facilityId === "facility-1")).toBe(true);
  });
});
