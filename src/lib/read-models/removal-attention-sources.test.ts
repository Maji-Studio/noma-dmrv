import { beforeEach, describe, expect, it, vi } from "vitest";
import type { OrgContext } from "@/lib/auth/server";
import { removalAttentionRows } from "@/lib/certification/removal-attention";
import { logger } from "@/lib/log";

const mocks = vi.hoisted(() => ({
  rows: [] as Array<{ id: string; code: string; createdAt: Date; startedOn: null; completedOn: null }>,
  submissions: new Map<string, { status: string; lockedAt: null; metadata: null }>(),
  built: [] as string[],
  returnedIds: new Set<string>(),
  factsError: null as unknown,
  listError: null as unknown,
  submissionsError: null as unknown,
}));

vi.mock("@/data-access/certifier-removals", () => ({ listRemovalsForFacility: async () => { if (mocks.listError) throw mocks.listError; return mocks.rows; } }));
vi.mock("@/data-access/certification", () => ({ getLatestSubmissionsForEntities: async () => { if (mocks.submissionsError) throw mocks.submissionsError; return mocks.submissions; } }));
vi.mock("@/data-access/dashboard-returned-removals", () => ({ loadReturnedRemovalIds: async () => mocks.returnedIds }));
vi.mock("@/lib/certification/removal-entry-correction", () => ({
  correctionForRemoval: (id: string) => (id === "returned-open" ? { resubmitNeeded: true } : undefined),
}));
vi.mock("@/data-access/utils", () => ({ requireOrgScope: () => undefined }));
vi.mock("@/lib/isometric/utils/lock", () => ({ isLockedInFlight: () => false }));
vi.mock("@/lib/certification/from-submission", () => ({ isRemovalSubmissionInterruptedFromSubmission: () => false }));
vi.mock("@/lib/certification/certify-context-core", () => ({
  loadFacilityCertifierFacts: async () => { if (mocks.factsError) throw mocks.factsError; return {}; },
  resolveScopeForRemoval: async (_ctx: unknown, id: string) => { if (id === "scope-broken") throw new Error("scope failed"); return { id }; },
  buildRemovalContext: async (_ctx: unknown, scope: { id: string }) => {
    if (scope.id === "broken") throw new Error("build failed\nparams: Private Person", { cause: Object.assign(new Error("failure for private@example.com"), { code: "42P01" }) });
    mocks.built.push(scope.id);
    return { id: scope.id };
  },
}));
vi.mock("@/lib/certification/readiness-facts", () => ({ toRemovalReadinessFacts: (ctx: { id: string }) => { if (ctx.id === "facts-broken") throw new Error("facts failed"); return ctx; } }));
vi.mock("@/lib/certification/readiness", () => ({
  deriveRemovalReadiness: (facts: { id: string }) => {
    if (facts.id === "derivation-broken") throw new Error("readiness failed");
    return facts.id === "blocked" ? { state: "blocked", reasons: ["One.", "Two."] } : { state: "ready", reasons: [] };
  },
}));

import { loadRemovalAttentionSources } from "./removal-attention-sources";

const createdAt = new Date("2026-11-01T00:00:00Z");
const row = (id: string) => ({ id, code: `RM-${id}`, createdAt, startedOn: null, completedOn: null });

