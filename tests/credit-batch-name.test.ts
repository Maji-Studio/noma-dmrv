import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { activityEvents, creditBatches, facilities, feedstockTypes, productionProcesses } from "@/db/schema";
import { createCreditBatch, getCreditBatchById, updateCreditBatch } from "@/data-access/credit-batches";
import { ensureTestOrg, makeTestOrgContext, TEST_ORG_ID, TEST_SITE_POSITION } from "./helpers/test-org";

const TAG_LENGTH = 8;
const NAME = "September maize";

describe("credit batch name round trip", () => {
  const tag = crypto.randomUUID().slice(0, TAG_LENGTH).toUpperCase();
  const ctx = makeTestOrgContext("test-user-credit-batch-name");
  let facilityId = "";
  let feedstockTypeId = "";
  const batchIds: string[] = [];

  beforeAll(async () => {
    await ensureTestOrg();
    const [facility] = await db.insert(facilities).values({
      ...TEST_SITE_POSITION, organizationId: TEST_ORG_ID, timezone: "UTC", code: `FAC-NAME-${tag}`, name: `Name facility ${tag}`,
    }).returning({ id: facilities.id });
    facilityId = facility.id;
    const [feedstockType] = await db.insert(feedstockTypes).values({
      organizationId: TEST_ORG_ID, code: `FT-NAME-${tag}`, name: `Name feedstock ${tag}`, category: "forestry", usage: "pyrolysis",
    }).returning({ id: feedstockTypes.id });
    feedstockTypeId = feedstockType.id;
  });

  afterAll(async () => {
    for (const id of batchIds) await db.delete(creditBatches).where(eq(creditBatches.id, id));
    await db.delete(activityEvents).where(eq(activityEvents.facilityId, facilityId));
    await db.delete(productionProcesses).where(eq(productionProcesses.facilityId, facilityId));
    await db.delete(facilities).where(eq(facilities.id, facilityId));
    await db.delete(feedstockTypes).where(eq(feedstockTypes.id, feedstockTypeId));
  });

  async function create(code: string, name: string | null | undefined, month: string) {
    const saved = await createCreditBatch(ctx, {
      code, name, facilityId, feedstockTypeId,
      startDate: new Date(`2025-${month}-01T00:00:00.000Z`), endDate: new Date(`2025-${month}-28T00:00:00.000Z`),
      productionRunIds: [],
    });
    batchIds.push(saved.id);
    return saved;
  }

  it("saves a name on create and leaves the code untouched", async () => {
    const saved = await create(`CB-NAME-A-${tag}`, NAME, "01");
    const read = await getCreditBatchById(ctx, saved.id);
    expect(read).toMatchObject({ name: NAME, code: `CB-NAME-A-${tag}` });
  });

  it("stores no name as null", async () => {
    const saved = await create(`CB-NAME-B-${tag}`, undefined, "02");
    expect((await getCreditBatchById(ctx, saved.id))?.name).toBeNull();
  });

  it("renames, then clears the name back to null without touching the code", async () => {
    const saved = await create(`CB-NAME-C-${tag}`, null, "03");
    const renamed = await updateCreditBatch(ctx, saved.id, { expectedVersion: saved.version, name: NAME });
    expect((await getCreditBatchById(ctx, saved.id))).toMatchObject({ name: NAME, code: `CB-NAME-C-${tag}` });
    await updateCreditBatch(ctx, saved.id, { expectedVersion: renamed.version, name: null });
    expect((await getCreditBatchById(ctx, saved.id))?.name).toBeNull();
  });
});
