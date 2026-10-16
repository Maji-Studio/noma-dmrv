import { beforeEach, expect, it, vi } from "vitest";
import { makeTestOrgContext } from "../../tests/helpers/test-org";

const mocks = vi.hoisted(() => ({ select: vi.fn() }));
vi.mock("@/db", () => ({ db: { select: mocks.select } }));
vi.mock("@/lib/certification/emissions-entry-gate", () => ({
  requireEmissionsEntriesEnabled: vi.fn(() => {
    throw new Error("Writes disabled");
  }),
}));
import { listEmissionEntries } from "./emission-entries";

beforeEach(() => vi.clearAllMocks());

it("assembles multiple entries with three queries and no per-entry re-read", async () => {
  const entries = [{ id: "first" }, { id: "second" }, { id: "empty" }];
  const values = [
    { entryId: "second", inputKey: "b" },
    { entryId: "first", inputKey: "a" },
  ];
  const results = [entries, values, [{ entryId: "second", count: 2 }]];
  mocks.select.mockImplementation(() => {
    const rows = results.shift();
    const query = {
      from: vi.fn(() => query),
      where: vi.fn(() => query),
      orderBy: vi.fn(async () => rows),
      groupBy: vi.fn(async () => rows),
    };
    return query;
  });
  expect(await listEmissionEntries(makeTestOrgContext(), "batch")).toEqual([
    { id: "first", values: [values[1]], documentCount: 0 },
    { id: "second", values: [values[0]], documentCount: 2 },
    { id: "empty", values: [], documentCount: 0 },
  ]);
  expect(mocks.select).toHaveBeenCalledTimes(3);
});
