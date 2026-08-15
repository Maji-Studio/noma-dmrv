import { ensureTestOrg, makeTestOrgContext, TEST_ORG_ID } from "./helpers/test-org";
/**
 * DB-backed tests for `claimSubmissionDraft` (the submission-ledger claim
 * module). Per ADR 0008 these run against real Postgres — the module's
 * load-bearing behavior is FOR UPDATE queueing and READ COMMITTED
 * visibility, which an in-memory fake cannot reproduce.
 *
 * Concurrency cases orchestrate real interleavings: a helper transaction
 * holds the facility's mapping lock while a claim parks on it, then commits
 * a conflicting ledger mutation through a second pool connection before
 * releasing — exactly the window the in-lock re-decision exists for.
 */
import { beforeAll, afterAll, describe, expect, it } from "vitest";
import { and, eq, inArray } from "drizzle-orm";
import { db } from "@/db";
import {
  claimSubmissionDraft,
  resetSubmissionToDraftWithMappingLock,
  type ClaimOutcome,
  type ClaimSubmissionDraftArgs,
  type MappingClaimGuard,
  type SubmissionKey,
} from "@/data-access/certification-submissions";
import {
  certificationSubmissions,
  certifierGhgStatements,
  certifierProjects,
  certifierRemovals,
} from "@/db/schema/certification";
import { facilities } from "@/db/schema/facilities";
import { acquireFacilityDurabilityLock } from "@/data-access/facility-durability-lock";
import { markSubmissionRejected } from "@/data-access/certification";
import { updateFacility } from "@/data-access/facilities";
import { SafeError } from "@/lib/errors";
import { LOCK_TTL_MS } from "@/lib/isometric/utils/lock";

const USER_ID = "test-user-claim";
const PROVIDER = "isometric" as const;

// How long to let a parked claim reach the FOR UPDATE before mutating the
// ledger underneath it. Generous on purpose — a slow CI runner that hasn't
// parked yet would make the test trivially pass (the claim would see the
// mutation anyway), not flake.
const PARK_DELAY_MS = 200;
const STALE_LOCK_OFFSET_MS = LOCK_TTL_MS + 60_000;

const createdFacilityIds: string[] = [];
const createdEntityIds: string[] = [];

afterAll(async () => {
  if (createdEntityIds.length > 0) {
    await db
      .delete(certificationSubmissions)
      .where(inArray(certificationSubmissions.localEntityId, createdEntityIds));
  }
  if (createdFacilityIds.length === 0) return;
  await db
    .delete(certifierRemovals)
    .where(inArray(certifierRemovals.facilityId, createdFacilityIds));
  await db
    .delete(certifierGhgStatements)
    .where(inArray(certifierGhgStatements.facilityId, createdFacilityIds));
  await db
    .delete(certifierProjects)
    .where(inArray(certifierProjects.facilityId, createdFacilityIds));
  await db.delete(facilities).where(inArray(facilities.id, createdFacilityIds));
});

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

interface Fixture {
  facilityId: string;
  externalProjectId: string;
  key: SubmissionKey;
  guard: MappingClaimGuard;
  // External ids must be unique table-wide per (provider, submissionType)
  // (`cert_submissions_external_unique`), so scope them to the fixture.
  ext: (suffix: string) => string;
}

async function createFixture(
  entityType: "removal" | "ghgStatement" = "removal",
): Promise<Fixture> {
  const runId = crypto.randomUUID().slice(0, 8);
  const externalProjectId = `prj_claim_${runId}`;
  const [facility] = await db
    .insert(facilities)
    .values({
      organizationId: TEST_ORG_ID,
      name: `Claim Test Facility ${runId}`,
      code: `FAC-CL-${runId}`,
      durabilityOption: "200_year",
    })
    .returning({ id: facilities.id });
  createdFacilityIds.push(facility.id);
  await db.insert(certifierProjects).values({
    organizationId: TEST_ORG_ID,
    facilityId: facility.id,
    provider: PROVIDER,
    externalProjectId,
  });
  // The claim path proves its submission anchor belongs to the caller's org,
  // so each variant needs a real facility-scoped artifact row.
  const localEntityId =
    entityType === "removal"
      ? (
          await db
            .insert(certifierRemovals)
            .values({
              organizationId: TEST_ORG_ID,
              facilityId: facility.id,
              provider: PROVIDER,
            })
            .returning({ id: certifierRemovals.id })
        )[0].id
      : (
          await db
            .insert(certifierGhgStatements)
            .values({
              organizationId: TEST_ORG_ID,
              facilityId: facility.id,
              provider: PROVIDER,
              reportingPeriodEndOn: "2026-12-31",
            })
            .returning({ id: certifierGhgStatements.id })
        )[0].id;
  createdEntityIds.push(localEntityId);
  return {
    facilityId: facility.id,
    externalProjectId,
    key: {
      provider: PROVIDER,
      submissionType:
        entityType === "removal" ? "removal" : "ghg_statement",
      localEntityType: entityType,
      localEntityId,
    },
    guard: {
      facilityId: facility.id,
      provider: PROVIDER,
      expectedExternalProjectId: externalProjectId,
    },
    ext: (suffix: string) => `ext_${runId}_${suffix}`,
  };
}

