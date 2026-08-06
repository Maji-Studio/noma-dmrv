import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { eq, inArray } from "drizzle-orm";
import {
  getCertifierProjectByFacility,
  upsertCertifierProject,
} from "@/data-access/certification";
import { db } from "@/db";
import {
  certificationSubmissions,
  certifierProjects,
  certifierRemovals,
} from "@/db/schema/certification";
import { facilities } from "@/db/schema/facilities";
import {
  ensureTestOrg,
  makeTestOrgContext,
  TEST_ORG_ID,
} from "./helpers/test-org";

const USER_ID = "test-user-certifier-project-mapping";
const facilityIds: string[] = [];
const removalIds: string[] = [];
const submissionIds: string[] = [];

beforeAll(() => ensureTestOrg());

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
    await db
      .delete(certifierProjects)
      .where(eq(certifierProjects.facilityId, facilityId));
    await db.delete(facilities).where(eq(facilities.id, facilityId));
  }
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
    .values({
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
      facilityId,
      provider: "isometric",
      externalProjectId: "prj_protocol_initial",
      protocolVersion: "1.2",
    });
    const updated = await upsertCertifierProject(ctx, {
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
      facilityId,
      provider: "isometric",
      externalProjectId: "prj_protocol_old",
      protocolVersion: "1.2",
    });
    const updated = await upsertCertifierProject(ctx, {
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
      facilityId,
      provider: "isometric",
      externalProjectId: "prj_protocol_clear",
      protocolVersion: "1.2",
    });
    const updated = await upsertCertifierProject(ctx, {
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
        facilityId,
        provider: "isometric",
        externalProjectId,
        protocolVersion: "1.2",
      }),
      upsertCertifierProject(ctx, {
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

  it("allows adopting a facility id (null to value) despite submissions", async () => {
    const facilityId = await createFacility();
    const ctx = makeTestOrgContext(USER_ID);

    await upsertCertifierProject(ctx, {
      facilityId,
      provider: "isometric",
      externalProjectId: PROJECT_ID,
    });
    await insertBlockingSubmission(facilityId);

    const updated = await upsertCertifierProject(ctx, {
      facilityId,
      provider: "isometric",
      externalProjectId: PROJECT_ID,
      externalFacilityId: `fcl_adopt_${facilityId.slice(0, 8)}`,
    });

    expect(updated.externalFacilityId).toBe(
      `fcl_adopt_${facilityId.slice(0, 8)}`,
    );
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
        externalFacilityId: null,
      }),
    ).rejects.toThrow(/Cannot change certifier project or facility ID/);
  });

  it("blocks rebinding the project while submissions exist", async () => {
    const facilityId = await createFacility();
    const ctx = makeTestOrgContext(USER_ID);

    await upsertCertifierProject(ctx, {
      facilityId,
      provider: "isometric",
      externalProjectId: PROJECT_ID,
    });
    await insertBlockingSubmission(facilityId);

    await expect(
      upsertCertifierProject(ctx, {
        facilityId,
        provider: "isometric",
        externalProjectId: "prj_guard_other",
      }),
    ).rejects.toThrow(/Cannot change certifier project or facility ID/);
  });
});
