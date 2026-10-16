import { afterEach, describe, expect, it } from "vitest";
import { eq, sql } from "drizzle-orm";
import { db, withDedicatedSessionAdvisoryLock } from "@/db";
import { certifierProjects, certifierStorageLocations, customerLocations } from "@/db/schema";
import { payloadHash } from "@/lib/isometric/utils/payload-hash";
import { withStorageLocationRegistrationLocks } from "@/data-access/certifier-storage-locations";
import { getCustomerLocations } from "@/data-access/customers";
import { certifierStorageSiteLockKey } from "@/lib/certification/certifier-storage-site-lock";
import { buildCreateStorageLocationRequest } from "@/lib/isometric/storage-locations";
import { updateCustomerLocation, deleteCustomerLocation } from "@/lib/operations/customer-locations";
import { runOperationInProcess } from "@/lib/operations/runner";
import { createPartyArchiveFixture, cleanupPartyArchiveFixture, type PartyArchiveFixture } from "./helpers/party-archive-fixture";

const fixtures: PartyArchiveFixture[] = [];
const BARRIER_TIMEOUT_MS = 5_000;
afterEach(async () => { for (const f of fixtures.splice(0)) await cleanupPartyArchiveFixture(f); });
async function fixture() { const f = await createPartyArchiveFixture(); fixtures.push(f); return f; }
const version = (f: PartyArchiveFixture) => ({ locationId: f.location.id, expectedVersion: f.location.version });
const key = (f: PartyArchiveFixture) => certifierStorageSiteLockKey(f.ctx.organizationId, f.location.id);
const busy = { code: "conflict", retryable: true, issues: [{ path: ["locationId"] }], message: "This location is being registered with Isometric. Try again in a moment." };
async function mapping(f: PartyArchiveFixture, name = f.location.name, facilityId = f.facility.id) {
  const externalProjectId = `prj_${crypto.randomUUID()}`;
  const [project] = await db.insert(certifierProjects).values({ organizationId: f.ctx.organizationId, facilityId,
    provider: "isometric", externalProjectId, externalFacilityId: `fcl_${crypto.randomUUID()}` }).returning();
  const supplierReference = `site_${crypto.randomUUID()}`;
  const body = buildCreateStorageLocationRequest({ externalProjectId, name, latitude: f.location.gpsLatitude,
    longitude: f.location.gpsLongitude, supplierReferenceId: supplierReference });
  await db.insert(certifierStorageLocations).values({ organizationId: f.ctx.organizationId, customerLocationId: f.location.id,
    certifierProjectId: project.id, externalProjectId, externalStorageLocationId: `slc_${crypto.randomUUID()}`,
    supplierReference, submittedPayload: body, payloadHash: payloadHash(body) });
}

