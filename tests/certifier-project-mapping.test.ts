import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { and, eq, inArray } from "drizzle-orm";
import {
  getCertifierProjectByFacility,
  upsertCertifierProject,
} from "@/data-access/certification";
import { db } from "@/db";
import { createCreditBatch, updateCreditBatch } from "@/data-access/credit-batches";
import { creditBatches } from "@/db/schema/credits";
import { feedstockTypes } from "@/db/schema/feedstock";
import { productionProcesses } from "@/db/schema/production-processes";
import { activityEvents } from "@/db/schema/activity";
import { SafeError } from "@/lib/errors";
import {
  certificationSubmissions,
  certifierProjects,
  certifierRemovals,
} from "@/db/schema/certification";
import { facilities } from "@/db/schema/facilities";
import { organizations } from "@/db/schema/auth";
import { TEST_SITE_POSITION,
  ensureTestOrg,
  makeTestOrgContext,
  TEST_ORG_ID,
} from "./helpers/test-org";

const USER_ID = "test-user-certifier-project-mapping";
const facilityIds: string[] = [];
const removalIds: string[] = [];
const submissionIds: string[] = [];
const otherOrgIds: string[] = [];
let feedstockTypeId: string;

beforeAll(async () => {
  await ensureTestOrg();
  const tag = crypto.randomUUID().slice(0, 8);
  const [type] = await db.insert(feedstockTypes).values({
    organizationId: TEST_ORG_ID, code: `FT-CPM-${tag}`, name: `Mapping feedstock ${tag}`,
    category: "forestry", usage: "pyrolysis",
  }).returning({ id: feedstockTypes.id });
  feedstockTypeId = type.id;
});

afterAll(async () => {
  if (submissionIds.length) {
    await db
      .delete(certificationSubmissions)
      .where(inArray(certificationSubmissions.id, submissionIds));
  }
  if (removalIds.length) {
    await db
      .delete(certifierRemovals)
      .where(inArray(certifierRemovals.id, removalIds));
  }
  for (const facilityId of facilityIds) {
    await db.delete(activityEvents).where(and(eq(activityEvents.organizationId, TEST_ORG_ID), eq(activityEvents.facilityId, facilityId)));
    await db.delete(creditBatches).where(and(eq(creditBatches.organizationId, TEST_ORG_ID), eq(creditBatches.facilityId, facilityId)));
    await db.delete(productionProcesses).where(and(eq(productionProcesses.organizationId, TEST_ORG_ID), eq(productionProcesses.facilityId, facilityId)));
    await db
      .delete(certifierProjects)
      .where(eq(certifierProjects.facilityId, facilityId));
    await db.delete(facilities).where(eq(facilities.id, facilityId));
  }
  if (feedstockTypeId) await db.delete(feedstockTypes).where(eq(feedstockTypes.id, feedstockTypeId));
  if (otherOrgIds.length) {
    await db.delete(organizations).where(inArray(organizations.id, otherOrgIds));
  }
});

describe("upsertCertifierProject organization guard", () => {
  it("refuses to overwrite another organization's existing mapping", async () => {
    const facilityId = await createFacility();
    const ctx = makeTestOrgContext(USER_ID);
    const original = await upsertCertifierProject(ctx, {
      externalFacilityId: `fcl_test_${facilityId}`,
      facilityId,
      provider: "isometric",
      externalProjectId: "prj_org_guard_original",
      protocolVersion: "1.2",
    });
    const otherOrgId = `org_certifier_mapping_${crypto.randomUUID()}`;
    await db.insert(organizations).values({
      id: otherOrgId,
      name: "Certifier Mapping Other Organization",
      slug: otherOrgId,
    });
    otherOrgIds.push(otherOrgId);
    const otherCtx = { ...ctx, organizationId: otherOrgId };

    await expect(
      upsertCertifierProject(otherCtx, {
        externalFacilityId: `fcl_test_${facilityId}`,
        facilityId,
        provider: "isometric",
        externalProjectId: "prj_org_guard_foreign",
        protocolVersion: null,
      }),
    ).rejects.toThrow(/belongs to another organization/);

    expect(
      await getCertifierProjectByFacility(ctx, facilityId, "isometric"),
    ).toEqual(original);
    expect(
      await getCertifierProjectByFacility(otherCtx, facilityId, "isometric"),
    ).toBeNull();
  });
});