interface TestInputs {
  value: string;
}

function hashOf(inputs: TestInputs): string {
  return `hash:${inputs.value}`;
}

function baseArgs(
  fixture: Fixture,
  overrides: Partial<ClaimSubmissionDraftArgs<TestInputs>> = {},
): ClaimSubmissionDraftArgs<TestInputs> {
  return {
    key: fixture.key,
    guard: fixture.guard,
    policy: { onSubmittedHashChanged: "supersede" },
    tentativeInputs: { value: "v-original" },
    hashOf,
    buildSnapshot: ({ inputs, nextVersion, supersedePreviousId, reason }) => ({
      payloadSnapshot: {
        semantic: inputs,
        builtFor: { nextVersion, supersedePreviousId, reason },
      },
    }),
    ...overrides,
  };
}

async function listRows(key: SubmissionKey) {
  return db
    .select()
    .from(certificationSubmissions)
    .where(
      and(
        eq(certificationSubmissions.provider, key.provider),
        eq(certificationSubmissions.submissionType, key.submissionType),
        eq(certificationSubmissions.localEntityType, key.localEntityType),
        eq(certificationSubmissions.localEntityId, key.localEntityId),
      ),
    )
    .orderBy(certificationSubmissions.version);
}

async function seedRow(
  key: SubmissionKey,
  args: {
    version: number;
    status: "draft" | "submitted" | "accepted" | "rejected" | "superseded";
    payloadHash: string;
    externalId?: string | null;
    lockedAt?: Date | null;
    metadata?: Record<string, unknown> | null;
  },
) {
  const [row] = await db
    .insert(certificationSubmissions)
    .values({
      organizationId: TEST_ORG_ID,
      ...key,
      version: args.version,
      status: args.status,
      payloadHash: args.payloadHash,
      externalId: args.externalId ?? null,
      lockedAt: args.lockedAt ?? null,
      payloadSnapshot: { semantic: { seeded: true } },
      metadata: args.metadata ?? null,
    })
    .returning();
  return row;
}

// Holds the facility's certifier-mapping row lock (the same FOR UPDATE the
// claim takes) while `during` runs, then releases by committing.
async function whileHoldingMappingLock(
  facilityId: string,
  during: () => Promise<void>,
): Promise<void> {
  await db.transaction(async (tx) => {
    await tx
      .select({ id: certifierProjects.id })
      .from(certifierProjects)
      .where(
        and(
          eq(certifierProjects.facilityId, facilityId),
          eq(certifierProjects.provider, PROVIDER),
        ),
      )
      .for("update")
      .limit(1);
    await during();
  });
}


beforeAll(() => ensureTestOrg());

