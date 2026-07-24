import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import {
  getCertifierProjectByFacility,
  upsertCertifierProject,
} from "@/data-access/certification";
import { db } from "@/db";
import { certifierProjects } from "@/db/schema/certification";
import { facilities } from "@/db/schema/facilities";
import {
  ensureTestOrg,
  makeTestOrgContext,
  TEST_ORG_ID,
} from "./helpers/test-org";

const USER_ID = "test-user-certifier-project-mapping";
const facilityIds: string[] = [];

beforeAll(() => ensureTestOrg());

afterAll(async () => {
  for (const facilityId of facilityIds) {
    await db
      .delete(certifierProjects)
      .where(eq(certifierProjects.facilityId, facilityId));
    await db.delete(facilities).where(eq(facilities.id, facilityId));
  }
});

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
