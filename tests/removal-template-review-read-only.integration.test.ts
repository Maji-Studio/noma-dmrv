import { createHmac, randomUUID } from "node:crypto";
import { and, eq } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { db } from "@/db";
import { certifierProjects, facilities, members, organizations, removalTemplateObservations, sessions, users } from "@/db/schema";
import { resolveIsometricClient } from "@/data-access/certifier-credentials";
import { loadRemovalTemplateReviewEntry, loadRemovalTemplateReview } from "@/fn/certification/removal-template-review";
import { loadRemovalTemplateFacts } from "@/fn/certification/removal-template-facts";
import { observeRemovalTemplate } from "@/fn/certification/observe-removal-template";
import { auth } from "@/lib/auth/better-auth";
import type { OrgContext } from "@/lib/auth/server";
import { env } from "@/config/env";
import { listComponentBlueprints, listGhgEntryTemplates } from "@/lib/isometric";
import { loadTemplateEnrichment } from "@/lib/isometric/template-observations/load-enrichment";
import type { GhgEntryTemplate, TemplateEnrichment } from "@/lib/isometric/template-observations";
import fixture from "./fixtures/isometric/sandbox-template-2026-10-15.json";
import { TEST_SITE_POSITION } from "./helpers/test-org";

// Real Postgres, auth, actions and data-access. Only the request transport and
// registry boundary are supplied by the test. tests/setup.ts guards TEST_DATABASE_URL.
const request = vi.hoisted(() => ({ headers: new Headers() }));
vi.mock("next/headers", () => ({ headers: async () => request.headers }));
vi.mock("@/data-access/certifier-credentials", async (importOriginal) => ({
  ...await importOriginal<typeof import("@/data-access/certifier-credentials")>(),
  hasCertifierCredentials: vi.fn(async () => true),
}));
vi.mock("@/lib/isometric/client", async (importOriginal) => ({
  ...await importOriginal<typeof import("@/lib/isometric/client")>(),
  createIsometricClient: vi.fn(() => ({})),
}));
vi.mock("@/lib/isometric", async (importOriginal) => ({
  ...await importOriginal<typeof import("@/lib/isometric")>(),
  listGhgEntryTemplates: vi.fn(),
  listComponentBlueprints: vi.fn(async () => []),
}));
vi.mock("@/lib/isometric/template-observations/load-enrichment", () => ({ loadTemplateEnrichment: vi.fn() }));

const SESSION_LIFETIME_MS = 24 * 60 * 60 * 1000;
const tag = randomUUID();
const organizationId = `preview-observations-${tag}`;
const userId = `preview-user-${tag}`;
const ctx: OrgContext = { userId, organizationId, orgRole: "admin", isPlatformAdmin: false };
let facilityId: string;
let template: GhgEntryTemplate;
let enrichment: TemplateEnrichment;

beforeAll(async () => {
  await db.insert(organizations).values({ id: organizationId, name: "Preview observation tests", slug: organizationId });
  await db.insert(users).values({ id: userId, email: `${tag}@preview-observations.test`, emailVerified: true });
  await db.insert(members).values({ id: randomUUID(), userId, organizationId, role: "admin" });
  const [facility] = await db.insert(facilities).values({
    ...TEST_SITE_POSITION, organizationId, timezone: "UTC", code: `FAC-PREVIEW-${tag}`, name: "Preview observation tests",
  }).returning();
  facilityId = facility.id;
  await db.insert(certifierProjects).values({
    organizationId, facilityId, provider: "isometric", externalProjectId: fixture.project_id, externalFacilityId: `fcl_preview_${tag}`,
  });
  const token = randomUUID();
  await db.insert(sessions).values({ id: randomUUID(), userId, token, activeOrganizationId: organizationId,
    expiresAt: new Date(Date.now() + SESSION_LIFETIME_MS) });
  const context = await auth.$context;
  const signature = createHmac("sha256", env.BETTER_AUTH_SECRET).update(token).digest("base64");
  request.headers = new Headers({
    cookie: `${context.authCookies.sessionToken.name}=${encodeURIComponent(`${token}.${signature}`)}`,
    origin: env.NEXT_PUBLIC_APP_URL,
  });
});

