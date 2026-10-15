import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { eq, inArray } from "drizzle-orm";
import { db } from "@/db";
import { activityEvents, certificationSubmissions, organizations, users } from "@/db/schema";
import { listSubmissionStatusHistory } from "@/data-access/submission-status-history";
import { CERTIFICATION_STATUS_RECORDING_STARTED_AT } from "@/config/certification";
import type { OrgContext } from "@/lib/auth/server";

// Runs just before the status-event read, so a test can commit a concurrent
// status change between the ledger read and the event read.
const beforeEventRead = vi.hoisted(() => ({ hook: null as null | (() => Promise<void>) }));
vi.mock("@/data-access/activity-events", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/data-access/activity-events")>();
  return {
    ...actual,
    listEntityActivity: async (...args: Parameters<typeof actual.listEntityActivity>) => {
      const hook = beforeEventRead.hook;
      beforeEventRead.hook = null;
      if (hook) await hook();
      return actual.listEntityActivity(...args);
    },
  };
});

const AFTER_RECORDING = new Date("2026-10-16T08:00:00Z");
const BEFORE_RECORDING = new Date("2026-09-01T08:00:00Z");
const MINUTE_MS = 60_000;
const at = (base: Date, minutes: number) => new Date(base.getTime() + minutes * MINUTE_MS);

let orgA: OrgContext;
let orgB: OrgContext;
let actorId: string;

function orgContext(id: string, userId: string): OrgContext {
  return { organizationId: id, userId, orgRole: "owner", isPlatformAdmin: false };
}

beforeEach(async () => {
  const suffix = crypto.randomUUID();
  actorId = `status-history-actor-${suffix}`;
  orgA = orgContext(`org_history_a_${suffix}`, actorId);
  orgB = orgContext(`org_history_b_${suffix}`, actorId);
  await db.insert(organizations).values([
    { id: orgA.organizationId, name: "History A", slug: orgA.organizationId },
    { id: orgB.organizationId, name: "History B", slug: orgB.organizationId },
  ]);
  await db.insert(users).values({ id: actorId, email: `${actorId}@example.test`, name: "Ada Operator" });
});

afterEach(async () => {
  const orgIds = [orgA.organizationId, orgB.organizationId];
  await db.delete(activityEvents).where(inArray(activityEvents.organizationId, orgIds));
  await db.delete(certificationSubmissions).where(inArray(certificationSubmissions.organizationId, orgIds));
  await db.delete(organizations).where(inArray(organizations.id, orgIds));
  await db.delete(users).where(eq(users.id, actorId));
});

async function ledgerRow(ctx: OrgContext, values: Partial<typeof certificationSubmissions.$inferInsert> & { localEntityId: string }) {
  const [row] = await db.insert(certificationSubmissions).values({
    organizationId: ctx.organizationId,
    submissionType: "removal",
    localEntityType: "removal",
    status: "draft",
    ...values,
  }).returning();
  return row;
}

async function statusEvent(
  ctx: OrgContext,
  values: Partial<typeof activityEvents.$inferInsert> & {
    entityId: string;
    occurredAt: Date;
    submission?: { id: string; version: number; submissionType?: string };
  },
) {
  const { submission, ...rest } = values;
  await db.insert(activityEvents).values({
    organizationId: ctx.organizationId,
    entityType: "removal",
    action: "status_changed",
    source: "form",
    actorUserId: actorId,
    submissionRef: submission
      ? { provider: "isometric", submissionType: submission.submissionType ?? "removal", submissionId: submission.id, version: submission.version }
      : null,
    ...rest,
  });
}