/**
 * A submitted removal in the ledger — the state that pins a facility's
 * mapping identifiers via `hasBlockingFacilitySubmission`.
 */
async function insertBlockingSubmission(facilityId: string): Promise<void> {
  const [removal] = await db
    .insert(certifierRemovals)
    .values({ organizationId: TEST_ORG_ID, facilityId })
    .returning({ id: certifierRemovals.id });
  removalIds.push(removal.id);

  const [submission] = await db
    .insert(certificationSubmissions)
    .values({
      organizationId: TEST_ORG_ID,
      submissionType: "removal",
      localEntityType: "removal",
      localEntityId: removal.id,
      status: "submitted",
    })
    .returning({ id: certificationSubmissions.id });
  submissionIds.push(submission.id);
}

async function createFacility(): Promise<string> {
  const tag = crypto.randomUUID().slice(0, 8);
  const [facility] = await db
    .insert(facilities)
    .values({ ...TEST_SITE_POSITION, timezone: "UTC",
      organizationId: TEST_ORG_ID,
      code: `FAC-CPM-${tag}`,
      name: `Certifier Project Mapping ${tag}`,
    })
    .returning({ id: facilities.id });
  facilityIds.push(facility.id);
  return facility.id;
}

describe("upsertCertifierProject protocol version", () => {
  it("preserves the audited version when a mapping save omits it", async () => {
    const facilityId = await createFacility();
    const ctx = makeTestOrgContext(USER_ID);

    await upsertCertifierProject(ctx, {
      externalFacilityId: `fcl_test_${facilityId}`,
      facilityId,
      provider: "isometric",
      externalProjectId: "prj_protocol_initial",
      protocolVersion: "1.2",
    });
    const updated = await upsertCertifierProject(ctx, {
      externalFacilityId: `fcl_test_${facilityId}`,
      facilityId,
      provider: "isometric",
      externalProjectId: "prj_protocol_initial",
    });

    expect(updated.protocolVersion).toBe("1.2");
  });

  it("clears the previous project's version when the mapping is rebound", async () => {
    const facilityId = await createFacility();
    const ctx = makeTestOrgContext(USER_ID);

    await upsertCertifierProject(ctx, {
      externalFacilityId: `fcl_test_${facilityId}`,
      facilityId,
      provider: "isometric",
      externalProjectId: "prj_protocol_old",
      protocolVersion: "1.2",
    });
    const updated = await upsertCertifierProject(ctx, {
      externalFacilityId: `fcl_test_${facilityId}`,
      facilityId,
      provider: "isometric",
      externalProjectId: "prj_protocol_new",
    });

    expect(updated.protocolVersion).toBeNull();
  });

  it("clears the audited version only when explicitly requested", async () => {
    const facilityId = await createFacility();
    const ctx = makeTestOrgContext(USER_ID);

    await upsertCertifierProject(ctx, {
      externalFacilityId: `fcl_test_${facilityId}`,
      facilityId,
      provider: "isometric",
      externalProjectId: "prj_protocol_clear",
      protocolVersion: "1.2",
    });
    const updated = await upsertCertifierProject(ctx, {
      externalFacilityId: `fcl_test_${facilityId}`,
      facilityId,
      provider: "isometric",
      externalProjectId: "prj_protocol_clear",
      protocolVersion: null,
    });

    expect(updated.protocolVersion).toBeNull();
  });

  it("preserves a concurrent first writer's version for the same project", async () => {
    const facilityId = await createFacility();
    const ctx = makeTestOrgContext(USER_ID);
    const externalProjectId = "prj_protocol_concurrent";

    await Promise.all([
      upsertCertifierProject(ctx, {
        externalFacilityId: `fcl_test_${facilityId}`,
        facilityId,
        provider: "isometric",
        externalProjectId,
        protocolVersion: "1.2",
      }),
      upsertCertifierProject(ctx, {
        externalFacilityId: `fcl_test_${facilityId}`,
        facilityId,
        provider: "isometric",
        externalProjectId,
      }),
    ]);

    const mapping = await getCertifierProjectByFacility(
      ctx,
      facilityId,
      "isometric",
    );
    expect(mapping?.protocolVersion).toBe("1.2");
  });
});