describe("customer storage-site registration fence", () => {
  it("refuses edits retryably during first registration, then protects the registered facts", async () => {
    const f = await fixture();
    await withStorageLocationRegistrationLocks(f.ctx, { facilityId: f.facility.id, externalProjectId: "prj_first",
      customerLocationId: f.location.id, provider: "isometric" }, async () => {
      await expect(runOperationInProcess(updateCustomerLocation, f.ctx, { ...version(f), name: "Changed" })).rejects.toMatchObject(busy);
      await mapping(f);
    });
    await expect(runOperationInProcess(updateCustomerLocation, f.ctx, { ...version(f), name: "Changed" }))
      .rejects.toMatchObject({ code: "certification_locked", issues: [{ path: ["name"] }] });
  });

  it("makes registration wait for an edit commit and then read the new facts", async () => {
    const f = await fixture();
    let registration: Promise<unknown> | undefined;
    let edited: Promise<unknown> | undefined;
    let observedName: string | undefined;
    try {
      await db.transaction(async tx => {
        // Pause the runner after its fence but before its location update.
        await tx.select().from(customerLocations).where(eq(customerLocations.id, f.location.id)).for("update");
        const backend = await tx.execute<{ pid: number }>(sql`select pg_backend_pid() as pid`);
        edited = runOperationInProcess(updateCustomerLocation, f.ctx, { ...version(f), name: "Edited before registration" });
        let writerPid = 0;
        await expect.poll(async () => {
          const waiting = await db.execute<{ pid: number }>(sql`select pid from pg_stat_activity where ${backend.rows[0].pid} = any(pg_blocking_pids(pid))`);
          writerPid = waiting.rows[0]?.pid ?? 0;
          return waiting.rows.length;
        }, { timeout: BARRIER_TIMEOUT_MS }).toBe(1);
        registration = withStorageLocationRegistrationLocks(f.ctx, { facilityId: f.facility.id,
          externalProjectId: "prj_after_edit", customerLocationId: f.location.id, provider: "isometric" }, async () => {
          observedName = (await getCustomerLocations(f.ctx, f.customer.id)).find(row => row.id === f.location.id)!.name;
          await mapping(f, observedName);
        });
        await expect.poll(async () => (await db.execute(sql`select pid from pg_stat_activity where wait_event = 'advisory' and ${writerPid} = any(pg_blocking_pids(pid))`)).rows.length,
          { timeout: BARRIER_TIMEOUT_MS }).toBeGreaterThan(0);
        expect(observedName).toBeUndefined();
      });
      await edited;
      await registration;
      expect(observedName).toBe("Edited before registration");
    } finally { await Promise.allSettled([edited, registration]); }
  });

  it("allows unchanged PATCH and repairs drift only to the exact registered values", async () => {
    const f = await fixture();
    await mapping(f);
    const kept = await runOperationInProcess(updateCustomerLocation, f.ctx, { ...version(f), name: f.location.name,
      gpsLatitude: f.location.gpsLatitude, gpsLongitude: f.location.gpsLongitude });
    await db.update(customerLocations).set({ name: "Legacy drift", gpsLatitude: f.location.gpsLatitude + 1 })
      .where(eq(customerLocations.id, f.location.id));
    await expect(runOperationInProcess(updateCustomerLocation, f.ctx, { ...version(f), expectedVersion: kept.version,
      name: f.location.name, gpsLatitude: f.location.gpsLatitude + 0.0000005, gpsLongitude: f.location.gpsLongitude }))
      .rejects.toMatchObject({ code: "certification_locked", issues: [{ path: ["name"] }] });
    const repaired = await runOperationInProcess(updateCustomerLocation, f.ctx, { ...version(f), expectedVersion: kept.version,
      name: f.location.name, gpsLatitude: f.location.gpsLatitude, gpsLongitude: f.location.gpsLongitude });
    expect(repaired.name).toBe(f.location.name);
    expect(repaired.gpsLatitude).toBe(f.location.gpsLatitude);
  });

  it("requires the new facts to match every project, but permits unchanged facts and other fields", async () => {
    const f = await fixture();
    await mapping(f);
    await mapping(f, "Other registered name", f.otherFacility.id);
    await expect(runOperationInProcess(updateCustomerLocation, f.ctx, { ...version(f), name: "Other registered name" }))
      .rejects.toMatchObject({ code: "certification_locked", issues: [{ path: ["name"] }] });
    const kept = await runOperationInProcess(updateCustomerLocation, f.ctx, { ...version(f), name: f.location.name });
    const changed = await runOperationInProcess(updateCustomerLocation, f.ctx, { ...version(f), expectedVersion: kept.version, city: "Town" });
    expect(changed.city).toBe("Town");
  });

  it.each([
    { gpsLatitude: 20, gpsLongitude: 30, field: "gpsLatitude" },
    { gpsLatitude: undefined, gpsLongitude: 30, field: "gpsLongitude" },
  ])("points at the first changed coordinate ($field)", async ({ gpsLatitude, gpsLongitude, field }) => {
    const f = await fixture();
    await mapping(f);
    await expect(runOperationInProcess(updateCustomerLocation, f.ctx, { ...version(f),
      gpsLatitude: gpsLatitude ?? f.location.gpsLatitude, gpsLongitude }))
      .rejects.toMatchObject({ code: "certification_locked", issues: [{ path: [field] }] });
  });

  it("refuses delete retryably while the dedicated session fence is held", async () => {
    const f = await fixture();
    await withDedicatedSessionAdvisoryLock(key(f), async () => {
      await expect(runOperationInProcess(deleteCustomerLocation, f.ctx, version(f))).rejects.toMatchObject(busy);
    });
    expect((await runOperationInProcess(deleteCustomerLocation, f.ctx, version(f))).id).toBe(f.location.id);
  });

  it("refuses delete for a completed mapping without an application, delivery or order", async () => {
    const f = await fixture();
    await mapping(f);
    await expect(runOperationInProcess(deleteCustomerLocation, f.ctx, version(f))).rejects.toMatchObject({
      code: "conflict", retryable: false, issues: [{ path: ["locationId"] }],
      message: "Customer location was not deleted because it is registered with Isometric as a storage site. Archive it instead.",
    });
  });
});
