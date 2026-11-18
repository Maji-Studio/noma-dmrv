import { afterEach, beforeEach, expect, it } from "vitest";
import { and, eq } from "drizzle-orm";
import { db } from "@/db";
import { activityEvents, emissionEntries, removalTemplateObservations } from "@/db/schema";
import { setComponentFilePolicy } from "./component-file-policy";
import { createEmissionEntry } from "./emission-entries";
import { loadBatchEmissionEntryFacts } from "./emission-entry-facts";
import { emissionEntryCounts } from "@/lib/certification/emission-entry-rules";
import { setupPlan } from "@/lib/certification/removal-template-setup-plan";
import { setupPlanFingerprint } from "@/lib/certification/removal-template-setup-fingerprint";
import { reviewLineSources } from "@/lib/certification/removal-template-review-sources";
import { validateLineSources } from "@/lib/isometric/template-observations";
import { createEmissionLineFileFixture, cleanupEmissionLineFileFixture, COMPONENT_ID,
  type EmissionLineFileFixture } from "../../tests/helpers/emission-line-file-fixture";

let fixture: EmissionLineFileFixture;
beforeEach(async () => { fixture = await createEmissionLineFileFixture(); });
afterEach(async () => { if (fixture) await cleanupEmissionLineFileFixture(fixture); });
const input = () => ({ observationId: fixture.observation.id, componentId: COMPONENT_ID,
  filePolicy: "entryFiles" as const, expectedVersion: fixture.observation.version });

it("requires organization scope and Admin permission, and refuses foreign observations", async () => {
  await expect(setComponentFilePolicy({ ...fixture.ctx, organizationId: "" }, input())).rejects.toThrow("Unauthorized");
  await expect(setComponentFilePolicy({ ...fixture.ctx, orgRole: "member" }, input())).rejects.toThrow("permission");
  await expect(setComponentFilePolicy({ ...fixture.ctx, organizationId: crypto.randomUUID() }, input())).rejects.toMatchObject({ code: "not_found" });
});

it("allows the shared Owner and Admin permission level to persist a proof setting with version and activity", async () => {
  const saved = await setComponentFilePolicy(fixture.ctx, input());
  expect(saved.version).toBe(fixture.observation.version + 1);
  expect(saved.lineSources[COMPONENT_ID]).toEqual({ ...fixture.observation.lineSources[COMPONENT_ID], filePolicy: "entryFiles" });
  expect(saved.lineSources.manual).toEqual(fixture.observation.lineSources.manual);
  const [persisted] = await db.select().from(removalTemplateObservations).where(and(
    eq(removalTemplateObservations.organizationId, fixture.ctx.organizationId), eq(removalTemplateObservations.id, saved.id),
  ));
  expect(persisted).toEqual(saved);
  const [activity] = await db.select().from(activityEvents).where(and(
    eq(activityEvents.organizationId, fixture.ctx.organizationId), eq(activityEvents.entityId, saved.id),
  ));
  expect(activity).toMatchObject({ entityType: "removal_template_observation", actorUserId: fixture.ctx.userId,
    reasonCode: `component-proof:${COMPONENT_ID}`, versionBefore: fixture.observation.version, versionAfter: saved.version,
    changes: { filePolicy: { from: "lineFile", to: "entryFiles" } },
  });
});

it("rejects unsupported policies and missing components without changing the observation", async () => {
  await expect(setComponentFilePolicy(fixture.ctx, { ...input(), componentId: "manual", filePolicy: "lineFile" }))
    .rejects.toMatchObject({ code: "validation_failed" });
  await expect(setComponentFilePolicy(fixture.ctx, { ...input(), componentId: "missing" }))
    .rejects.toMatchObject({ code: "validation_failed" });
  const [row] = await db.select().from(removalTemplateObservations).where(and(
    eq(removalTemplateObservations.organizationId, fixture.ctx.organizationId), eq(removalTemplateObservations.id, fixture.observation.id),
  ));
  expect(row.version).toBe(fixture.observation.version);
});

it("returns the existing stale-version conflict for racing edits and superseded observations", async () => {
  const results = await Promise.allSettled([
    setComponentFilePolicy(fixture.ctx, input()), setComponentFilePolicy(fixture.ctx, { ...input(), filePolicy: "none" }),
  ]);
  expect(results.filter(result => result.status === "fulfilled")).toHaveLength(1);
  expect(results.find(result => result.status === "rejected")).toMatchObject({ reason: {
    code: "stale_version", conflict: { entity: "removal_template_observation", id: fixture.observation.id },
  } });
  // org-scope-ok: fixture insert; the spread copies organizationId from the fixture observation
  await db.insert(removalTemplateObservations).values({ ...fixture.observation, id: undefined,
    semanticFingerprint: "newer", fullFingerprint: "newer", lastObservedAt: new Date("2099-01-01"),
  });
  await expect(setComponentFilePolicy(fixture.ctx, { ...input(), expectedVersion: fixture.observation.version + 1 }))
    .rejects.toMatchObject({ code: "stale_version" });
});

it("keeps recorded entries counting and changes the setup fingerprint", async () => {
  const entry = await createEmissionEntry(fixture.ctx, { creditBatchId: fixture.batch.id, componentId: COMPONENT_ID,
    occurredOn: "2026-01-10", values: [{ inputKey: "electricity_use", quantityKind: "energy", magnitude: "2", unit: "kWh" }],
  });
  const before = fixture.observation;
  const saved = await setComponentFilePolicy(fixture.ctx, input());
  expect(emissionEntryCounts(before, saved, COMPONENT_ID)).toMatchObject({ counts: true, canConfirm: true });
  const facts = await loadBatchEmissionEntryFacts(fixture.ctx, fixture.batch.id, saved);
  expect(facts.entries.find(row => row.id === entry.id)).toMatchObject({ counts: true });
  const [persisted] = await db.select().from(emissionEntries).where(and(
    eq(emissionEntries.organizationId, fixture.ctx.organizationId), eq(emissionEntries.id, entry.id),
  ));
  expect(persisted).toMatchObject({ version: entry.version, contentRevision: entry.contentRevision, observationId: before.id });
  const fingerprint = (row: typeof saved) => setupPlanFingerprint(setupPlan(row.definition,
    reviewLineSources(row.lineSources), validateLineSources(row.definition, row.lineSources)));
  expect(fingerprint(saved)).not.toBe(fingerprint(before));
});