describe("claimSubmissionDraft — create path", () => {
  it("claims a v=1 draft on first submit and persists the built snapshot", async () => {
    const fixture = await createFixture();

    const outcome = await claimSubmissionDraft(makeTestOrgContext(USER_ID), baseArgs(fixture));

    expect(outcome.kind).toBe("claimed");
    if (outcome.kind !== "claimed") throw new Error("unreachable");
    expect(outcome).toMatchObject({
      resumed: false,
      supersedePreviousId: null,
      reason: "first",
    });
    expect(outcome.row).toMatchObject({
      version: 1,
      status: "draft",
      payloadHash: "hash:v-original",
    });
    expect(outcome.row.lockedAt).not.toBeNull();

    const rows = await listRows(fixture.key);
    expect(rows).toHaveLength(1);
    expect(rows[0].payloadSnapshot).toMatchObject({
      semantic: { value: "v-original" },
      builtFor: { nextVersion: 1, supersedePreviousId: null, reason: "first" },
    });
  });

  it("supersedes a submitted row with a different hash and forwards its id", async () => {
    const fixture = await createFixture();
    const prior = await seedRow(fixture.key, {
      version: 1,
      status: "submitted",
      payloadHash: "hash:v-old",
      externalId: fixture.ext("v1"),
    });

    const outcome = await claimSubmissionDraft(makeTestOrgContext(USER_ID), baseArgs(fixture));

    expect(outcome).toMatchObject({
      kind: "claimed",
      resumed: false,
      supersedePreviousId: prior.id,
      reason: "submitted-hash-changed",
    });
    if (outcome.kind !== "claimed") throw new Error("unreachable");
    expect(outcome.row.version).toBe(2);
  });

  it("returns existing for a submitted row with the same hash", async () => {
    const fixture = await createFixture();
    await seedRow(fixture.key, {
      version: 1,
      status: "submitted",
      payloadHash: "hash:v-original",
      externalId: fixture.ext("v1"),
    });

    const outcome = await claimSubmissionDraft(makeTestOrgContext(USER_ID), baseArgs(fixture));

    expect(outcome).toEqual({
      kind: "existing",
      externalId: fixture.ext("v1"),
      version: 1,
    });
    expect(await listRows(fixture.key)).toHaveLength(1);
  });

  it("blocks instead of superseding under the invalid-changed-hash policy", async () => {
    const fixture = await createFixture();
    await seedRow(fixture.key, {
      version: 1,
      status: "submitted",
      payloadHash: "hash:v-old",
      externalId: fixture.ext("v1"),
    });

    const outcome = await claimSubmissionDraft(
      makeTestOrgContext(USER_ID),
      baseArgs(fixture, {
        policy: { onSubmittedHashChanged: "invalid-changed-hash" },
      }),
    );

    expect(outcome).toEqual({ kind: "blocked", reason: "invalid-changed-hash" });
  });

  it("blocks a rejected row that already has an external id", async () => {
    const fixture = await createFixture();
    await seedRow(fixture.key, {
      version: 1,
      status: "rejected",
      payloadHash: "hash:v-original",
      externalId: fixture.ext("v1"),
    });

    const outcome = await claimSubmissionDraft(makeTestOrgContext(USER_ID), baseArgs(fixture));

    expect(outcome).toEqual({
      kind: "blocked",
      reason: "rejected-with-external",
    });
  });
});

