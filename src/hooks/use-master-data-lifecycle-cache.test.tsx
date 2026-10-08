import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, create, type ReactTestRenderer } from "react-test-renderer";
import { describe, expect, it, vi } from "vitest";

// Only key constants are needed; keep unrelated server actions out of these unit tests.
vi.mock("./use-certification", () => ({ certificationKeys: { all: ["certification"] } }));

vi.mock("./use-output-stock", () => ({ outputStockKeys: { all: ["outputStock"] } }));

const mocks = vi.hoisted(() => ({ save: vi.fn() }));
vi.mock("@/fn/facilities", () => ({ archiveFacilityFn: mocks.save, restoreFacilityFn: mocks.save }));
vi.mock("@/fn/storage-locations", () => ({ archiveStorageLocationFn: mocks.save, restoreStorageLocationFn: mocks.save }));
vi.mock("@/fn/feedstock-types", () => ({ archiveFeedstockTypeFn: mocks.save, unarchiveFeedstockTypeFn: mocks.save }));
vi.mock("@/fn/energy", () => ({ saveFacilityEmissionFactors: mocks.save }));

import { facilityKeys, useArchiveFacility, useRestoreFacility } from "./use-facilities";
import { storageLocationKeys, useArchiveStorageLocation, useRestoreStorageLocation } from "./use-storage-locations";
import { useArchiveFeedstockType, useUnarchiveFeedstockType } from "./use-feedstock-types";
import { energyKeys, useSaveFacilityEmissionFactors } from "./use-energy";

const ID = "33333333-3333-4333-8333-333333333333";
const VERSION = 3;
const saved = { id: ID, version: VERSION + 1, facilityId: ID };
const cases = [
  { name: "archive facility", useWrite: useArchiveFacility, key: facilityKeys.lists(), input: { facilityId: ID, expectedVersion: VERSION }, shape: "page" },
  { name: "restore facility", useWrite: useRestoreFacility, key: facilityKeys.lists(), input: { facilityId: ID, expectedVersion: VERSION }, shape: "page" },
  { name: "archive bin", useWrite: useArchiveStorageLocation, key: storageLocationKeys.lists(), input: { storageLocationId: ID, expectedVersion: VERSION }, shape: "page" },
  { name: "restore bin", useWrite: useRestoreStorageLocation, key: storageLocationKeys.lists(), input: { storageLocationId: ID, expectedVersion: VERSION }, shape: "page" },
  { name: "archive feedstock type", useWrite: useArchiveFeedstockType, key: ["feedstock-types", "list"], input: { feedstockTypeId: ID, expectedVersion: VERSION }, shape: "array" },
  { name: "restore feedstock type", useWrite: useUnarchiveFeedstockType, key: ["feedstock-types", "list"], input: { feedstockTypeId: ID, expectedVersion: VERSION }, shape: "array" },
  { name: "save emission factors", useWrite: useSaveFacilityEmissionFactors, key: energyKeys.emissionFactors(ID), input: { facilityId: ID, expectedVersion: VERSION }, shape: "factors" },
];

describe.each(cases)("$name", ({ useWrite, key, input, shape }) => {
  it("installs the saved version before invalidating queries", async () => {
    const client = new QueryClient();
    const envelope = (row: { id: string; version: number }) => shape === "page"
      ? { items: [row], total: 1 }
      : shape === "array" ? [row] : { factors: row, viewerCanManage: true };
    client.setQueryData(key, envelope({ id: ID, version: VERSION }));
    mocks.save.mockResolvedValue({ success: true, data: saved });
    vi.spyOn(client, "invalidateQueries").mockImplementation(async () => {
      expect(client.getQueryData(key)).toEqual(envelope(saved));
    });
    function Harness() {
      const mutation = useWrite();
      return <button onClick={() => (mutation.mutateAsync as (value: typeof input) => Promise<unknown>)(input)}>Save</button>;
    }
    let renderer!: ReactTestRenderer;
    await act(async () => { renderer = create(<QueryClientProvider client={client}><Harness /></QueryClientProvider>); });
    try {
      await act(async () => { await renderer.root.findByType("button").props.onClick(); });
      expect(client.getQueryData(key)).toEqual(envelope(saved));
      expect(mocks.save).toHaveBeenLastCalledWith(input);
    } finally { act(() => renderer.unmount()); client.clear(); }
  });
});
