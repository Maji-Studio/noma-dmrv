// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { RecordLockView } from "@/lib/record-lock-view";
import type { RecordUsedByBatch, RecordUsedByChain } from "@/lib/record-used-by-chain";
import { RecordUsedBy, USED_BY_CHAIN_ERROR_MESSAGE } from "./record-used-by";
import { traceabilityHref, withUnmatchedUsers } from "./record-used-by-graph";

type ChainResult = { data: unknown; isError: boolean; isPending: boolean; isFetching: boolean; refetch: () => unknown };
const chainRead = vi.hoisted(() => ({ result: {} as ChainResult }));
vi.mock("@/hooks/use-record-used-by-chain", () => ({ useRecordUsedByChain: () => chainRead.result }));
vi.mock("@/hooks/use-facility-context", () => ({ useFacilityClock: () => ({ timeZone: "UTC", hint: "" }) }));

afterEach(cleanup);

const LOCK: RecordLockView = { level: "open", heldBy: [], usedBy: [], freeFields: ["code"], howToFree: null, returnedBy: [] };

describe("Used by when the forced chain read fails", () => {
  it("shows a warning Notice with Try again bound to refetch, and no None", () => {
    const refetch = vi.fn();
    chainRead.result = { data: undefined, isError: true, isPending: false, isFetching: false, refetch };
    render(<RecordUsedBy lock={LOCK} record={{ kind: "productionRun", id: "run-1" }} readsChain holdsNone />);
    const notice = screen.getByRole("status");
    expect(notice.textContent).toContain(USED_BY_CHAIN_ERROR_MESSAGE);
    expect(screen.queryByText("None")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Try again" }));
    expect(refetch).toHaveBeenCalledTimes(1);
  });
});

const SELF = { kind: "productionRun", id: "run-1", code: "PR-1", name: null, facilityId: "f1", at: null, calendarDay: true } as const;
const batch = (id: string, dependency?: "production-emissions"): RecordUsedByBatch => ({
  id, code: id, name: null, facilityId: "f1", startDate: "2026-01-01", endDate: "2026-01-31", ...(dependency ? { dependency } : {}),
});
const graphOf = (creditBatches: RecordUsedByBatch[]) => {
  const chain: RecordUsedByChain = { self: SELF, downstream: [], edges: [], creditBatches };
  return withUnmatchedUsers(chain, []);
};

describe("traceabilityHref", () => {
  it("returns null when only emissions-only batches hold the record", () => {
    expect(traceabilityHref(graphOf([batch("cb-e", "production-emissions")]))).toBeNull();
  });

  it("picks the material batch when both exist", () => {
    const href = traceabilityHref(graphOf([batch("cb-e", "production-emissions"), batch("cb-m")]));
    expect(href).toContain("cb-m");
    expect(href).not.toContain("cb-e");
  });
});
