import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { GET } from "@/app/api/v1/deliveries/[idOrCode]/application-balance/route";
import { GET as LIST } from "@/app/api/v1/deliveries/route";
import { db } from "@/db";
import { and, eq } from "drizzle-orm";
import { applications, certifierProjects, customerLocations, deliveries, facilities } from "@/db/schema";
import { getApplicationDeliveryOptions } from "@/data-access/applications";
import { deleteApplication } from "@/lib/operations/applications";
import { runOperationInProcess } from "@/lib/operations/runner";
import { bodyHashEtag } from "@/lib/api/etag";
import { DELIVERY_APPLICATION_BALANCE_REPRESENTATION_REVISION } from "@/config/api-rest";
import { lookupProblem } from "./helpers/api-lookups";
import { createApiApplicationReadFixture, insertReadApplication, removeApiApplicationReadFixture, type ApiApplicationReadFixture } from "./helpers/api-application-read-fixture";
import { insertReadDelivery, readParams, readRequest, READ_TIMEOUT_MS, UNKNOWN_READ_ID } from "./helpers/api-order-read-fixture";

let a: ApiApplicationReadFixture;
const balance = (id = a.delivery.id, key = a.deliveryKey) => GET(readRequest(`/deliveries/${id}/application-balance`, key), readParams(id));
const list = (value: string) => LIST(readRequest(`/deliveries?hasRemainingMass=${value}`, a.deliveryKey));
beforeEach(async () => { a = await createApiApplicationReadFixture(); }, READ_TIMEOUT_MS);
afterEach(async () => { if (a) await removeApiApplicationReadFixture(a); }, READ_TIMEOUT_MS);
describe("delivery application balance", { timeout: READ_TIMEOUT_MS }, () => {
  it("reports two applications and an exact gram residual from the delivered wet mass", async () => {
    await insertReadApplication(a, { biocharAppliedTons: 0.05, biocharAppliedDryTons: 0.04 });
    await insertReadApplication(a, { biocharAppliedTons: 0.05, biocharAppliedDryTons: 0.04 });
    const response = await GET(readRequest(`/deliveries/${a.delivery.id}/application-balance`, a.deliveryKey), readParams(a.delivery.id));
    expect(response.status).toBe(200);
    expect((await response.json()).data).toMatchObject({ deliveryId: a.delivery.id, deliveredWetMassKg: 100.001,
      appliedWetMassKg: 100, appliedDryBiocharKg: 80, remainingWetMassKg: 0.001, earliestApplicationDate: "2026-09-14" });
  });

  it("shares the order site and facility temperature fallback with the app picker", async () => {
    await db.update(facilities).set({ durabilityOption: "200_year" }).where(eq(facilities.id, a.facility.id));
    await db.update(customerLocations).set({ defaultSoilTemperatureC: 21.5 }).where(eq(customerLocations.id, a.location.id));
    await db.insert(certifierProjects).values({ organizationId: a.ctx.organizationId, facilityId: a.facility.id, provider: "isometric",
      externalFacilityId: `facility-${a.tag}`, externalProjectId: `project-${a.tag}`, defaultSoilTemperatureC: 24.5 });
    const siteResponse = await balance(a.delivery.code);
    const { data } = await siteResponse.json();
    expect(data.site).toEqual({ customerLocationId: a.location.id, gpsLatitude: a.location.gpsLatitude, gpsLongitude: a.location.gpsLongitude,
      defaultSoilTemperatureC: 21.5, soilTemperatureDefault: "customer_location" });
    expect(siteResponse.headers.get("etag")).toBe(bodyHashEtag(DELIVERY_APPLICATION_BALANCE_REPRESENTATION_REVISION, data));
    expect((await getApplicationDeliveryOptions(a.ctx, a.facility.id)).find(d => d.id === a.delivery.id)).toMatchObject({
      defaultSoilTemperatureC: 21.5, facilityDefaultSoilTemperatureC: 24.5, destinationGpsLatitude: a.location.gpsLatitude,
      destinationGpsLongitude: a.location.gpsLongitude, alreadyAppliedWetKg: 0, alreadyAppliedDryKg: 0,
    });
    await db.update(customerLocations).set({ defaultSoilTemperatureC: null }).where(eq(customerLocations.id, a.location.id));
    const fallback = await balance();
    expect((await fallback.json()).data.site).toMatchObject({ defaultSoilTemperatureC: 24.5, soilTemperatureDefault: "facility" });
    expect(fallback.headers.get("etag")).not.toBe(siteResponse.headers.get("etag"));
    await db.update(facilities).set({ durabilityOption: "1000_year" }).where(eq(facilities.id, a.facility.id));
    expect((await (await balance()).json()).data.site).toMatchObject({ defaultSoilTemperatureC: null, soilTemperatureDefault: null });
    await db.update(customerLocations).set({ defaultSoilTemperatureC: 21.5 }).where(eq(customerLocations.id, a.location.id));
    expect((await (await balance()).json()).data.site).toMatchObject({ defaultSoilTemperatureC: null, soilTemperatureDefault: null });
  });

  it("changes the balance validator after a delete without changing the delivery version", async () => {
    const app = await insertReadApplication(a);
    const before = await balance();
    await runOperationInProcess(deleteApplication, a.ctx, { applicationId: app.id, expectedVersion: app.version });
    const after = await balance();
    expect(after.headers.get("etag")).not.toBe(before.headers.get("etag"));
    expect((await after.json()).data).toMatchObject({ remainingWetMassKg: 100.001, appliedWetMassKg: 0 });
    expect((await db.select().from(deliveries).where(eq(deliveries.id, a.delivery.id)))[0].version).toBe(a.delivery.version);
  });

  it.each([["Pacific/Kiritimati", "2026-09-15"], ["America/Los_Angeles", "2026-09-14"]])("uses the %s facility day", async (timezone, day) => {
    await db.update(facilities).set({ timezone }).where(eq(facilities.id, a.facility.id));
    await db.update(deliveries).set({ deliveryDate: new Date("2026-09-15T00:30:00Z") }).where(eq(deliveries.id, a.delivery.id));
    expect((await (await balance()).json()).data.earliestApplicationDate).toBe(day);
  });

  it("clamps overapplication and lists the same gram scale remaining mass", async () => {
    const exhausted = await insertReadDelivery(a, a.order.id, 25);
    const over = await insertReadApplication(a, { deliveryId: exhausted.id, biocharAppliedTons: 0.025001 });
    await insertReadApplication(a, { biocharAppliedTons: 0.1 });
    expect((await (await balance(exhausted.id)).json()).data.remainingWetMassKg).toBe(0);
    expect((await (await balance()).json()).data.remainingWetMassKg).toBe(0.001);
    expect((await (await list("true")).json()).data.map((r: { id: string }) => r.id)).toEqual([a.delivery.id]);
    expect((await (await list("false")).json()).data.map((r: { id: string }) => r.id)).toEqual([exhausted.id]);
    await db.update(applications).set({ biocharAppliedTons: 0.025 }).where(eq(applications.id, over.id));
    expect((await (await balance(exhausted.id)).json()).data.remainingWetMassKg).toBe(0);
  });

  it("keeps archived balances readable and checks scope before existence", async () => {
    await db.update(deliveries).set({ archivedAt: new Date() }).where(eq(deliveries.id, a.delivery.id));
    expect((await balance(a.delivery.id.toUpperCase())).status).toBe(200);
    expect((await (await list("true")).json()).data).toEqual([]);
    const b = await createApiApplicationReadFixture();
    try {
      for (const id of [a.delivery.id, a.delivery.code, UNKNOWN_READ_ID, "missing"]) await lookupProblem(await balance(id, b.deliveryKey), 404, "not_found");
      await lookupProblem(await balance(UNKNOWN_READ_ID, a.applicationKey), 403, "missing_scope");
      const response = await GET(readRequest(`/deliveries/${a.delivery.id}/application-balance?unknown=1`, a.deliveryKey), readParams(a.delivery.id));
      await lookupProblem(response, 400, "invalid_query");
    } finally { await removeApiApplicationReadFixture(b); }
    await db.update(deliveries).set({ archivedAt: null }).where(and(eq(deliveries.organizationId, a.ctx.organizationId), eq(deliveries.id, a.delivery.id)));
  });
});
