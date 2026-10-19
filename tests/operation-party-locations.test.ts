/** Registered JSON operations against Postgres. Supervisor runs this suite. */
import { afterEach, describe, expect, it } from "vitest";
import { operationRegistry as registry } from "@/lib/operations/registry";
import type { OrgContext } from "@/lib/auth/server";
import { runOperation, type RunOptions } from "@/lib/operations/runner";
import { readApiCustomerLocation } from "@/lib/read-models/api-customer-locations";
import { readApiSupplierLocation } from "@/lib/read-models/api-supplier-locations";
import { customerLocationRepresentationSchema } from "@/lib/representations/customer-locations";
import { supplierLocationRepresentationSchema } from "@/lib/representations/supplier-locations";
import { createPartyArchiveFixture, cleanupPartyArchiveFixture, type PartyArchiveFixture } from "./helpers/party-archive-fixture";

const TIMEOUT_MS = 60_000;
const fixtures: PartyArchiveFixture[] = [];
afterEach(async () => { for (const f of fixtures.splice(0)) await cleanupPartyArchiveFixture(f); }, TIMEOUT_MS);
async function fixture() { const f = await createPartyArchiveFixture(); fixtures.push(f); return f; }
const place = { name: "E2E Location", country: "TZ", gpsLatitude: -8, gpsLongitude: 34 };

for (const kind of ["customer", "supplier"] as const) describe(`registered ${kind} locations`, { timeout: TIMEOUT_MS }, () => {
  const add = (ctx: OrgContext, input: unknown, options?: RunOptions) => kind === "customer"
    ? runOperation(registry.add_customer_location, ctx, input, options)
    : runOperation(registry.add_supplier_location, ctx, input, options);
  const update = (ctx: OrgContext, input: unknown, options?: RunOptions) => kind === "customer"
    ? runOperation(registry.update_customer_location, ctx, input, options)
    : runOperation(registry.update_supplier_location, ctx, input, options);
  const remove = (ctx: OrgContext, input: unknown, options?: RunOptions) => kind === "customer"
    ? runOperation(registry.delete_customer_location, ctx, input, options)
    : runOperation(registry.delete_supplier_location, ctx, input, options);
  const schema = kind === "customer" ? customerLocationRepresentationSchema : supplierLocationRepresentationSchema;
  const read = kind === "customer" ? readApiCustomerLocation : readApiSupplierLocation;
  it("returns JSON-safe API bodies, preserves site descriptions, and previews add/update/delete", async () => {
    const f = await fixture();
    const parentId = kind === "customer" ? f.customer.id : f.supplier.id;
    const parent = { [`${kind}Id`]: parentId };
    const input = { ...parent, ...place, ...(kind === "customer" ? { siteDescription: "North field", defaultSoilTemperatureC: 0 } : {}), facilityDistances: [{ facilityId: f.facility.id, distanceKm: 12, distanceSource: "manual" }] };
    const preview = await add(f.ctx, input, { dryRun: true });
    expect(await read(f.ctx, parentId, preview.data.data.id)).toBeNull();
    const added = await add(f.ctx, input);
    expect(JSON.parse(JSON.stringify(added.data))).toEqual(added.data);
    expect(schema.parse(added.data.data)).toEqual(added.data.data);
    expect(added.data.data).not.toHaveProperty("address");
    // The supplier fixture has an intake without a distance; a first location becomes the default and fills it.
    expect(added.data.warnings).toEqual(kind === "supplier" ? ["Filled the missing distance on 1 intake."] : []);
    if (kind === "customer") expect(added.data.data).toMatchObject({ siteDescription: "North field", defaultSoilTemperatureC: 0 });
    const id = added.data.data.id;
    const before = await read(f.ctx, parentId, id);
    const patch = { ...parent, locationId: id, expectedVersion: 1, city: "Changed" };
    expect((await update(f.ctx, patch, { dryRun: true })).data.data).toMatchObject({ city: "Changed", version: 2 });
    expect(await read(f.ctx, parentId, id)).toEqual(before);
    const changed = await update(f.ctx, patch);
    expect(changed.data.data.version).toBe(2);
    if (kind === "customer") expect(changed.data.data).toMatchObject({ siteDescription: "North field", defaultSoilTemperatureC: 0 });
    const target = { ...parent, locationId: id, expectedVersion: 2 };
    expect((await remove(f.ctx, target, { dryRun: true })).data.data).toEqual(changed.data.data);
    expect(await read(f.ctx, parentId, id)).toEqual(changed.data.data);
    expect((await remove(f.ctx, target)).data.data).toEqual(changed.data.data);
    expect(await read(f.ctx, parentId, id)).toBeNull();
  });
  it("requires the parent, rejects app-only fields and hides wrong-parent locations", async () => {
    const f = await fixture();
    const foreign = await fixture();
    const parentId = kind === "customer" ? f.customer.id : f.supplier.id;
    const input = { [`${kind}Id`]: parentId, ...place };
    for (const bad of [{ ...input, address: "private" }, place]) await expect(add(f.ctx, bad)).rejects.toMatchObject({ code: "validation_failed" });
    const added = await add(f.ctx, input);
    const wrongParent = { [`${kind}Id`]: crypto.randomUUID(), locationId: added.data.data.id, expectedVersion: 1 };
    for (const [operation, body] of [[update, { ...wrongParent, city: "Refused" }], [remove, wrongParent]] as const) {
      await expect(operation(f.ctx, body)).rejects.toMatchObject({ code: "not_found", issues: [{ path: ["locationId"] }] });
      await expect(operation(foreign.ctx, { ...body, [`${kind}Id`]: parentId })).rejects.toMatchObject({ code: "not_found", issues: [{ path: ["locationId"] }] });
      const withoutParent = Object.fromEntries(Object.entries(body).filter(([key]) => key !== `${kind}Id`));
      await expect(operation(f.ctx, withoutParent)).rejects.toMatchObject({ code: "validation_failed" });
    }
  });
});