describe("claimSubmissionDraft — concurrency (the GHG drift regression)", () => {
  it("two concurrent claims on one key: exactly one claimed, one blocked in-flight, one row", async () => {
    const fixture = await createFixture();

    const [a, b] = await Promise.all([
      claimSubmissionDraft(makeTestOrgContext(USER_ID), baseArgs(fixture)),
      claimSubmissionDraft(makeTestOrgContext(USER_ID), baseArgs(fixture)),
    ]);

    const kinds = [a, b].map((o) => o.kind).sort();
    expect(kinds).toEqual(["blocked", "claimed"]);
    const blocked = [a, b].find((o) => o.kind === "blocked");
    expect(blocked).toEqual({ kind: "blocked", reason: "in-flight" });

    const rows = await listRows(fixture.key);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ version: 1, status: "draft" });
  });

  it("resolves to existing when the latest flips to submitted-with-same-hash while parked on the mapping lock", async () => {
    const fixture = await createFixture();

    let claimPromise!: Promise<ClaimOutcome>;
    await whileHoldingMappingLock(fixture.facilityId, async () => {
      // Tentative decide sees an empty ledger → create path → parks on the
      // mapping lock we are holding.
      claimPromise = claimSubmissionDraft(makeTestOrgContext(USER_ID), baseArgs(fixture));
      await sleep(PARK_DELAY_MS);
      // A concurrent submit completes meanwhile: same payload hash, with an
      // external id (markSubmissionSubmitted does not take the mapping lock).
      await seedRow(fixture.key, {
        version: 1,
        status: "submitted",
        payloadHash: "hash:v-original",
        externalId: fixture.ext("concurrent"),
      });
    });

    const outcome = await claimPromise;
    expect(outcome).toEqual({
      kind: "existing",
      externalId: fixture.ext("concurrent"),
      version: 1,
    });
    // No orphan draft: the prepared create was discarded.
    const rows = await listRows(fixture.key);
    expect(rows).toHaveLength(1);
    expect(rows[0].status).toBe("submitted");
  });

  it("returns blocked state-changed when the in-lock re-decision says resume after preparing a create", async () => {
    const fixture = await createFixture();

    let claimPromise!: Promise<ClaimOutcome>;
    await whileHoldingMappingLock(fixture.facilityId, async () => {
      claimPromise = claimSubmissionDraft(makeTestOrgContext(USER_ID), baseArgs(fixture));
      await sleep(PARK_DELAY_MS);
      // A concurrent attempt claimed a draft and then failed without an
      // external id → its row is rejected with our hash → in-lock decide
      // says "resume", which the prepared create cannot absorb.
      await seedRow(fixture.key, {
        version: 1,
        status: "rejected",
        payloadHash: "hash:v-original",
      });
    });

    const outcome = await claimPromise;
    expect(outcome).toEqual({ kind: "blocked", reason: "state-changed" });
    expect(await listRows(fixture.key)).toHaveLength(1);
  });

  it.each(["removal", "ghgStatement"] as const)(
    "serializes a tier edit behind a %s claim and rejects the stale edit",
    async (entityType) => {
      const fixture = await createFixture(entityType);
      let releaseResolve!: () => void;
      let markResolveStarted!: () => void;
      const resolveStarted = new Promise<void>((resolve) => {
        markResolveStarted = resolve;
      });
      const resolveRelease = new Promise<void>((resolve) => {
        releaseResolve = resolve;
      });

      const claimPromise = claimSubmissionDraft(
        makeTestOrgContext(USER_ID),
        baseArgs(fixture, {
          resolve: async (_tx, tentative) => {
            markResolveStarted();
            await resolveRelease;
            return tentative;
          },
        }),
      );

      // `resolve` runs after facility + mapping + artifact locks. Hold it there
      // while the tier edit reads the old tier and parks on the shared lock.
      await resolveStarted;
      let tierEditSettled = false;
      const tierEditPromise = updateFacility(
        makeTestOrgContext(USER_ID),
        fixture.facilityId,
        { durabilityOption: "1000_year" },
      );
      tierEditPromise.then(
        () => {
          tierEditSettled = true;
        },
        () => {
          tierEditSettled = true;
        },
      );
      await sleep(PARK_DELAY_MS);
      expect(tierEditSettled).toBe(false);

      releaseResolve();
      await expect(claimPromise).resolves.toMatchObject({ kind: "claimed" });
      await expect(tierEditPromise).rejects.toMatchObject({
        message: expect.stringMatching(/durability tier/i),
      });

      const [facility] = await db
        .select({ durabilityOption: facilities.durabilityOption })
        .from(facilities)
        .where(eq(facilities.id, fixture.facilityId));
      expect(facility.durabilityOption).toBe("200_year");
      expect(await listRows(fixture.key)).toHaveLength(1);
    },
  );

  it("rejects a Removal claim prepared before a tier edit that commits first", async () => {
    const fixture = await createFixture();
    const ctx = makeTestOrgContext(USER_ID);
    let claimPromise!: Promise<ClaimOutcome>;

    await db.transaction(async (tx) => {
      await acquireFacilityDurabilityLock(ctx, tx, fixture.facilityId);
      claimPromise = claimSubmissionDraft(
        ctx,
        baseArgs(fixture, {
          guard: {
            ...fixture.guard,
            expectedDurabilityOption: "200_year",
          },
        }),
      );
      claimPromise.catch(() => {});
      await sleep(PARK_DELAY_MS);
      await tx
        .update(facilities)
        .set({ durabilityOption: "1000_year" })
        .where(eq(facilities.id, fixture.facilityId));
    });

    await expect(claimPromise).rejects.toMatchObject({
      message: expect.stringMatching(/durability tier changed/i),
    });
    expect(await listRows(fixture.key)).toHaveLength(0);
  });
});

