import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { activityEvents, certificationSubmissions, organizations } from "@/db/schema";
import {
  markSubmissionSubmitted, markSubmissionRejected, retireStaleSubmissionDraft,
  updateSubmissionMetadata, setSubmissionTerminalStatus, clearTerminalStatusForResubmit,
} from "@/data-access/certification";
import { applyGhgRemoteState } from "@/data-access/certifier-ghg-remote-state";
import { listEntityActivity } from "@/data-access/activity-events";
import type { OrgContext } from "@/lib/auth/server";
import type { GhgStatement } from "@/lib/isometric";

const LOCKED_AT = new Date("2026-10-15T10:00:00Z");
const REGISTRY_AT = "2026-10-14T10:00:00Z";
let ctx: OrgContext;
beforeEach(async () => {
  const id = `org_status_${crypto.randomUUID()}`;
  ctx = { organizationId: id, userId: "status-actor", orgRole: "owner", isPlatformAdmin: false };
  await db.insert(organizations).values({ id, name: "Status fixture", slug: id });
});
afterEach(async () => {
  await db.delete(activityEvents).where(eq(activityEvents.organizationId, ctx.organizationId));
  await db.delete(certificationSubmissions).where(eq(certificationSubmissions.organizationId, ctx.organizationId));
  await db.delete(organizations).where(eq(organizations.id, ctx.organizationId));
});
async function submission(overrides: Partial<typeof certificationSubmissions.$inferInsert> = {}) {
  const [row] = await db.insert(certificationSubmissions).values({
    organizationId: ctx.organizationId, localEntityType: "ghgStatement",
    localEntityId: crypto.randomUUID(), submissionType: "ghg_statement",
    status: "draft", lockedAt: LOCKED_AT, metadata: { remoteStatus: "DRAFT" }, ...overrides,
  }).returning();
  return row;
}
const events = (id: string) => listEntityActivity(ctx, "ghg_statement", id);

it.each([
  ["submit", "draft", "submitted", (id: string) => markSubmissionSubmitted(ctx, id, { externalId: crypto.randomUUID(), expectedLockedAt: LOCKED_AT })],
  ["retire", "draft", "superseded", (id: string) => retireStaleSubmissionDraft(ctx, id, { reason: "stale" })],
  ["reject", "draft", "rejected", (id: string) => markSubmissionRejected(ctx, id, { errorMessage: "Rejected", expectedLockedAt: LOCKED_AT })],
  ["terminal", "submitted", "accepted", (id: string) => setSubmissionTerminalStatus(ctx, id, { status: "accepted" })],
  ["resubmit", "accepted", "submitted", (id: string) => clearTerminalStatusForResubmit(ctx, id)],
] as const)("records exactly one %s transition", async (_name, fromStatus, toStatus, write) => {
  const row = await submission({ status: fromStatus });
  await write(row.id);
  const history = await events(row.localEntityId);
  expect(history).toHaveLength(1);
  expect(history[0]).toMatchObject({ action: "status_changed", entityType: "ghg_statement",
    entityId: row.localEntityId, fromStatus, toStatus, fromRemote: "DRAFT", toRemote: "DRAFT",
    actorUserId: ctx.userId, source: "form", registryAt: null, changedFields: [],
    submissionRef: { provider: row.provider, submissionType: row.submissionType, submissionId: row.id, version: row.version },
  });
});

it("records remote changes but ignores a same-status metadata refresh", async () => {
  const row = await submission();
  await updateSubmissionMetadata(ctx, row.id, { remoteStatus: "AWAITING_VERIFICATION" });
  await updateSubmissionMetadata(ctx, row.id, { remoteStatus: "AWAITING_VERIFICATION", reportUrl: "https://example.com" });
  const history = await events(row.localEntityId);
  expect(history).toHaveLength(1);
  expect(history[0]).toMatchObject({ fromStatus: "draft", toStatus: "draft", fromRemote: "DRAFT", toRemote: "AWAITING_VERIFICATION" });
});