beforeEach(() => {
  vi.clearAllMocks();
  template = structuredClone(fixture) as GhgEntryTemplate;
  template.id = `rvt_preview_${randomUUID()}`;
  const group = template.groups.find((group) => group.key === "pyrolysis")!;
  group.components = [group.components.find((component) => component.blueprint_key === "grid_electricity_use")!];
  group.components[0].inputs = group.components[0].inputs.filter((input) => input.type === "monitored");
  template.groups = [group];
  enrichment = Object.fromEntries(group.components.map((component) => [component.id,
    Object.fromEntries(component.inputs.map((input) => [input.input_key, { unit: "kWh" }])),
  ]));
  vi.mocked(listGhgEntryTemplates).mockResolvedValue([template]);
  vi.mocked(loadTemplateEnrichment).mockResolvedValue(enrichment);
});

afterAll(async () => {
  await db.delete(removalTemplateObservations).where(eq(removalTemplateObservations.organizationId, organizationId));
  await db.delete(certifierProjects).where(eq(certifierProjects.organizationId, organizationId));
  await db.delete(facilities).where(eq(facilities.organizationId, organizationId));
  await db.delete(sessions).where(eq(sessions.userId, userId));
  await db.delete(members).where(and(eq(members.organizationId, organizationId), eq(members.userId, userId)));
  await db.delete(users).where(eq(users.id, userId));
  await db.delete(organizations).where(eq(organizations.id, organizationId));
});

function storedObservations() {
  return db.select().from(removalTemplateObservations)
    .where(eq(removalTemplateObservations.organizationId, organizationId)).orderBy(removalTemplateObservations.id);
}

async function facts() {
  const client = await resolveIsometricClient(ctx);
  return loadRemovalTemplateFacts(ctx, { client, template, externalProjectId: template.project_id,
    blueprints: await listComponentBlueprints(client) });
}

describe("read-only Removal template previews", () => {
  it.each([false, true])("leaves observation count and rows unchanged (prior observation: %s)", async (withPrior) => {
    if (withPrior) expect((await facts()).observation).not.toBeNull();
    const before = await storedObservations();
    const input = { facilityId, removalTemplateId: template.id };
    const entry = await loadRemovalTemplateReviewEntry(input);
    expect(entry).toMatchObject({ success: true, data: { observation: null, preview: true } });
    expect(await storedObservations()).toEqual(before);
    expect(loadTemplateEnrichment).toHaveBeenCalled();
  });

  it("lists an unused template without storing observations", async () => {
    const before = await storedObservations();
    const result = await loadRemovalTemplateReview(facilityId);
    expect(result.success).toBe(true);
    if (!result.success) throw new Error("expected a read");
    expect(result.data.find((entry) => entry.templateId === template.id)).toMatchObject({
      observation: null, preview: true, isDefault: false, isPinned: false,
    });
    expect(await storedObservations()).toEqual(before);
  });

  it("still stores an observation through loadRemovalTemplateFacts", async () => {
    const before = await storedObservations();
    const result = await facts();
    expect(result.observation).toMatchObject({ organizationId, externalTemplateId: template.id });
    const after = await storedObservations();
    expect(after).toHaveLength(before.length + 1);
    expect(after.find((row) => row.externalTemplateId === template.id)?.id).toBe(result.observation?.id);
  });

  it("reuses complete enrichment inside the TTL without sliding enrichedAt, and refreshes on request", async () => {
    const client = await resolveIsometricClient(ctx);
    const input = { client, template, externalProjectId: template.project_id, blueprints: await listComponentBlueprints(client) };
    const first = await observeRemovalTemplate(ctx, input);
    expect(loadTemplateEnrichment).toHaveBeenCalledTimes(1);
    const reused = await observeRemovalTemplate(ctx, input);
    expect(loadTemplateEnrichment).toHaveBeenCalledTimes(1);
    expect(reused.id).toBe(first.id);
    expect(reused.enrichedAt).toEqual(first.enrichedAt);
    expect(reused.lastObservedAt.getTime()).toBeGreaterThan(first.lastObservedAt.getTime());
    const refreshed = await observeRemovalTemplate(ctx, { ...input, refreshEnrichment: true });
    expect(loadTemplateEnrichment).toHaveBeenCalledTimes(2);
    expect(refreshed.id).toBe(first.id);
    expect(refreshed.enrichedAt.getTime()).toBeGreaterThan(first.enrichedAt.getTime());
    expect(refreshed.enrichment).toEqual(enrichment);
  });
});
