import { beforeEach, expect, it, vi } from "vitest";
import { makeTestOrgContext } from "../../tests/helpers/test-org";

vi.mock("./with-action", () => ({ withAction: async (callback: (ctx: ReturnType<typeof makeTestOrgContext>) => Promise<unknown>) =>
  ({ success: true, data: await callback(makeTestOrgContext()) }) }));
vi.mock("@/data-access/emission-entries", () => ({ restoreEmissionEntry: vi.fn(), replaceEmissionEntry: vi.fn() }));
vi.mock("@/lib/read-models/batch-emission-lines", () => ({ loadBatchEmissionLines: vi.fn() }));
vi.mock("@/lib/read-models/facility-emissions-overview", () => ({ loadFacilityEmissionsOverview: vi.fn() }));
import { restoreEmissionEntry, replaceEmissionEntry } from "@/data-access/emission-entries";
import { restoreEmissionEntryFn, replaceEmissionEntryFn } from "./emission-entries";

const input = { id: "00000000-0000-4000-8000-000000000001", expectedVersion: 2 };
beforeEach(() => vi.clearAllMocks());

it("validates the restore input and passes the server's organization context", async () => {
  vi.mocked(restoreEmissionEntry).mockResolvedValue({ id: input.id, version: 3, deletedAt: null } as never);
  expect(await restoreEmissionEntryFn(input)).toMatchObject({ success: true, data: { id: input.id, version: 3 } });
  expect(restoreEmissionEntry).toHaveBeenCalledExactlyOnceWith(makeTestOrgContext(), input);
});

it.each([{ ...input, expectedVersion: 0 }, { ...input, expectedVersion: 1.5 }, { ...input, id: "missing" }])(
  "refuses malformed restore input before data access: %j", async invalid => {
    await expect(restoreEmissionEntryFn(invalid)).rejects.toThrow();
    expect(restoreEmissionEntry).not.toHaveBeenCalled();
  },
);

const replacement = { ...input, values: [{ inputKey: "electricity_use", quantityKind: "energy" as const, magnitude: "1", unit: "kWh" }] };
it("validates replacement and uses only the server's org context and original owner", async () => {
  vi.mocked(replaceEmissionEntry).mockResolvedValue({ id: "new-entry", version: 1 } as never);
  expect(await replaceEmissionEntryFn({ ...replacement, organizationId: "foreign", creditBatchId: "other", componentId: "other" } as typeof replacement))
    .toMatchObject({ success: true, data: { id: "new-entry", version: 1 } });
  expect(replaceEmissionEntry).toHaveBeenCalledExactlyOnceWith(makeTestOrgContext(), replacement);
});
it.each([{ ...replacement, expectedVersion: 0 }, { ...replacement, id: "invalid" },
  { ...replacement, values: [] }, { ...replacement, occurredOn: "2026-02-30" }])(
  "refuses malformed replacement input before data access: %j", async invalid => {
    await expect(replaceEmissionEntryFn(invalid)).rejects.toThrow();
    expect(replaceEmissionEntry).not.toHaveBeenCalled();
  },
);