it("records the superseded version too, only when its status changes", async () => {
  const previous = await submission({ status: "submitted" });
  const row = await submission({ localEntityId: previous.localEntityId, version: 2 });
  const args = { externalId: crypto.randomUUID(), supersedePreviousId: previous.id };
  await markSubmissionSubmitted(ctx, row.id, args);
  await markSubmissionSubmitted(ctx, row.id, args);
  const history = await events(row.localEntityId);
  expect(history).toHaveLength(2);
  expect(history).toEqual(expect.arrayContaining([
    expect.objectContaining({ fromStatus: "submitted", toStatus: "superseded", submissionRef: expect.objectContaining({ submissionId: previous.id }) }),
    expect.objectContaining({ fromStatus: "draft", toStatus: "submitted", submissionRef: expect.objectContaining({ submissionId: row.id }) }),
  ]));
});

it("lets only one concurrent submit write an event", async () => {
  const row = await submission();
  const args = { externalId: crypto.randomUUID(), expectedLockedAt: LOCKED_AT };
  const results = await Promise.allSettled([
    markSubmissionSubmitted(ctx, row.id, args), markSubmissionSubmitted(ctx, row.id, args),
  ]);
  expect(results.filter((result) => result.status === "fulfilled")).toHaveLength(1);
  expect(results.filter((result) => result.status === "rejected")).toHaveLength(1);
  expect(await events(row.localEntityId)).toHaveLength(1);
});

it("rolls the event and status back with the caller transaction", async () => {
  const row = await submission();
  await expect(db.transaction(async (tx) => {
    await markSubmissionSubmitted(ctx, row.id, { externalId: crypto.randomUUID() }, tx);
    expect(await tx.select().from(activityEvents).where(eq(activityEvents.organizationId, ctx.organizationId))).toHaveLength(1);
    throw new Error("Injected failure");
  })).rejects.toThrow("Injected failure");
  expect(await events(row.localEntityId)).toEqual([]);
  const [stored] = await db.select().from(certificationSubmissions).where(eq(certificationSubmissions.id, row.id));
  expect(stored.status).toBe("draft");
});

it.each(["VERIFIED", "CREDITS_ISSUED", "FAILED_VERIFICATION", "DRAFT"] as const)("attributes %s sync to the registry and triggering actor", async (status) => {
  const row = await submission({ status: "accepted", metadata: { remoteStatus: "AWAITING_VERIFICATION" } });
  const remote: GhgStatement = {
    project_id: "prj_fixture", verifier: null, removal_ids: [], credit_allocation: null,
    ghg_statement_report_url: null, pending_total_co2e_removed_kg: null,
    id: "ghg_fixture", status, submitted_at: REGISTRY_AT,
    credits_issued_at: status === "CREDITS_ISSUED" ? REGISTRY_AT : null,
    ghg_entry_ids: [], reporting_period_start_at: null, reporting_period_end_at: null,
  };
  await applyGhgRemoteState(ctx, row, remote);
  await applyGhgRemoteState(ctx, row, remote);
  const history = await events(row.localEntityId);
  expect(history).toHaveLength(1);
  expect(history[0]).toMatchObject({ source: "registry", actorUserId: ctx.userId,
    fromStatus: "accepted", toStatus: status === "DRAFT" ? "submitted" : status === "FAILED_VERIFICATION" ? "rejected" : "accepted",
    fromRemote: "AWAITING_VERIFICATION", toRemote: status, registryAt: status === "CREDITS_ISSUED" ? new Date(REGISTRY_AT) : null,
  });
});

it("records a nonterminal remote refresh with no invented registry time", async () => {
  const row = await submission({ status: "submitted" });
  const remote: GhgStatement = {
    project_id: "prj_fixture", verifier: null, removal_ids: [], credit_allocation: null,
    ghg_statement_report_url: null, pending_total_co2e_removed_kg: null,
    id: "ghg_fixture", status: "AWAITING_VERIFICATION", submitted_at: null, credits_issued_at: null,
    ghg_entry_ids: [], reporting_period_start_at: null, reporting_period_end_at: null,
  };
  await applyGhgRemoteState(ctx, row, remote);
  const history = await events(row.localEntityId);
  expect(history).toHaveLength(1);
  expect(history[0]).toMatchObject({ source: "registry", actorUserId: ctx.userId,
    fromStatus: "submitted", toStatus: "submitted", fromRemote: "DRAFT", toRemote: "AWAITING_VERIFICATION", registryAt: null,
  });
});