describe("registered customer location transitions", { timeout: TIMEOUT_MS }, () => {
  it("archives/restores with API readbacks, default warnings and rollback previews", async () => {
    const f = await fixture();
    const foreign = await fixture();
    const added = await runOperation(registry.add_customer_location, f.ctx, { ...place, customerId: f.customer.id, isDefault: true });
    const target = { customerId: f.customer.id, locationId: added.data.data.id, expectedVersion: 1 };
    const preview = await runOperation(registry.archive_customer_location, f.ctx, target, { dryRun: true });
    expect(preview.data.data.archivedAt).toEqual(expect.any(String));
    expect(preview.data.warnings).toHaveLength(1);
    expect((await readApiCustomerLocation(f.ctx, f.customer.id, target.locationId))?.archivedAt).toBeNull();
    const archived = await runOperation(registry.archive_customer_location, f.ctx, target);
    expect(customerLocationRepresentationSchema.parse(archived.data.data)).toEqual(archived.data.data);
    expect(archived.data.warnings).toEqual(preview.data.warnings);
    const restore = { ...target, expectedVersion: 2 };
    expect((await runOperation(registry.restore_customer_location, f.ctx, restore, { dryRun: true })).data.data).toMatchObject({ archivedAt: null, version: 3 });
    expect((await readApiCustomerLocation(f.ctx, f.customer.id, target.locationId))?.archivedAt).toBe(archived.data.data.archivedAt);
    const restored = await runOperation(registry.restore_customer_location, f.ctx, restore);
    expect(restored.data.data).toMatchObject({ archivedAt: null, version: 3 });
    expect(JSON.parse(JSON.stringify(restored.data))).toEqual(restored.data);
    for (const operation of [registry.archive_customer_location, registry.restore_customer_location]) {
      await expect(runOperation(operation, foreign.ctx, restore)).rejects.toMatchObject({ code: "not_found", issues: [{ path: ["locationId"] }] });
      await expect(runOperation(operation, f.ctx, { ...restore, customerId: f.otherCustomer.id })).rejects.toMatchObject({ code: "not_found", issues: [{ path: ["locationId"] }] });
    }
  });
});
