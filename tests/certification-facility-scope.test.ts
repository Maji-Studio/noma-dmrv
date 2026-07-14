import { ensureTestOrg, makeTestOrgContext, TEST_ORG_ID } from "./helpers/test-org";
/**
 * DB-backed regression tests for the resolved-facility scope on the
 * certification submit surface (issue #277).
 *
 * SCOPE OF WHAT THESE PROVE: they exercise the data-access guard *contract* —
 * `getSubmissionById` / `getLatestSubmission` / `getLatestSubmissionsForEntities`
 * resolve a submission's owning facility from its anchor row and refuse (or drop)
 * a read scoped to a different facility, failing closed on a dangling anchor.
 * They deliberately hand the helper a mismatched `facilityBId` directly — a
 * state today's wired entry points cannot themselves produce, because each
 * derives its `expectedFacilityId` from the same anchor id it is reading (so the
 * live comparison is lineage-consistency, whose only reachable rejection is a
 * dangling anchor). A true entry-point IDOR rejection can't be expressed until
 * an independent caller facility exists (membership model / active-facility
 * context, issue #372 / ADR 0010); these tests are the seam's contract guard,
 * not a proof that any submit action rejects a cross-facility swap.
 *
 * Per ADR 0008 the guard resolves facility from the anchor row in real Postgres,
 * so these run DB-backed rather than against an in-memory fake.
 */
import { beforeAll, afterAll, describe, expect, it } from "vitest";
import { eq, inArray } from "drizzle-orm";
import {
  getLatestSubmissionsForEntities,
  getSubmissionById,
} from "@/data-access/certification";
import { getLatestSubmission } from "@/data-access/certification-submissions";
import { db } from "@/db";
import {
  certificationSubmissions,
  certifierGhgStatements,
  certifierRemovals,
} from "@/db/schema/certification";
import { facilities } from "@/db/schema/facilities";

const USER_ID = "test-user-facility-scope";
const PROVIDER = "isometric" as const;
const NOT_IN_FACILITY = "Submission does not belong to this facility.";

interface ScopeFixture {
  facilityAId: string;
  facilityBId: string;
  removalAId: string;
  ghgStatementAId: string;
  removalSubmissionAId: string;
  ghgSubmissionAId: string;
  orphanSubmissionId: string;
}

function tag(): string {
  return crypto.randomUUID().slice(0, 8).toUpperCase();
}

async function seedFixture(): Promise<ScopeFixture> {
  return db.transaction(async (tx) => {
    const [facilityA] = await tx
      .insert(facilities)
      .values({ organizationId: TEST_ORG_ID, code: `FAC-SCP-A-${tag()}`, name: `Scope Facility A` })
      .returning({ id: facilities.id });
    const [facilityB] = await tx
      .insert(facilities)
      .values({ organizationId: TEST_ORG_ID, code: `FAC-SCP-B-${tag()}`, name: `Scope Facility B` })
      .returning({ id: facilities.id });

    const [ghgStatementA] = await tx
      .insert(certifierGhgStatements)
      .values({ organizationId: TEST_ORG_ID, facilityId: facilityA.id, reportingPeriodEndOn: "2026-06-30" })
      .returning({ id: certifierGhgStatements.id });

    const [removalA] = await tx
      .insert(certifierRemovals)
      .values({ organizationId: TEST_ORG_ID, facilityId: facilityA.id })
      .returning({ id: certifierRemovals.id });

    const [removalSubmissionA] = await tx
      .insert(certificationSubmissions)
      .values({
        organizationId: TEST_ORG_ID,
        provider: PROVIDER,
        submissionType: "removal",
        localEntityType: "removal",
        localEntityId: removalA.id,
        externalId: `ext_rem_${tag()}`,
        version: 1,
        status: "submitted",
        payloadHash: `hash-rem-${tag()}`,
        payloadSnapshot: { fixture: "certification-facility-scope" },
        submittedAt: new Date("2026-06-17T00:00:00Z"),
      })
      .returning({ id: certificationSubmissions.id });

    const [ghgSubmissionA] = await tx
      .insert(certificationSubmissions)
      .values({
        organizationId: TEST_ORG_ID,
        provider: PROVIDER,
        submissionType: "ghg_statement",
        localEntityType: "ghgStatement",
        localEntityId: ghgStatementA.id,
        externalId: `ext_ghg_${tag()}`,
        version: 1,
        status: "submitted",
        payloadHash: `hash-ghg-${tag()}`,
        payloadSnapshot: { fixture: "certification-facility-scope" },
        submittedAt: new Date("2026-06-17T00:00:00Z"),
      })
      .returning({ id: certificationSubmissions.id });

    // A removal submission whose anchor row does not exist — the guard must
    // fail closed (unresolvable facility is refused, not allowed).
    const [orphanSubmission] = await tx
      .insert(certificationSubmissions)
      .values({
        organizationId: TEST_ORG_ID,
        provider: PROVIDER,
        submissionType: "removal",
        localEntityType: "removal",
        localEntityId: crypto.randomUUID(),
        externalId: `ext_orphan_${tag()}`,
        version: 1,
        status: "submitted",
        payloadHash: `hash-orphan-${tag()}`,
        payloadSnapshot: { fixture: "certification-facility-scope" },
        submittedAt: new Date("2026-06-17T00:00:00Z"),
      })
      .returning({ id: certificationSubmissions.id });

    return {
      facilityAId: facilityA.id,
      facilityBId: facilityB.id,
      removalAId: removalA.id,
      ghgStatementAId: ghgStatementA.id,
      removalSubmissionAId: removalSubmissionA.id,
      ghgSubmissionAId: ghgSubmissionA.id,
      orphanSubmissionId: orphanSubmission.id,
    };
  });
}