it("records concurrent metadata refreshes once", async () => {
  const row = await submission();
  await Promise.all([
    updateSubmissionMetadata(ctx, row.id, { remoteStatus: "AWAITING_VERIFICATION" }),
    updateSubmissionMetadata(ctx, row.id, { remoteStatus: "AWAITING_VERIFICATION" }),
  ]);
  expect(await events(row.localEntityId)).toHaveLength(1);
});

it.each([
  ["retire", (id: string) => retireStaleSubmissionDraft(ctx, id, { reason: "stale" })],
  ["reject", (id: string) => markSubmissionRejected(ctx, id, { errorMessage: "Rejected" })],
] as const)("does not record %s on an already submitted row", async (_name, write) => {
  const row = await submission({ status: "submitted" });
  await write(row.id);
  expect(await events(row.localEntityId)).toEqual([]);
});

it("locks the predecessor read until the earlier caller transaction commits", async () => {
  const row = await submission();
  let releaseA!: () => void;
  const holdA = new Promise<void>((resolve) => { releaseA = resolve; });
  let wroteA!: () => void;
  const writtenA = new Promise<void>((resolve) => { wroteA = resolve; });
  const transactionA = db.transaction(async (tx) => {
    await markSubmissionSubmitted(ctx, row.id, { externalId: crypto.randomUUID() }, tx);
    wroteA();
    await holdA;
  });
  let transactionB: Promise<void> | undefined;
  try {
    await Promise.race([writtenA, transactionA]);
    let lockObserved = false;
    let requestedLock!: () => void;
    const lockRequested = new Promise<void>((resolve) => { requestedLock = resolve; });
    transactionB = db.transaction(async (tx) => {
      // Observe the real query builder, without replacing its locking behavior.
      // Removing FOR UPDATE must fail even if scheduling otherwise hides the race.
      const originalSelect = tx.select.bind(tx);
      const select = () => originalSelect();
      const selectTarget: { select: typeof select } = tx;
      const selectSpy = vi.spyOn(selectTarget, "select").mockImplementation(() => {
        const builder = select();
        const from = builder.from.bind(builder);
        vi.spyOn(builder, "from").mockImplementation((...args) => {
          const query = from(...args);
          const lock = query.for.bind(query);
          vi.spyOn(query, "for").mockImplementation((...lockArgs) => {
            expect(lockArgs[0]).toBe("update");
            const locked = lock(...lockArgs);
            lockObserved = true;
            requestedLock();
            return locked;
          });
          return query;
        });
        return builder;
      });
      try {
        const transition = setSubmissionTerminalStatus(ctx, row.id, { status: "accepted" }, tx);
        if (!lockObserved) {
          releaseA();
          await transition;
          throw new Error("Transition did not request its predecessor lock");
        }
        await transition;
      } finally {
        selectSpy.mockRestore();
      }
    });
    await Promise.race([lockRequested, transactionB.then(() => {
      throw new Error("Transition completed without requesting its predecessor lock");
    })]);
  } finally {
    releaseA();
    await Promise.all([transactionA, transactionB]);
  }
  const history = await events(row.localEntityId);
  expect(history).toHaveLength(2);
  const first = history.find((event) => event.toStatus === "submitted");
  const second = history.find((event) => event.toStatus === "accepted");
  expect(first?.fromStatus).toBe("draft");
  expect(second?.fromStatus).toBe(first?.toStatus);
});

it("retains Certify submission evidence when a returned draft has no current submitted_at", async () => {
  const row = await submission({ status: "submitted", metadata: { submittedToVerifierAt: REGISTRY_AT } });
  const remote: GhgStatement = {
    project_id: "prj_fixture", verifier: null, removal_ids: [], credit_allocation: null,
    ghg_statement_report_url: null, pending_total_co2e_removed_kg: null,
    id: "ghg_fixture", status: "DRAFT", submitted_at: null, credits_issued_at: null,
    ghg_entry_ids: [], reporting_period_start_at: null, reporting_period_end_at: null,
  };
  await applyGhgRemoteState(ctx, row, remote);
  const [stored] = await db.select().from(certificationSubmissions).where(eq(certificationSubmissions.id, row.id));
  expect(stored.metadata).toMatchObject({ submittedToVerifierAt: REGISTRY_AT });
});