describe("claimSubmissionDraft — in-lock re-resolution", () => {
  it("inserts the recomputed hash and snapshot when resolve shifts the inputs", async () => {
    const fixture = await createFixture();

    const outcome = await claimSubmissionDraft(
      makeTestOrgContext(USER_ID),
      baseArgs(fixture, {
        resolve: async (_tx, tentative) => ({
          value: `${tentative.value}-shifted`,
        }),
      }),
    );

    expect(outcome.kind).toBe("claimed");
    if (outcome.kind !== "claimed") throw new Error("unreachable");
    expect(outcome.row.payloadHash).toBe("hash:v-original-shifted");
    expect(outcome.row.version).toBe(1);
    expect(outcome.row.payloadSnapshot).toMatchObject({
      semantic: { value: "v-original-shifted" },
    });
  });

  it("re-decides against the shifted hash: matching submitted row → existing", async () => {
    const fixture = await createFixture();
    // The tentative hash differs from this row (so the fast path would
    // supersede), but the locked re-resolution shifts the inputs back to
    // the submitted content → authoritative decision is return-existing.
    await seedRow(fixture.key, {
      version: 1,
      status: "submitted",
      payloadHash: "hash:v-shifted",
      externalId: fixture.ext("v1"),
    });

    const outcome = await claimSubmissionDraft(
      makeTestOrgContext(USER_ID),
      baseArgs(fixture, {
        resolve: async () => ({ value: "v-shifted" }),
      }),
    );

    expect(outcome).toEqual({
      kind: "existing",
      externalId: fixture.ext("v1"),
      version: 1,
    });
    expect(await listRows(fixture.key)).toHaveLength(1);
  });
});

