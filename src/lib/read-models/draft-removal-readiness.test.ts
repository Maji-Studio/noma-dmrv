import { beforeEach, describe, expect, it, vi } from "vitest";
import type { OrgContext } from "@/lib/auth/server";

const mocks = vi.hoisted(() => ({
  rows: [] as Array<{ id: string; code: string; createdAt: Date; startedOn: null; completedOn: null }>,
  submissions: new Map<string, { status: string; lockedAt: null; metadata: null }>(),
  built: [] as string[],
}));

vi.mock("@/data-access/certifier-removals", () => ({ listRemovalsForFacility: async () => mocks.rows }));
vi.mock("@/data-access/certification", () => ({ getLatestSubmissionsForEntities: async () => mocks.submissions }));
vi.mock("@/data-access/utils", () => ({ requireOrgScope: () => undefined }));
vi.mock("@/lib/isometric/utils/lock", () => ({ isLockedInFlight: () => false }));
vi.mock("@/lib/certification/from-submission", () => ({ isRemovalSubmissionInterruptedFromSubmission: () => false }));
vi.mock("@/fn/certification/certify-context-core", () => ({
  loadFacilityCertifierFacts: async () => ({}),
  resolveScopeForRemoval: async (_ctx: unknown, id: string) => ({ id }),
  buildRemovalContext: async (_ctx: unknown, scope: { id: string }) => {
    if (scope.id === "broken") throw new Error("build failed");
    mocks.built.push(scope.id);
    return { id: scope.id };
  },
}));
vi.mock("@/lib/certification/readiness-facts", () => ({ toRemovalReadinessFacts: (ctx: { id: string }) => ctx }));
vi.mock("@/lib/certification/readiness", () => ({
  deriveRemovalReadiness: (facts: { id: string }) =>
    facts.id === "blocked" ? { state: "blocked", reasons: ["One.", "Two."] } : { state: "ready", reasons: [] },
}));

import { loadDraftRemovalReadiness } from "./draft-removal-readiness";

const createdAt = new Date("2026-11-01T00:00:00Z");
const row = (id: string) => ({ id, code: `RM-${id}`, createdAt, startedOn: null, completedOn: null });

describe("loadDraftRemovalReadiness", () => {
  beforeEach(() => {
    mocks.rows = [row("blocked"), row("ready"), row("sent")];
    mocks.submissions = new Map([["sent", { status: "submitted", lockedAt: null, metadata: null }]]);
    mocks.built = [];
  });

  it("returns the readiness of each draft and leaves a submitted Removal out", async () => {
    const drafts = await loadDraftRemovalReadiness({ organizationId: "org-1" } as OrgContext, "fac-1");
    expect(drafts.map((draft) => [draft.removalId, draft.readiness?.state])).toEqual([
      ["blocked", "blocked"],
      ["ready", "ready"],
    ]);
    expect(mocks.built).not.toContain("sent");
  });

  it("builds nothing when no Removal is a draft", async () => {
    mocks.rows = [row("sent")];
    expect(await loadDraftRemovalReadiness({ organizationId: "org-1" } as OrgContext, "fac-1")).toEqual([]);
    expect(mocks.built).toEqual([]);
  });

  it("leaves out a draft whose build rejects and keeps the others", async () => {
    mocks.rows = [row("broken"), row("ready")];
    const drafts = await loadDraftRemovalReadiness({ organizationId: "org-1" } as OrgContext, "fac-1");
    expect(drafts.map((draft) => draft.removalId)).toEqual(["ready"]);
  });

  it("adds a Removal whose last submission was rejected, without building it", async () => {
    mocks.rows = [row("bounced")];
    mocks.submissions = new Map([["bounced", { status: "rejected", lockedAt: null, metadata: null }]]);
    const drafts = await loadDraftRemovalReadiness({ organizationId: "org-1" } as OrgContext, "fac-1");
    expect(drafts.map((draft) => draft.removalId)).toEqual(["bounced"]);
    expect(mocks.built).toEqual([]);
  });
});
