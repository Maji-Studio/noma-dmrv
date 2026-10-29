import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { creditBatches, facilities, feedstockTypes, organizations, productionProcesses } from "@/db/schema";
import { CREDIT_BATCH_CODE_PREFIX } from "@/config/credit-batches";
import { getCreditBatchNameSuggestion } from "@/data-access/credit-batches";
import type { OrgContext } from "@/lib/auth/server";
import { makeTestOrgContext, TEST_SITE_POSITION } from "./helpers/test-org";

const EARLIER = new Date("2026-06-01T10:00:00Z");
const LATEST = new Date("2026-06-02T10:00:00Z");
const LATER = new Date("2026-06-03T10:00:00Z");

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
  const organizationId = `name-suggestion-${crypto.randomUUID()}`;
  await db.insert(organizations).values({ id: organizationId, name: "Name suggestion", slug: organizationId });
  organizationIds.push(organizationId);
  return { ...makeTestOrgContext(), organizationId };
}

async function createFacility(ctx: OrgContext): Promise<FacilityFixture> {
  const [facility] = await db.insert(facilities).values({
    ...TEST_SITE_POSITION, organizationId: ctx.organizationId, code: `FAC-${crypto.randomUUID()}`,
    name: `Name suggestion site ${crypto.randomUUID()}`, timezone: "UTC",
  }).returning();
  const [feedstock] = await db.insert(feedstockTypes).values({
    organizationId: ctx.organizationId, code: `FT-${crypto.randomUUID()}`,
    name: `Name suggestion feedstock ${crypto.randomUUID()}`, category: "forestry", usage: "pyrolysis",
  }).returning();
  const [process] = await db.insert(productionProcesses).values({
    organizationId: ctx.organizationId, facilityId: facility.id, feedstockTypeId: feedstock.id,
  }).returning();
  return { ctx, facilityId: facility.id, feedstockTypeId: feedstock.id, productionProcessId: process.id };
}

async function insertBatch(
  fixture: FacilityFixture,
  input: { suffix: string; name: string | null; createdAt: Date; id?: string },
) {
  const { ctx, facilityId, feedstockTypeId, productionProcessId } = fixture;
  await db.insert(creditBatches).values({
    organizationId: ctx.organizationId, facilityId, feedstockTypeId, productionProcessId,
    id: input.id, code: `${codePrefix}-${input.suffix}`, name: input.name, createdAt: input.createdAt,
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

describe("getCreditBatchNameSuggestion", () => {
  it("returns the first code and no name when there are no batches, without reserving a code", async () => {
    const expected = { nextCode: `${codePrefix}-001`, name: null };
    expect(await getCreditBatchNameSuggestion(site.ctx, site.facilityId)).toEqual(expected);
    expect(await getCreditBatchNameSuggestion(site.ctx, site.facilityId)).toEqual(expected);
  });

  it("continues the code when the latest batch is unnamed, ignoring older names", async () => {
    await insertBatch(site, { suffix: "001", name: "Lot 07", createdAt: EARLIER });
    await insertBatch(site, { suffix: "002", name: null, createdAt: LATEST });
    expect(await getCreditBatchNameSuggestion(site.ctx, site.facilityId)).toEqual({
      nextCode: `${codePrefix}-003`, name: null,
    });
  });

  it("continues the latest name rather than an older batch's different name", async () => {
    await insertBatch(site, { suffix: "001", name: "Earlier 99", createdAt: EARLIER });
    await insertBatch(site, { suffix: "002", name: "Lot 07", createdAt: LATEST });
    expect(await getCreditBatchNameSuggestion(site.ctx, site.facilityId)).toEqual({
      nextCode: `${codePrefix}-003`, name: "Lot 08",
    });
  });

  it("returns no name when the latest name has no trailing number", async () => {
    await insertBatch(site, { suffix: "001", name: "Lot", createdAt: LATEST });
    expect(await getCreditBatchNameSuggestion(site.ctx, site.facilityId)).toEqual({
      nextCode: `${codePrefix}-002`, name: null,
    });
  });

  it("ignores another organization's newer batch and higher code", async () => {
    await insertBatch(site, { suffix: "001", name: "Lot 07", createdAt: LATEST });
    const foreignSite = await createFacility(await createOrganization());
    await insertBatch(foreignSite, { suffix: "099", name: "Foreign 50", createdAt: LATER });
    expect(await getCreditBatchNameSuggestion(site.ctx, site.facilityId)).toEqual({
      nextCode: `${codePrefix}-002`, name: "Lot 08",
    });
    // Even a foreign facility ID cannot reveal its name through a trusted-context read.
    expect(await getCreditBatchNameSuggestion(site.ctx, foreignSite.facilityId)).toEqual({
      nextCode: `${codePrefix}-002`, name: null,
    });
  });

  it("ignores another facility's newer name but includes its code in the org-wide sequence", async () => {
    await insertBatch(site, { suffix: "001", name: "Lot 07", createdAt: LATEST });
    const otherSite = await createFacility(site.ctx);
    await insertBatch(otherSite, { suffix: "009", name: "Other 50", createdAt: LATER });
    expect(await getCreditBatchNameSuggestion(site.ctx, site.facilityId)).toEqual({
      nextCode: `${codePrefix}-010`, name: "Lot 08",
    });
    const emptySite = await createFacility(site.ctx);
    expect(await getCreditBatchNameSuggestion(site.ctx, emptySite.facilityId)).toEqual({
      nextCode: `${codePrefix}-010`, name: null,
    });
  });

  it("breaks a createdAt tie by descending id", async () => {
    const [lowerId, higherId] = [crypto.randomUUID(), crypto.randomUUID()].sort();
    await insertBatch(site, {
      suffix: "001", name: "Lot 07", createdAt: LATEST, id: higherId,
    });
    await insertBatch(site, {
      suffix: "002", name: "Earlier 99", createdAt: LATEST, id: lowerId,
    });
    expect(await getCreditBatchNameSuggestion(site.ctx, site.facilityId)).toEqual({
      nextCode: `${codePrefix}-003`, name: "Lot 08",
    });
  });
});