describe("listSubmissionStatusHistory", () => {
  it("merges ledger versions with recorded changes, newest first, without duplicates", async () => {
    const removalId = crypto.randomUUID();
    const v1 = await ledgerRow(orgA, {
      localEntityId: removalId, version: 1, status: "superseded",
      createdAt: AFTER_RECORDING, submittedAt: at(AFTER_RECORDING, 1),
      supersededAt: at(AFTER_RECORDING, 30), updatedAt: at(AFTER_RECORDING, 30),
    });
    const v2 = await ledgerRow(orgA, {
      localEntityId: removalId, version: 2, status: "submitted",
      createdAt: at(AFTER_RECORDING, 29), submittedAt: at(AFTER_RECORDING, 30), updatedAt: at(AFTER_RECORDING, 30),
    });
    await statusEvent(orgA, { entityId: removalId, occurredAt: at(AFTER_RECORDING, 1), fromStatus: "draft", toStatus: "submitted", submission: { id: v1.id, version: 1 } });
    await statusEvent(orgA, { entityId: removalId, occurredAt: at(AFTER_RECORDING, 30), fromStatus: "submitted", toStatus: "superseded", submission: { id: v1.id, version: 1 } });
    await statusEvent(orgA, { entityId: removalId, occurredAt: at(AFTER_RECORDING, 30), fromStatus: "draft", toStatus: "submitted", submission: { id: v2.id, version: 2 } });

    const history = await listSubmissionStatusHistory(orgA, "removal", removalId);

    expect(history.recordingBeganAt).toBeNull();
    expect(history.entries.map(({ label, version, origin, actorName }) => ({ label, version, origin, actorName }))).toEqual([
      { label: "Submitted", version: 2, origin: "activity", actorName: "Ada Operator" },
      { label: "Not submitted", version: 2, origin: "ledger", actorName: null },
      { label: "Submitted", version: 1, origin: "activity", actorName: "Ada Operator" },
      { label: "Not submitted", version: 1, origin: "ledger", actorName: null },
    ]);
    expect(history.entries.map((entry) => entry.occurredAt)).toEqual([
      at(AFTER_RECORDING, 30), at(AFTER_RECORDING, 29), at(AFTER_RECORDING, 1), AFTER_RECORDING,
    ]);
  });

  it("labels GHG Statement remote changes and keeps actorless registry events", async () => {
    const statementId = crypto.randomUUID();
    const row = await ledgerRow(orgA, {
      localEntityId: statementId, localEntityType: "ghgStatement", submissionType: "ghg_statement",
      version: 1, status: "accepted", metadata: { remoteStatus: "VERIFIED" },
      createdAt: AFTER_RECORDING, submittedAt: at(AFTER_RECORDING, 5), updatedAt: at(AFTER_RECORDING, 60),
    });
    const submission = { id: row.id, version: 1, submissionType: "ghg_statement" };
    const statementEvent = { entityId: statementId, entityType: "ghg_statement" as const, submission };
    await statusEvent(orgA, { ...statementEvent, occurredAt: at(AFTER_RECORDING, 5), fromStatus: "draft", toStatus: "submitted", fromRemote: null, toRemote: "DRAFT" });
    await statusEvent(orgA, { ...statementEvent, occurredAt: at(AFTER_RECORDING, 20), source: "registry", fromStatus: "submitted", toStatus: "submitted", fromRemote: "DRAFT", toRemote: "AWAITING_VERIFICATION" });
    await statusEvent(orgA, { ...statementEvent, occurredAt: at(AFTER_RECORDING, 60), source: "registry", actorUserId: null, fromStatus: "submitted", toStatus: "accepted", fromRemote: "AWAITING_VERIFICATION", toRemote: "VERIFIED" });

    const history = await listSubmissionStatusHistory(orgA, "ghg_statement", statementId);

    expect(history.entries.map(({ label, source, actorName, actorUnavailable }) => ({ label, source, actorName, actorUnavailable }))).toEqual([
      { label: "Verified", source: "registry", actorName: null, actorUnavailable: false },
      { label: "In verification", source: "registry", actorName: "Ada Operator", actorUnavailable: false },
      { label: "In registry", source: "form", actorName: "Ada Operator", actorUnavailable: false },
      { label: "Draft", source: null, actorName: null, actorUnavailable: false },
    ]);
  });

  it("reads another organization's record as empty and ignores its events", async () => {
    const removalId = crypto.randomUUID();
    const row = await ledgerRow(orgA, {
      localEntityId: removalId, version: 1, status: "submitted",
      createdAt: AFTER_RECORDING, submittedAt: at(AFTER_RECORDING, 1), updatedAt: at(AFTER_RECORDING, 1),
    });
    await statusEvent(orgA, { entityId: removalId, occurredAt: at(AFTER_RECORDING, 1), fromStatus: "draft", toStatus: "submitted", submission: { id: row.id, version: 1 } });
    // A foreign event that names the same record must not leak in either direction.
    await statusEvent(orgB, { entityId: removalId, occurredAt: at(AFTER_RECORDING, 10), fromStatus: "submitted", toStatus: "rejected", submission: { id: row.id, version: 1 } });

    const foreign = await listSubmissionStatusHistory(orgB, "removal", removalId);
    expect(foreign.entries.map((entry) => ({ label: entry.label, dated: entry.occurredAt !== null }))).toEqual([
      { label: "Submission failed", dated: true },
      // Its from-state, undated: org B knows nothing else about the record.
      { label: "Submitted", dated: false },
    ]);
    expect(foreign.recordingBeganAt).toBeNull();

    const own = await listSubmissionStatusHistory(orgA, "removal", removalId);
    expect(own.entries.map((entry) => entry.label)).toEqual(["Submitted", "Not submitted"]);

    const unrelated = await listSubmissionStatusHistory(orgB, "removal", crypto.randomUUID());
    expect(unrelated).toEqual({ entries: [], recordingBeganAt: null });
  });

  it("rebuilds a record with no events from the ledger and notes when recording began", async () => {
    const removalId = crypto.randomUUID();
    // Rejected before recording began; a later write without a status change
    // moved updatedAt past the ship date. Neither time dates the rejection.
    await ledgerRow(orgA, {
      localEntityId: removalId, version: 1, status: "rejected",
      createdAt: BEFORE_RECORDING, submittedAt: at(BEFORE_RECORDING, 2), updatedAt: AFTER_RECORDING,
    });

    const history = await listSubmissionStatusHistory(orgA, "removal", removalId);

    expect(history.recordingBeganAt).toEqual(new Date(CERTIFICATION_STATUS_RECORDING_STARTED_AT));
    expect(history.entries.map(({ label, occurredAt, origin }) => ({ label, occurredAt, origin }))).toEqual([
      { label: "Submission failed", occurredAt: null, origin: "ledger" },
      { label: "Submitted", occurredAt: at(BEFORE_RECORDING, 2), origin: "ledger" },
      { label: "Not submitted", occurredAt: BEFORE_RECORDING, origin: "ledger" },
    ]);
  });

  it("reads the ledger and events from one snapshot when a status change commits between them", async () => {
    const statementId = crypto.randomUUID();
    const row = await ledgerRow(orgA, {
      localEntityId: statementId, localEntityType: "ghgStatement", submissionType: "ghg_statement",
      version: 1, status: "submitted", metadata: { remoteStatus: "DRAFT" },
      createdAt: AFTER_RECORDING, submittedAt: at(AFTER_RECORDING, 5),
    });
    const submission = { id: row.id, version: 1, submissionType: "ghg_statement" };
    await statusEvent(orgA, {
      entityId: statementId, entityType: "ghg_statement", submission, occurredAt: at(AFTER_RECORDING, 5),
      fromStatus: "draft", toStatus: "submitted", fromRemote: null, toRemote: "DRAFT",
    });
    // The registry verifies it while the history is being read: ledger and
    // event commit together, as withCertificationStatusActivity writes them.
    beforeEventRead.hook = () => db.transaction(async (tx) => {
      await tx.update(certificationSubmissions)
        .set({ status: "accepted", metadata: { remoteStatus: "VERIFIED" } })
        .where(eq(certificationSubmissions.id, row.id));
      await tx.insert(activityEvents).values({
        organizationId: orgA.organizationId, entityType: "ghg_statement", entityId: statementId,
        action: "status_changed", source: "registry", actorUserId: actorId, occurredAt: at(AFTER_RECORDING, 60),
        fromStatus: "submitted", toStatus: "accepted", fromRemote: "DRAFT", toRemote: "VERIFIED",
        submissionRef: { provider: "isometric", submissionType: "ghg_statement", submissionId: row.id, version: 1 },
      });
    });

    const during = await listSubmissionStatusHistory(orgA, "ghg_statement", statementId);
    expect(beforeEventRead.hook).toBeNull();
    // Before the change, consistently: no Verified followed by a made-up reversal.
    expect(during.entries.map((entry) => entry.label)).toEqual(["In registry", "Draft"]);

    const after = await listSubmissionStatusHistory(orgA, "ghg_statement", statementId);
    expect(after.entries.map((entry) => entry.label)).toEqual(["Verified", "In registry", "Draft"]);
  });

  it("dates a registry change by the registry's own time", async () => {
    const statementId = crypto.randomUUID();
    const row = await ledgerRow(orgA, {
      localEntityId: statementId, localEntityType: "ghgStatement", submissionType: "ghg_statement",
      version: 1, status: "accepted", metadata: { remoteStatus: "CREDITS_ISSUED" },
      createdAt: AFTER_RECORDING, submittedAt: at(AFTER_RECORDING, 5),
    });
    const submission = { id: row.id, version: 1, submissionType: "ghg_statement" };
    const statementEvent = { entityId: statementId, entityType: "ghg_statement" as const, submission };
    await statusEvent(orgA, { ...statementEvent, occurredAt: at(AFTER_RECORDING, 5), fromStatus: "draft", toStatus: "submitted", toRemote: "DRAFT" });
    // Issued in the registry 30 minutes before noma's sync recorded it.
    await statusEvent(orgA, {
      ...statementEvent, occurredAt: at(AFTER_RECORDING, 90), registryAt: at(AFTER_RECORDING, 60), source: "registry",
      fromStatus: "submitted", toStatus: "accepted", fromRemote: "DRAFT", toRemote: "CREDITS_ISSUED",
    });

    const [issued] = (await listSubmissionStatusHistory(orgA, "ghg_statement", statementId)).entries;
    expect(issued).toMatchObject({ label: "Issued", occurredAt: at(AFTER_RECORDING, 60), source: "registry" });
  });

  it("returns nothing for a record that was never submitted", async () => {
    const history = await listSubmissionStatusHistory(orgA, "ghg_statement", crypto.randomUUID());
    expect(history).toEqual({ entries: [], recordingBeganAt: null });
  });

  it("marks an actor whose name can no longer be read", async () => {
    const removalId = crypto.randomUUID();
    const row = await ledgerRow(orgA, {
      localEntityId: removalId, version: 1, status: "submitted",
      createdAt: AFTER_RECORDING, submittedAt: at(AFTER_RECORDING, 1), updatedAt: at(AFTER_RECORDING, 1),
    });
    await statusEvent(orgA, {
      entityId: removalId, occurredAt: at(AFTER_RECORDING, 1), actorUserId: "deleted-user",
      fromStatus: "draft", toStatus: "submitted", submission: { id: row.id, version: 1 },
    });

    const [latest] = (await listSubmissionStatusHistory(orgA, "removal", removalId)).entries;
    expect(latest).toMatchObject({ label: "Submitted", actorName: null, actorUnavailable: true });
  });
});