describe("upsertCertifierProject submission guard", () => {
  const PROJECT_ID = "prj_guard_project";

  it.each(["", "   "])("refuses an empty facility id (%s) before creating a link", async (externalFacilityId) => {
    const facilityId = await createFacility();
    const ctx = makeTestOrgContext(USER_ID);
    await expect(upsertCertifierProject(ctx, {
      facilityId,
      provider: "isometric",
      externalProjectId: PROJECT_ID,
      externalFacilityId,
    })).rejects.toThrow(/Set an Isometric facility ID/);
    expect(await getCertifierProjectByFacility(ctx, facilityId, "isometric")).toBeNull();
  });

  it("allows re-saving the same facility id despite submissions", async () => {
    const facilityId = await createFacility();
    const ctx = makeTestOrgContext(USER_ID);
    const externalFacilityId = `fcl_same_${facilityId.slice(0, 8)}`;

    await upsertCertifierProject(ctx, {
      facilityId,
      provider: "isometric",
      externalProjectId: PROJECT_ID,
      externalFacilityId,
    });
    await insertBlockingSubmission(facilityId);

    const updated = await upsertCertifierProject(ctx, {
      facilityId,
      provider: "isometric",
      externalProjectId: PROJECT_ID,
      externalFacilityId,
    });

    expect(updated.externalFacilityId).toBe(externalFacilityId);
  });

  it("blocks changing an established facility id while submissions exist", async () => {
    const facilityId = await createFacility();
    const ctx = makeTestOrgContext(USER_ID);

    await upsertCertifierProject(ctx, {
      facilityId,
      provider: "isometric",
      externalProjectId: PROJECT_ID,
      externalFacilityId: `fcl_old_${facilityId.slice(0, 8)}`,
    });
    await insertBlockingSubmission(facilityId);

    await expect(
      upsertCertifierProject(ctx, {
        facilityId,
        provider: "isometric",
        externalProjectId: PROJECT_ID,
        externalFacilityId: `fcl_new_${facilityId.slice(0, 8)}`,
      }),
    ).rejects.toThrow(/Cannot change certifier project or facility ID/);
  });

  it("blocks clearing an established facility id while submissions exist", async () => {
    const facilityId = await createFacility();
    const ctx = makeTestOrgContext(USER_ID);

    await upsertCertifierProject(ctx, {
      facilityId,
      provider: "isometric",
      externalProjectId: PROJECT_ID,
      externalFacilityId: `fcl_keep_${facilityId.slice(0, 8)}`,
    });
    await insertBlockingSubmission(facilityId);

    await expect(
      upsertCertifierProject(ctx, {
        facilityId,
        provider: "isometric",
        externalProjectId: PROJECT_ID,
        externalFacilityId: "",
      }),
    ).rejects.toThrow(/Set an Isometric facility ID/);
  });

  it("blocks rebinding the project while submissions exist", async () => {
    const facilityId = await createFacility();
    const ctx = makeTestOrgContext(USER_ID);

    await upsertCertifierProject(ctx, {
      externalFacilityId: `fcl_test_${facilityId}`,
      facilityId,
      provider: "isometric",
      externalProjectId: PROJECT_ID,
    });
    await insertBlockingSubmission(facilityId);

    await expect(
      upsertCertifierProject(ctx, {
        externalFacilityId: `fcl_test_${facilityId}`,
        facilityId,
        provider: "isometric",
        externalProjectId: "prj_guard_other",
      }),
    ).rejects.toThrow(/Cannot change certifier project or facility ID/);
  });
});


