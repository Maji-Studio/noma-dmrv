import { randomUUID } from "node:crypto";
import { afterEach, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { activityEvents, apiIdempotencyRecords, creditBatches, emissionEntries, emissionEntryValues, facilities, feedstockTypes, organizations, productionProcesses, removalTemplateObservations, storageLocations, users, vehicles } from "@/db/schema";
import type { OrgContext } from "@/lib/auth/server";
import { createVehicle, createQuickStorageLocation } from "@/lib/operations/quick-add";
import { createFeedstockType } from "@/lib/operations/feedstock-types";
import { recordEmissionEntry } from "@/lib/operations/emission-entries";
import { runOperationInProcess } from "@/lib/operations/runner";
import { TEST_SITE_POSITION } from "./helpers/test-org";

const SUITE_TIMEOUT_MS = 60_000;
const DAY = "2026-06-13";
interface Fixture {
  ctx: OrgContext;
  facility: { id: string };
  batch: { id: string };
  ownsUser: boolean;
}
const fixtures: Fixture[] = [];
async function fixture(userId?: string): Promise<Fixture> {
  const organizationId = randomUUID();
  const ownsUser = !userId;
  userId ??= randomUUID();
  await db.insert(organizations).values({ id: organizationId, name: organizationId, slug: organizationId });
  if (ownsUser) await db.insert(users).values({ id: userId, name: "Intent fixture", email: `${userId}@example.test` });
  const ctx: OrgContext = { organizationId, userId, orgRole: "admin", isPlatformAdmin: false };
  const [facility] = await db.insert(facilities).values({ ...TEST_SITE_POSITION, organizationId, code: "FAC-TEST", name: "Intent facility", timezone: "UTC" }).returning();
  const [type] = await db.insert(feedstockTypes).values({ organizationId, code: "FT-PARENT", name: "Parent", category: "forestry", usage: "pyrolysis" }).returning();
  const [process] = await db.insert(productionProcesses).values({ organizationId, facilityId: facility.id, feedstockTypeId: type.id }).returning();
  const templateId = randomUUID();
  const [batch] = await db.insert(creditBatches).values({ organizationId, facilityId: facility.id, feedstockTypeId: type.id, productionProcessId: process.id, code: "CB-TEST", startDate: DAY, endDate: DAY, removalTemplateId: templateId }).returning();
  await db.insert(removalTemplateObservations).values({
    organizationId, provider: "isometric", externalProjectId: "project", externalTemplateId: templateId,
    semanticFingerprint: "initial", fullFingerprint: "initial",
    definition: { groups: [{ id: "group", key: "pyrolysis", displayName: "Group", description: "", components: [{ id: "energy", displayName: "Electricity", description: "", blueprintKey: "grid_electricity_use", inputs: [{ key: "electricity_use", type: "monitored", quantityKind: "energy" }] }] }] },
    enrichment: { energy: { electricity_use: { unit: "kWh" } } },
    lineSources: { energy: { scope: "operating", entryPolicy: "additive", origin: "reviewed" } },
  });
  const result = { ctx, facility, batch, ownsUser };
  fixtures.push(result);
  return result;
}
afterEach(async () => {
  for (const f of fixtures.splice(0).reverse()) {
    const org = f.ctx.organizationId;
    for (const table of [activityEvents, apiIdempotencyRecords, emissionEntryValues, emissionEntries, removalTemplateObservations, creditBatches, productionProcesses, storageLocations, vehicles, feedstockTypes, facilities]) {
      await db.delete(table).where(eq(table.organizationId, org));
    }
    await db.delete(organizations).where(eq(organizations.id, org));
    if (f.ownsUser) await db.delete(users).where(eq(users.id, f.ctx.userId));
  }
});
const vehicleInput = { name: "Intent vehicle", vehicleType: "truck" };
const typeInput = { name: "Intent type", category: "forestry", usage: "pyrolysis" };
const binInput = (f: Fixture) => ({ name: "Intent bin", facilityId: f.facility.id, type: "biochar_bin" });
const entryInput = (f: Fixture) => ({ creditBatchId: f.batch.id, componentId: "energy", occurredOn: DAY, values: [{ inputKey: "electricity_use", quantityKind: "energy", magnitude: "1", unit: "kWh" }] });
const cases = [
  { name: "vehicle", table: vehicles, dates: false, prefix: "VEH", run: (f: Fixture, intentKey: string, changed = false) => runOperationInProcess(createVehicle, f.ctx, { ...vehicleInput, name: changed ? "Changed" : vehicleInput.name }, { intentKey }) },
  { name: "feedstock type", table: feedstockTypes, dates: true, prefix: "FT", run: (f: Fixture, intentKey: string, changed = false) => runOperationInProcess(createFeedstockType, f.ctx, { ...typeInput, name: changed ? "Changed" : typeInput.name }, { intentKey }) },
  { name: "storage location", table: storageLocations, dates: false, prefix: "BB", run: (f: Fixture, intentKey: string, changed = false) => runOperationInProcess(createQuickStorageLocation, f.ctx, { ...binInput(f), name: changed ? "Changed" : binInput(f).name }, { intentKey }) },
  { name: "emission entry", table: emissionEntries, dates: true, prefix: null, run: (f: Fixture, intentKey: string, changed = false) => runOperationInProcess(recordEmissionEntry, f.ctx, { ...entryInput(f), note: changed ? "Changed" : null }, { intentKey }) },
];

describe.each(cases)("$name create intent", ({ table, run, dates, prefix }) => {
  it("replays one row, rejects changed values and isolates organizations", async () => {
    const f = await fixture();
    const other = await fixture(f.ctx.userId);
    const key = randomUUID();
    const rows = (f: Fixture) => db.select({ id: table.id }).from(table).where(eq(table.organizationId, f.ctx.organizationId));
    const before = (await rows(f)).length;
    const first = await run(f, key);
    const replay = await run(f, key);
    expect(replay).toEqual(first);
    if (dates) {
      expect(first).toHaveProperty("createdAt", expect.any(Date));
      expect(replay).toHaveProperty("createdAt", expect.any(Date));
    }
    if (prefix) expect(first).toHaveProperty("code", expect.stringMatching(new RegExp(`^${prefix}-`)));
    expect(await rows(f)).toHaveLength(before + 1);
    await expect(run(f, key, true)).rejects.toMatchObject({ code: "idempotency_key_reused" });
    expect(await rows(f)).toHaveLength(before + 1);
    const otherBefore = (await rows(other)).length;
    const separate = await run(other, key);
    expect(separate.id).not.toBe(first.id);
    expect(await run(other, key)).toEqual(separate);
    expect(await rows(other)).toHaveLength(otherBefore + 1);
    const events = await db.select().from(activityEvents).where(eq(activityEvents.organizationId, f.ctx.organizationId));
    expect(events).toHaveLength(table === emissionEntries ? 1 : 0);
  }, SUITE_TIMEOUT_MS);
});