describe("claimSubmissionDraft — resume", () => {
  it("CAS-resumes a TTL-stale draft without calling resolve or buildSnapshot", async () => {
    const fixture = await createFixture();
    const staleLockedAt = new Date(Date.now() - STALE_LOCK_OFFSET_MS);
    const seeded = await seedRow(fixture.key, {
      version: 1,
      status: "draft",
      payloadHash: "hash:v-original",
      lockedAt: staleLockedAt,
      metadata: {
        lastError: "Previous attempt failed",
        lastAttemptOutcome: "interrupted",
        externalMutation: "possible",
        retained: true,
      },
    });

    let resolveCalled = false;
    let buildSnapshotCalled = false;
    const outcome = await claimSubmissionDraft(
      makeTestOrgContext(USER_ID),
      baseArgs(fixture, {
        resolve: async (_tx, tentative) => {
          resolveCalled = true;
          return tentative;
        },
        buildSnapshot: () => {
          buildSnapshotCalled = true;
          return { payloadSnapshot: { semantic: { fresh: true } } };
        },
      }),
    );

    expect(outcome).toMatchObject({
      kind: "claimed",
      resumed: true,
      supersedePreviousId: null,
      reason: "resumed",
    });
    if (outcome.kind !== "claimed") throw new Error("unreachable");
    expect(outcome.row.id).toBe(seeded.id);
    expect(outcome.row.status).toBe("draft");
    expect(outcome.row.lockedAt!.getTime()).toBeGreaterThan(
      staleLockedAt.getTime(),
    );
    // The stored payloadSnapshot stays authoritative on resume.
    expect(resolveCalled).toBe(false);
    expect(buildSnapshotCalled).toBe(false);
    expect(outcome.row.payloadSnapshot).toMatchObject({
      semantic: { seeded: true },
    });
    expect(outcome.row.metadata).toEqual({
      externalMutation: "possible",
      retained: true,
    });
  });

  it("blocks in-flight when the lock is still fresh", async () => {
    const fixture = await createFixture();
    await seedRow(fixture.key, {
      version: 1,
      status: "draft",
      payloadHash: "hash:v-original",
      lockedAt: new Date(),
    });

    const outcome = await claimSubmissionDraft(makeTestOrgContext(USER_ID), baseArgs(fixture));
    expect(outcome).toEqual({ kind: "blocked", reason: "in-flight" });
  });

  it("atomically reclaims a fresh interrupted draft exactly once", async () => {
    const fixture = await createFixture();
    const seeded = await seedRow(fixture.key, {
      version: 1,
      status: "draft",
      payloadHash: "hash:v-original",
      lockedAt: new Date(),
      metadata: {
        lastError: "The request ended after registry work began",
        lastAttemptOutcome: "interrupted",
        externalMutation: "possible",
        retained: true,
      },
    });

    const [first, second] = await Promise.all([
      claimSubmissionDraft(makeTestOrgContext(USER_ID), baseArgs(fixture)),
      claimSubmissionDraft(makeTestOrgContext(USER_ID), baseArgs(fixture)),
    ]);
    const outcomes = [first, second];

    expect(outcomes.filter((outcome) => outcome.kind === "claimed")).toHaveLength(1);
    expect(outcomes.filter((outcome) => outcome.kind === "blocked")).toEqual([
      { kind: "blocked", reason: "in-flight" },
    ]);
    const claimed = outcomes.find((outcome) => outcome.kind === "claimed");
    expect(claimed).toMatchObject({
      kind: "claimed",
      resumed: true,
      row: {
        id: seeded.id,
        payloadSnapshot: { semantic: { seeded: true } },
        metadata: { externalMutation: "possible", retained: true },
      },
    });
  });

  it("atomically resets a fresh interrupted telemetry draft exactly once", async () => {
    const fixture = await createFixture();
    const telemetryKey = { ...fixture.key, submissionType: "dataUpload" };
    const seeded = await seedRow(telemetryKey, {
      version: 1,
      status: "draft",
      payloadHash: "hash:v-original",
      lockedAt: new Date(),
      metadata: {
        lastAttemptOutcome: "interrupted",
        externalMutation: "possible",
      },
    });

    const attempts = await Promise.allSettled([
      resetSubmissionToDraftWithMappingLock(
        makeTestOrgContext(USER_ID),
        seeded.id,
        fixture.guard,
        LOCK_TTL_MS,
      ),
      resetSubmissionToDraftWithMappingLock(
        makeTestOrgContext(USER_ID),
        seeded.id,
        fixture.guard,
        LOCK_TTL_MS,
      ),
    ]);

    expect(attempts.filter((attempt) => attempt.status === "fulfilled")).toHaveLength(1);
    expect(attempts.filter((attempt) => attempt.status === "rejected")).toHaveLength(1);
    const [stored] = await listRows(telemetryKey);
    expect(stored).toMatchObject({
      id: seeded.id,
      status: "draft",
      metadata: { externalMutation: "possible" },
    });
    expect(stored.metadata).not.toHaveProperty("lastAttemptOutcome");
  });

  it("resolves to existing — not a draft revert — when the row flips to submitted while parked in the resume path", async () => {
    const fixture = await createFixture();
    const seeded = await seedRow(fixture.key, {
      version: 1,
      status: "draft",
      payloadHash: "hash:v-original",
      lockedAt: new Date(Date.now() - STALE_LOCK_OFFSET_MS),
    });

    let claimPromise!: Promise<ClaimOutcome>;
    await whileHoldingMappingLock(fixture.facilityId, async () => {
      // Tentative decide sees the stale draft → resume path → parks on the
      // mapping lock inside the resume transaction.
      claimPromise = claimSubmissionDraft(makeTestOrgContext(USER_ID), baseArgs(fixture));
      await sleep(PARK_DELAY_MS);
      // A concurrent claimant resumed the draft AND completed: the row is
      // now submitted with our hash. The broad CAS predicate alone
      // (status != draft) would happily revert it to draft — only the
      // in-lock re-decision prevents that.
      await db
        .update(certificationSubmissions)
        .set({
          status: "submitted",
          externalId: fixture.ext("winner"),
          lockedAt: null,
        })
        .where(eq(certificationSubmissions.id, seeded.id));
    });

    const outcome = await claimPromise;
    expect(outcome).toEqual({
      kind: "existing",
      externalId: fixture.ext("winner"),
      version: 1,
    });
    const rows = await listRows(fixture.key);
    expect(rows).toHaveLength(1);
    expect(rows[0].status).toBe("submitted");
    expect(rows[0].lockedAt).toBeNull();
  });

  it("loses the resume CAS to a concurrent claimant that re-locked the row", async () => {
    const fixture = await createFixture();
    const seeded = await seedRow(fixture.key, {
      version: 1,
      status: "draft",
      payloadHash: "hash:v-original",
      lockedAt: new Date(Date.now() - STALE_LOCK_OFFSET_MS),
    });

    let claimPromise!: Promise<ClaimOutcome>;
    await whileHoldingMappingLock(fixture.facilityId, async () => {
      // Tentative decide sees the stale draft → resume path → parks on the
      // mapping lock inside the resume transaction.
      claimPromise = claimSubmissionDraft(makeTestOrgContext(USER_ID), baseArgs(fixture));
      await sleep(PARK_DELAY_MS);
      // A concurrent claimant wins the race and re-locks the draft.
      await db
        .update(certificationSubmissions)
        .set({ lockedAt: new Date() })
        .where(eq(certificationSubmissions.id, seeded.id));
    });

    const outcome = await claimPromise;
    expect(outcome).toEqual({ kind: "blocked", reason: "in-flight" });
  });

  it("does not let stale rejection cleanup unlock a successor attempt", async () => {
    const fixture = await createFixture();
    const firstLock = new Date(Date.now() - STALE_LOCK_OFFSET_MS);
    const seeded = await seedRow(fixture.key, {
      version: 1,
      status: "draft",
      payloadHash: "hash:v-original",
      lockedAt: firstLock,
    });
    const successorLock = new Date();
    await db
      .update(certificationSubmissions)
      .set({ lockedAt: successorLock })
      .where(eq(certificationSubmissions.id, seeded.id));

    await markSubmissionRejected(makeTestOrgContext(USER_ID), seeded.id, {
      errorMessage: "stale attempt failed",
      expectedLockedAt: firstLock,
    });

    const [row] = await listRows(fixture.key);
    expect(row.status).toBe("draft");
    expect(row.lockedAt?.getTime()).toBe(successorLock.getTime());
  });
});

