import { beforeAll, expect, it } from "vitest";
import { db } from "@/db";
import { certificationSubmissions } from "@/db/schema";
import { listNomaSentRemovalsForRemoteEntries } from "@/data-access/removal-entry-correction";
import { ensureTestOrg, makeTestOrgContext } from "./helpers/test-org";
import { withLineageFixture } from "./helpers/certification-lineage-fixture";

const ctx = makeTestOrgContext();
const sentAt = new Date("2026-06-17T00:00:00Z");
beforeAll(() => ensureTestOrg());

it("flags E1 alone or alongside E2, but not E2 alone, using the real ledger", async () => {
  await withLineageFixture(async fixture => {
    const e1 = `entry-old-${fixture.removalId}`;
    const e2 = `entry-current-${fixture.removalId}`;
    const identity = { organizationId: ctx.organizationId, provider: "isometric" as const,
      localEntityType: "removal", localEntityId: fixture.removalId, submissionType: "removal" as const };
    await db.insert(certificationSubmissions).values([
      { ...identity, version: 1, status: "superseded", externalId: e1, submittedAt: sentAt, supersededAt: sentAt },
      { ...identity, version: 2, status: "submitted", externalId: e2, submittedAt: sentAt },
    ]);
    const lookup = (ids: string[]) => listNomaSentRemovalsForRemoteEntries(ctx, fixture.ghgStatementId!, ids);
    expect(await lookup([e1])).toEqual([expect.objectContaining({ id: fixture.removalId, isSuperseded: true })]);
    expect(await lookup([e2])).toEqual([expect.objectContaining({ id: fixture.removalId, isSuperseded: false })]);
    expect(await lookup([e1, e2])).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: fixture.removalId, isSuperseded: true }),
      expect.objectContaining({ id: fixture.removalId, isSuperseded: false }),
    ]));
    expect(await listNomaSentRemovalsForRemoteEntries({ ...ctx, organizationId: "other-org" }, fixture.ghgStatementId!, [e1, e2])).toEqual([]);
  }, "ghgStatement");
});

it.each(["draft", "rejected", "superseded"] as const)("does not mistake a newer unsent %s attempt for a replacement", async status => {
  await withLineageFixture(async fixture => {
    const e1 = `entry-old-${fixture.removalId}`;
    const identity = { organizationId: ctx.organizationId, provider: "isometric" as const,
      localEntityType: "removal", localEntityId: fixture.removalId, submissionType: "removal" as const };
    await db.insert(certificationSubmissions).values([
      { ...identity, version: 1, status: "superseded", externalId: e1, submittedAt: sentAt },
      { ...identity, version: 2, status, externalId: `attempt-${fixture.removalId}` },
    ]);
    expect(await listNomaSentRemovalsForRemoteEntries(ctx, fixture.ghgStatementId!, [e1]))
      .toEqual([expect.objectContaining({ id: fixture.removalId, isSuperseded: false })]);
  }, "ghgStatement");
});

it("does not flag a superseded row with no newer submission", async () => {
  await withLineageFixture(async fixture => {
    const externalId = `retired-${fixture.removalId}`;
    await db.insert(certificationSubmissions).values({ organizationId: ctx.organizationId, provider: "isometric",
      localEntityType: "removal", localEntityId: fixture.removalId, submissionType: "removal",
      version: 1, status: "superseded", externalId });
    expect(await listNomaSentRemovalsForRemoteEntries(ctx, fixture.ghgStatementId!, [externalId]))
      .toEqual([expect.objectContaining({ id: fixture.removalId, isSuperseded: false })]);
  }, "ghgStatement");
});

it.each(["submitted", "accepted"] as const)("does not infer supersession from a newer version when the listed row is %s", async status => {
  await withLineageFixture(async fixture => {
    const externalId = `listed-${fixture.removalId}`;
    const identity = { organizationId: ctx.organizationId, provider: "isometric" as const,
      localEntityType: "removal", localEntityId: fixture.removalId, submissionType: "removal" as const };
    await db.insert(certificationSubmissions).values([
      { ...identity, version: 1, status, externalId, submittedAt: sentAt },
      { ...identity, version: 2, status: "submitted", externalId: `newer-${fixture.removalId}`, submittedAt: sentAt },
    ]);
    expect(await listNomaSentRemovalsForRemoteEntries(ctx, fixture.ghgStatementId!, [externalId]))
      .toEqual([expect.objectContaining({ id: fixture.removalId, isSuperseded: false })]);
  }, "ghgStatement");
});
