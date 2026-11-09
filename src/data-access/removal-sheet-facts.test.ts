import { beforeEach, expect, it, vi } from "vitest";
import { loadRemovalSheetFacts } from "./removal-sheet-facts";
import { getCreditBatchesByRemovalId } from "./certifier-removals";
import { loadCreditBatchAccounting } from "./credit-batch-accounting";
import { makeTestOrgContext } from "../../tests/helpers/test-org";

const mocks = vi.hoisted(() => ({ select: vi.fn() }));
vi.mock("@/db", () => ({ db: { select: mocks.select } }));
vi.mock("./certifier-removals", () => ({ getCreditBatchesByRemovalId: vi.fn() }));
vi.mock("./credit-batch-accounting", () => ({ loadCreditBatchAccounting: vi.fn() }));

const ctx = makeTestOrgContext();
const batch = (id: string) => ({ id, code: id, facilityId: "facility", durabilityOption: "1000_year", sampling: "sampled" });
const accounting = (wet: number, dry: (number | null)[]) => ({
  appliedWeightTons: wet,
  co2ePreview: { co2eStoredTonnes: 1 },
  lineageFacts: { applications: dry.map((biocharAppliedDryTons) => ({ biocharAppliedDryTons })) },
});

beforeEach(() => {
  vi.resetAllMocks();
  mocks.select.mockReturnValue({ from: () => ({ where: () => ({ limit: async () => [{ name: "Plant" }] }) }) });
});

it("reports the dry application tonnes, not the wet ones", async () => {
  vi.mocked(getCreditBatchesByRemovalId).mockResolvedValue([batch("CB-1")] as never);
  vi.mocked(loadCreditBatchAccounting).mockResolvedValue({ "CB-1": accounting(2, [0.6, 0.4]) } as never);
  expect((await loadRemovalSheetFacts(ctx, "removal")).dryTonnes).toBeCloseTo(1);
});

it("has no dry mass when an application lacks one or there are no batches", async () => {
  vi.mocked(getCreditBatchesByRemovalId).mockResolvedValue([batch("CB-1")] as never);
  vi.mocked(loadCreditBatchAccounting).mockResolvedValue({ "CB-1": accounting(2, [0.6, null]) } as never);
  expect((await loadRemovalSheetFacts(ctx, "removal")).dryTonnes).toBeNull();
  vi.mocked(getCreditBatchesByRemovalId).mockResolvedValue([]);
  vi.mocked(loadCreditBatchAccounting).mockResolvedValue({});
  expect((await loadRemovalSheetFacts(ctx, "removal")).dryTonnes).toBeNull();
});
