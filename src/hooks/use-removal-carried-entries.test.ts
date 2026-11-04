import { beforeEach, expect, it, vi } from "vitest";
import { useRemovalCarriedEntries } from "./use-removal-carried-entries";
import { getRemovalCarriedEntriesFn } from "@/fn/certification/removal-carried-entries";
import type { RemovalCarriedEntries } from "@/data-access/removal-carried-entries";

const mocks = vi.hoisted(() => ({ query: vi.fn() }));
vi.mock("@tanstack/react-query", () => ({ useQuery: mocks.query }));
vi.mock("@/fn/certification/removal-carried-entries", () => ({ getRemovalCarriedEntriesFn: vi.fn() }));
vi.mock("./use-certification", () => ({ certificationKeys: { removalCarriedEntries: (id: string) => ["carried", id] } }));
beforeEach(() => vi.resetAllMocks());
const options = () => mocks.query.mock.calls[0][0] as { queryFn: () => Promise<RemovalCarriedEntries>; enabled: boolean };

it("exposes both carried and late entries from the action without mixing their lists", async () => {
  const result = { facilityId: "facility", carriedEntries: [], lateEntries: [{ entryId: "late", creditBatchId: "own", creditBatchCode: "CB-009",
    componentId: "diesel", occurredOn: "2026-09-14", value: { magnitude: "120", unit: "L" }, evidenceDocumentIds: [] }] };
  vi.mocked(getRemovalCarriedEntriesFn).mockResolvedValue({ success: true, data: result });
  useRemovalCarriedEntries("removal");
  expect(await options().queryFn()).toEqual(result);
  expect(getRemovalCarriedEntriesFn).toHaveBeenCalledExactlyOnceWith({ removalId: "removal" });
  expect(options().enabled).toBe(true);
});

it.each([null, "removal"])("keeps the query disabled without an open sheet (%s)", id => {
  useRemovalCarriedEntries(id, { enabled: false });
  expect(options().enabled).toBe(false);
});