const fixtures: ScopeFixture[] = [];

async function withFixture<T>(
  fn: (fixture: ScopeFixture) => Promise<T>,
): Promise<T> {
  const fixture = await seedFixture();
  fixtures.push(fixture);
  return fn(fixture);
}

afterAll(async () => {
  for (const f of fixtures) {
    await db
      .delete(certificationSubmissions)
      .where(
        inArray(certificationSubmissions.id, [
          f.removalSubmissionAId,
          f.ghgSubmissionAId,
          f.orphanSubmissionId,
        ]),
      );
    await db
      .delete(certifierRemovals)
      .where(eq(certifierRemovals.id, f.removalAId));
    await db
      .delete(certifierGhgStatements)
      .where(eq(certifierGhgStatements.id, f.ghgStatementAId));
    await db
      .delete(facilities)
      .where(inArray(facilities.id, [f.facilityAId, f.facilityBId]));
  }
});


beforeAll(() => ensureTestOrg());

describe("certification submit surface — resolved-facility scope (#277)", () => {
  it("getSubmissionById rejects a removal submission scoped to the wrong facility", async () => {
    await withFixture(async (f) => {
      await expect(
        getSubmissionById(makeTestOrgContext(USER_ID), f.removalSubmissionAId, f.facilityBId),
      ).rejects.toThrow(NOT_IN_FACILITY);
    });
  });

  it("getSubmissionById returns the row when scoped to its own facility", async () => {
    await withFixture(async (f) => {
      const row = await getSubmissionById(
        makeTestOrgContext(USER_ID),
        f.removalSubmissionAId,
        f.facilityAId,
      );
      expect(row?.id).toBe(f.removalSubmissionAId);
    });
  });

  it("getSubmissionById stays unscoped (id-only) when no facility is supplied", async () => {
    await withFixture(async (f) => {
      const row = await getSubmissionById(makeTestOrgContext(USER_ID), f.removalSubmissionAId);
      expect(row?.id).toBe(f.removalSubmissionAId);
    });
  });

  it("getSubmissionById rejects a ghg-statement submission scoped to the wrong facility", async () => {
    await withFixture(async (f) => {
      await expect(
        getSubmissionById(makeTestOrgContext(USER_ID), f.ghgSubmissionAId, f.facilityBId),
      ).rejects.toThrow(NOT_IN_FACILITY);
      const row = await getSubmissionById(
        makeTestOrgContext(USER_ID),
        f.ghgSubmissionAId,
        f.facilityAId,
      );
      expect(row?.id).toBe(f.ghgSubmissionAId);
    });
  });

  it("getSubmissionById fails closed when the anchor row cannot be resolved", async () => {
    await withFixture(async (f) => {
      await expect(
        getSubmissionById(makeTestOrgContext(USER_ID), f.orphanSubmissionId, f.facilityAId),
      ).rejects.toThrow(NOT_IN_FACILITY);
    });
  });

  it("getLatestSubmission rejects when scoped to the wrong facility", async () => {
    await withFixture(async (f) => {
      const key = {
        provider: PROVIDER,
        submissionType: "removal",
        localEntityType: "removal",
        localEntityId: f.removalAId,
      };
      await expect(
        getLatestSubmission(makeTestOrgContext(USER_ID), key, f.facilityBId),
      ).rejects.toThrow(NOT_IN_FACILITY);
      const row = await getLatestSubmission(makeTestOrgContext(USER_ID), key, f.facilityAId);
      expect(row?.id).toBe(f.removalSubmissionAId);
    });
  });

  it("getLatestSubmissionsForEntities drops rows outside the scoped facility", async () => {
    await withFixture(async (f) => {
      const key = {
        provider: PROVIDER,
        submissionType: "removal",
        localEntityType: "removal",
        localEntityIds: [f.removalAId],
      };
      const wrong = await getLatestSubmissionsForEntities(
        makeTestOrgContext(USER_ID),
        key,
        f.facilityBId,
      );
      expect(wrong.has(f.removalAId)).toBe(false);
      const right = await getLatestSubmissionsForEntities(
        makeTestOrgContext(USER_ID),
        key,
        f.facilityAId,
      );
      expect(right.get(f.removalAId)?.id).toBe(f.removalSubmissionAId);
    });
  });
});
