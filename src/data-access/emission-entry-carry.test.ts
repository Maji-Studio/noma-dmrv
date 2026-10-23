import { beforeEach, expect, it, vi } from "vitest";
import { makeTestOrgContext } from "../../tests/helpers/test-org";

const mocks = vi.hoisted(() => ({ select: vi.fn(), where: vi.fn(), contenders: vi.fn(), rollups: vi.fn(), registry: vi.fn() }));
vi.mock("@/db", () => ({ db: { select: mocks.select } }));
vi.mock("./emission-entry-contenders", () => ({ listEmissionEntryDraftContenders: mocks.contenders, loadEmissionEntryReservations: vi.fn() }));
vi.mock("./credit-batch-accounting", () => ({ loadCreditBatchRollups: mocks.rollups }));
vi.mock("@/lib/isometric/ghg-statements", () => ({ getGhgStatement: mocks.registry }));
import { loadBatchEmissionEntryCarry, loadFacilityEmissionEntryCarry } from "./emission-entry-carry";

beforeEach(() => {
  vi.clearAllMocks();
  const query = { from: vi.fn(), innerJoin: vi.fn(), where: mocks.where };
  query.from.mockReturnValue(query);
  query.innerJoin.mockReturnValue(query);
  mocks.select.mockReturnValue(query);
  mocks.where.mockImplementation(() => ({ orderBy: async () => [] }));
});

it("stops facility discovery after one narrow query when no candidates exist", async () => {
  mocks.where.mockReturnValueOnce({ orderBy: async () => [] });
  expect((await loadFacilityEmissionEntryCarry(makeTestOrgContext(), "facility")).entries).toEqual([]);
  expect(mocks.select).toHaveBeenCalledTimes(1);
  expect(mocks.contenders).not.toHaveBeenCalled();
  expect(mocks.rollups).not.toHaveBeenCalled();
  expect(mocks.registry).not.toHaveBeenCalled();
});

it("a batch display read with no candidates or retained owners does not load contenders or registry facts", async () => {
  mocks.where.mockResolvedValueOnce([{ facilityId: "facility" }]).mockReturnValueOnce({ orderBy: async () => [] }).mockReturnValueOnce({ orderBy: async () => [] });
  expect(await loadBatchEmissionEntryCarry(makeTestOrgContext(), ["batch"])).toEqual([]);
  // Facility identity, candidate entries, and scoped retained ownership only.
  expect(mocks.select).toHaveBeenCalledTimes(3);
  expect(mocks.contenders).not.toHaveBeenCalled();
  expect(mocks.rollups).not.toHaveBeenCalled();
  expect(mocks.registry).not.toHaveBeenCalled();
});


it("a per-Removal ownership read skips facility candidate discovery entirely", async () => {
  mocks.where.mockReturnValueOnce({ orderBy: async () => [] });
  expect((await loadFacilityEmissionEntryCarry(makeTestOrgContext(), "facility", undefined, undefined,
    { ownedRemovalId: "removal" }, true)).entries).toEqual([]);
  expect(mocks.select).toHaveBeenCalledTimes(1);
  expect(mocks.rollups).not.toHaveBeenCalled();
  expect(mocks.contenders).not.toHaveBeenCalled();
  expect(mocks.registry).not.toHaveBeenCalled();
});