describe("upsertCertifierProject credit batch adoption", () => {
  const ctx = makeTestOrgContext(USER_ID);
  const link = (facilityId: string) => upsertCertifierProject(ctx, {
    facilityId, provider: "isometric", externalProjectId: `prj_period_${facilityId}`,
    externalFacilityId: `fcl_period_${facilityId}`,
  });
  const createBatch = (facilityId: string, startDate: string, endDate: string) => createCreditBatch(ctx, {
    facilityId, feedstockTypeId, code: `CB-CPM-${crypto.randomUUID().slice(0, 8)}`,
    startDate: new Date(startDate), endDate: new Date(endDate), productionRunIds: [],
  });
  const storedBatch = async (id: string) => (await db.select().from(creditBatches)
    .where(and(eq(creditBatches.id, id), eq(creditBatches.organizationId, ctx.organizationId))))[0];

  it("refuses the link and names every active multi-month batch", async () => {
    const facilityId = await createFacility();
    const first = await createBatch(facilityId, "2027-01-01", "2027-04-30");
    const second = await createBatch(facilityId, "2027-05-01", "2027-08-31");
    expect(first.certifier).toBeNull();
    const codes = [first.code, second.code].sort().join(", ");
    await expect(link(facilityId)).rejects.toThrow(new SafeError(
      `Credit batches ${codes} span more than one calendar month. Shorten or archive them before linking this facility to Isometric.`,
    ));
    expect(await getCertifierProjectByFacility(ctx, facilityId)).toBeNull();
    for (const batch of [first, second]) {
      expect(await storedBatch(batch.id)).toMatchObject({ certifier: null, version: batch.version });
    }
  });

  it.each(["2027-02-27", "2027-02-28"])("links and stamps a period ending %s from January 31", async endDate => {
    const facilityId = await createFacility();
    const batch = await createBatch(facilityId, "2027-01-31", endDate);
    await link(facilityId);
    const adopted = await storedBatch(batch.id);
    expect(adopted).toMatchObject({ certifier: "isometric", version: batch.version + 1 });
    await expect(updateCreditBatch(ctx, batch.id, {
      expectedVersion: adopted.version, endDate: new Date("2027-04-30"),
    })).rejects.toThrow(/at most one month/);
    await expect(db.update(creditBatches).set({ endDate: "2027-04-30" })
      .where(and(eq(creditBatches.id, batch.id), eq(creditBatches.organizationId, ctx.organizationId))))
      .rejects.toMatchObject({ cause: { constraint: "credit_batches_isometric_max_one_month" } });
    const events = await db.select().from(activityEvents).where(and(
      eq(activityEvents.organizationId, ctx.organizationId), eq(activityEvents.entityId, batch.id),
      eq(activityEvents.action, "updated"),
    ));
    expect(events).toHaveLength(1);
    expect(events[0].changedFields).toEqual(["certifier"]);
    await link(facilityId);
    expect((await storedBatch(batch.id)).version).toBe(adopted.version);
  });

  it("allows linking after an overlong batch is shortened", async () => {
    const facilityId = await createFacility();
    const batch = await createBatch(facilityId, "2027-01-01", "2027-04-30");
    await expect(link(facilityId)).rejects.toThrow(
      `Credit batch ${batch.code} spans more than one calendar month. Shorten or archive it before linking this facility to Isometric.`,
    );
    await updateCreditBatch(ctx, batch.id, { expectedVersion: batch.version, endDate: new Date("2027-02-01") });
    await link(facilityId);
    expect((await storedBatch(batch.id)).certifier).toBe("isometric");
  });

  it("leaves archived overlong batches unchanged while adopting active batches", async () => {
    const facilityId = await createFacility();
    const archived = await createBatch(facilityId, "2027-01-01", "2027-04-30");
    await db.update(creditBatches).set({ archivedAt: new Date() })
      .where(and(eq(creditBatches.id, archived.id), eq(creditBatches.organizationId, ctx.organizationId)));
    const active = await createBatch(facilityId, "2027-05-01", "2027-05-31");
    await link(facilityId);
    expect((await storedBatch(archived.id)).certifier).toBeNull();
    expect((await storedBatch(active.id)).certifier).toBe("isometric");
  });

  it("rolls batch adoption back when the mapping fails a later collision check", async () => {
    const ownerFacilityId = await createFacility();
    const owner = await link(ownerFacilityId);
    const facilityId = await createFacility();
    const batch = await createBatch(facilityId, "2027-01-01", "2027-01-31");
    await expect(upsertCertifierProject(ctx, {
      facilityId, provider: "isometric", externalProjectId: owner.externalProjectId,
      externalFacilityId: owner.externalFacilityId,
    })).rejects.toThrow(/already linked/);
    expect(await storedBatch(batch.id)).toMatchObject({ certifier: null, version: batch.version });
    expect(await getCertifierProjectByFacility(ctx, facilityId)).toBeNull();
  });
});
