import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { creditBatches, facilities, feedstockTypes, organizations, productionProcesses } from "@/db/schema";
import { CREDIT_BATCH_CODE_PREFIX } from "@/config/credit-batches";
import { getNextCreditBatchCode } from "@/data-access/credit-batches";
import type { OrgContext } from "@/lib/auth/server";
import { makeTestOrgContext, TEST_SITE_POSITION } from "./helpers/test-org";

type FacilityFixture = {
  ctx: OrgContext;
  facilityId: string;
  feedstockTypeId: string;
  productionProcessId: string;
};

let organizationIds: string[];
let site: FacilityFixture;
let codePrefix: string;

async function createOrganization(): Promise<OrgContext> {
  const organizationId = `next-code-${crypto.randomUUID()}`;
  await db.insert(organizations).values({ id: organizationId, name: "Next code", slug: organizationId });
  organizationIds.push(organizationId);
  return { ...makeTestOrgContext(), organizationId };
}

async function createFacility(ctx: OrgContext): Promise<FacilityFixture> {
  const [facility] = await db.insert(facilities).values({
    ...TEST_SITE_POSITION, organizationId: ctx.organizationId, code: `FAC-${crypto.randomUUID()}`,
    name: `Next code site ${crypto.randomUUID()}`, timezone: "UTC",
  }).returning();
  const [feedstock] = await db.insert(feedstockTypes).values({
    organizationId: ctx.organizationId, code: `FT-${crypto.randomUUID()}`,
    name: `Next code feedstock ${crypto.randomUUID()}`, category: "forestry", usage: "pyrolysis",
  }).returning();
  const [process] = await db.insert(productionProcesses).values({
    organizationId: ctx.organizationId, facilityId: facility.id, feedstockTypeId: feedstock.id,
  }).returning();
  return { ctx, facilityId: facility.id, feedstockTypeId: feedstock.id, productionProcessId: process.id };
}

async function insertBatch(
  fixture: FacilityFixture,
  suffix: string,
) {
  const { ctx, facilityId, feedstockTypeId, productionProcessId } = fixture;
  await db.insert(creditBatches).values({
    organizationId: ctx.organizationId, facilityId, feedstockTypeId, productionProcessId,
    code: `${codePrefix}-${suffix}`,
    startDate: "2026-06-01", endDate: "2026-06-30",
  });
}

beforeEach(async () => {
  organizationIds = [];
  const year = String(new Date().getFullYear() % 100).padStart(2, "0");
  codePrefix = `${CREDIT_BATCH_CODE_PREFIX}-${year}`;
  site = await createFacility(await createOrganization());
});

afterEach(async () => {
  for (const organizationId of organizationIds) {
    await db.delete(creditBatches).where(eq(creditBatches.organizationId, organizationId));
    await db.delete(productionProcesses).where(eq(productionProcesses.organizationId, organizationId));
    await db.delete(feedstockTypes).where(eq(feedstockTypes.organizationId, organizationId));
    await db.delete(facilities).where(eq(facilities.organizationId, organizationId));
    await db.delete(organizations).where(eq(organizations.id, organizationId));
  }
});

describe("getNextCreditBatchCode", () => {
  it("returns the first code when there are no batches, without reserving it", async () => {
    expect(await getNextCreditBatchCode(site.ctx)).toBe(`${codePrefix}-001`);
    expect(await getNextCreditBatchCode(site.ctx)).toBe(`${codePrefix}-001`);
  });

  it("continues after the organization's highest code, whatever the facility", async () => {
    await insertBatch(site, "001");
    await insertBatch(await createFacility(site.ctx), "009");
    expect(await getNextCreditBatchCode(site.ctx)).toBe(`${codePrefix}-010`);
  });

  it("ignores another organization's codes", async () => {
    await insertBatch(site, "001");
    await insertBatch(await createFacility(await createOrganization()), "099");
    expect(await getNextCreditBatchCode(site.ctx)).toBe(`${codePrefix}-002`);
  });
});