describe("loadRemovalAttentionSources", () => {
  beforeEach(() => {
    mocks.rows = [row("blocked"), row("ready"), row("sent")];
    mocks.submissions = new Map([["sent", { status: "submitted", lockedAt: null, metadata: null }]]);
    mocks.built = [];
    mocks.returnedIds = new Set();
    mocks.factsError = null;
    mocks.listError = null;
    mocks.submissionsError = null;
  });

  it("returns the readiness of each draft and leaves a submitted Removal out", async () => {
    const drafts = await loadRemovalAttentionSources({ organizationId: "org-1" } as OrgContext, "fac-1");
    expect(drafts.drafts.map((draft) => [draft.removalId, draft.readiness?.state])).toEqual([
      ["blocked", "blocked"],
      ["ready", "ready"],
    ]);
    expect(mocks.built).not.toContain("sent");
  });

  it("builds nothing when no Removal is a draft or returned", async () => {
    mocks.rows = [row("sent")];
    expect(await loadRemovalAttentionSources({ organizationId: "org-1" } as OrgContext, "fac-1")).toEqual({ drafts: [], rejected: [], returned: [] });
    expect(mocks.built).toEqual([]);
  });

  it("keeps a draft whose build rejects as Couldn't check and keeps the other readiness", async () => {
    const warn = vi.spyOn(logger, "warn").mockImplementation(() => undefined);
    mocks.rows = [row("broken"), row("ready")];
    const { drafts } = await loadRemovalAttentionSources({ organizationId: "org-1" } as OrgContext, "fac-1");
    expect(drafts.map((draft) => [draft.removalId, draft.readiness?.state])).toEqual([["broken", undefined], ["ready", "ready"]]);
    const rows = removalAttentionRows({ drafts, rejected: [], returned: [] }, "fac-1");
    expect(rows.drafts.map((draft) => draft.title)).toEqual(["Couldn't check. Open it to see what is left.", "Ready to submit"]);
    expect(rows.drafts[0].href).toContain("broken");
    expect(warn).toHaveBeenCalledExactlyOnceWith({
      facilityId: "fac-1", removalId: "broken", errorType: "Error", errorCode: "42P01",
      errorMessage: "build failed\nparams: [REDACTED]", errorCauseMessage: "failure for [REDACTED]",
    }, "Removal attention build failed");
  });

  it.each(["scope-broken", "facts-broken", "derivation-broken"])("keeps only %s unavailable when scope or readiness projection fails", async (id) => {
    vi.spyOn(logger, "warn").mockImplementation(() => undefined);
    mocks.rows = [row(id), row("ready")];
    const sources = await loadRemovalAttentionSources({ organizationId: "org-1" } as OrgContext, "fac-1");
    expect(removalAttentionRows(sources, "fac-1").drafts.map((draft) => draft.title)).toEqual([
      "Couldn't check. Open it to see what is left.", "Ready to submit",
    ]);
  });

  it("keeps returned build failures best effort while retaining a ready draft", async () => {
    vi.spyOn(logger, "warn").mockImplementation(() => undefined);
    mocks.rows = [row("broken"), row("ready")];
    mocks.submissions.set("broken", { status: "submitted", lockedAt: null, metadata: null });
    mocks.returnedIds.add("broken");
    const sources = await loadRemovalAttentionSources({ organizationId: "org-1" } as OrgContext, "fac-1");
    expect(sources.returned).toEqual([]);
    expect(removalAttentionRows(sources, "fac-1").drafts.map((draft) => draft.title)).toEqual(["Ready to submit"]);
  });

  it("keeps every draft as Couldn't check when shared facility facts fail, retaining rejected rows", async () => {
    const warn = vi.spyOn(logger, "warn").mockImplementation(() => undefined);
    mocks.rows.push(row("bounced"));
    mocks.submissions.set("bounced", { status: "rejected", lockedAt: null, metadata: null });
    mocks.returnedIds = new Set(["sent"]);
    mocks.factsError = new Error("facts unavailable\nparams: Private Person", { cause: Object.assign(new Error("failure for private@example.com"), { code: "42P01" }) });
    const sources = await loadRemovalAttentionSources({ organizationId: "org-1" } as OrgContext, "fac-1");
    const rows = removalAttentionRows(sources, "fac-1");
    expect(rows.drafts.map((draft) => [draft.entityCode, draft.title])).toEqual([
      ["RM-blocked", "Couldn't check. Open it to see what is left."],
      ["RM-ready", "Couldn't check. Open it to see what is left."],
    ]);
    expect(rows.rejected.map((removal) => removal.entityCode)).toEqual(["RM-bounced"]);
    expect(rows.returned).toEqual([]);
    expect(mocks.built).toEqual([]);
    expect(warn).toHaveBeenCalledExactlyOnceWith({
      facilityId: "fac-1", errorType: "Error", errorCode: "42P01",
      errorMessage: "facts unavailable\nparams: [REDACTED]", errorCauseMessage: "failure for [REDACTED]",
    }, "Removal readiness unavailable: facility facts failed to load");
  });

  it.each(["listError", "submissionsError"] as const)("propagates %s for the read core's no-Removal-rows fallback", async (errorSource) => {
    mocks[errorSource] = new Error("list unavailable");
    await expect(loadRemovalAttentionSources({ organizationId: "org-1" } as OrgContext, "fac-1")).rejects.toThrow("list unavailable");
    expect(mocks.built).toEqual([]);
  });

  it("adds a Removal whose last submission was rejected, without building it", async () => {
    mocks.rows = [row("bounced")];
    mocks.submissions = new Map([["bounced", { status: "rejected", lockedAt: null, metadata: null }]]);
    const { rejected } = await loadRemovalAttentionSources({ organizationId: "org-1" } as OrgContext, "fac-1");
    expect(rejected.map((removal) => removal.removalId)).toEqual(["bounced"]);
    expect(mocks.built).toEqual([]);
  });

  it("adds each submitted Removal the verifier returned, with its correction state", async () => {
    mocks.rows = [row("returned-open"), row("returned-closed"), row("quiet")];
    mocks.submissions = new Map(["returned-open", "returned-closed", "quiet"].map((id) => [id, { status: "submitted", lockedAt: null, metadata: null }]));
    mocks.returnedIds = new Set(["returned-open", "returned-closed"]);
    const { returned } = await loadRemovalAttentionSources({ organizationId: "org-1" } as OrgContext, "fac-1");
    expect(returned.map((removal) => [removal.removalId, removal.correction?.resubmitNeeded])).toEqual([
      ["returned-open", true],
      ["returned-closed", undefined],
    ]);
    expect(mocks.built).not.toContain("quiet");
  });
});