describe("claimSubmissionDraft — mapping guard", () => {
  it("throws SafeError when the facility was repointed to another project", async () => {
    const fixture = await createFixture();

    const claim = claimSubmissionDraft(
      makeTestOrgContext(USER_ID),
      baseArgs(fixture, {
        guard: { ...fixture.guard, expectedExternalProjectId: "prj_other" },
      }),
    );
    await expect(claim).rejects.toBeInstanceOf(SafeError);
    await expect(claim).rejects.toMatchObject({
      message: expect.stringMatching(/repointed/i),
    });
    expect(await listRows(fixture.key)).toHaveLength(0);
  });

  it("throws SafeError when the repoint lands while parked on the mapping lock", async () => {
    const fixture = await createFixture();

    // Deterministic mid-claim repoint: the holder takes the mapping lock,
    // the claim's tentative decide passes (project still matches) and parks
    // on the lock, then the HOLDER repoints the row before committing — so
    // the claim acquires the lock only after the repoint is committed.
    let claimPromise!: Promise<ClaimOutcome>;
    await db.transaction(async (tx) => {
      await tx
        .select({ id: certifierProjects.id })
        .from(certifierProjects)
        .where(
          and(
            eq(certifierProjects.facilityId, fixture.facilityId),
            eq(certifierProjects.provider, PROVIDER),
          ),
        )
        .for("update")
        .limit(1);
      claimPromise = claimSubmissionDraft(makeTestOrgContext(USER_ID), baseArgs(fixture));
      // The claim can reject in the window between the repoint committing and
      // the `.rejects` expectation below attaching — pre-attach a no-op
      // handler so the runner never sees an unhandled rejection (flaked in
      // CI). `expect(...).rejects` still observes the rejection.
      claimPromise.catch(() => {});
      await sleep(PARK_DELAY_MS);
      await tx
        .update(certifierProjects)
        .set({ externalProjectId: "prj_repointed" })
        .where(
          and(
            eq(certifierProjects.facilityId, fixture.facilityId),
            eq(certifierProjects.provider, PROVIDER),
          ),
        );
    });

    await expect(claimPromise).rejects.toMatchObject({
      message: expect.stringMatching(/repointed/i),
    });
    expect(await listRows(fixture.key)).toHaveLength(0);
  });

  it("throws SafeError when the facility is no longer linked", async () => {
    const fixture = await createFixture();
    await db
      .delete(certifierProjects)
      .where(eq(certifierProjects.facilityId, fixture.facilityId));

    await expect(
      claimSubmissionDraft(makeTestOrgContext(USER_ID), baseArgs(fixture)),
    ).rejects.toMatchObject({
      message: expect.stringMatching(/no longer linked/i),
    });
  });
});
