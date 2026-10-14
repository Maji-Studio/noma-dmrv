/** Real-DB contracts for customer-scoped locations and delivery-bin search. */
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { eq, inArray } from "drizzle-orm";
import { db } from "@/db";
import { customerLocations, customers, facilities, formulations, organizations, storageLocations } from "@/db/schema";
import { getEntities, getEntityById } from "@/data-access/entities";
import { STRICT_FORMULATION_MATCH } from "@/schemas/biochar-products";
import { ENTITY_SEARCH_LIMIT } from "@/config/forms";
import { makeTestOrgContext } from "./helpers/test-org";

const tag = randomUUID();
const orgId = `picker-org-${tag}`;
const otherOrgId = `picker-other-${tag}`;
const ctx = { ...makeTestOrgContext(), organizationId: orgId };
let fixture: {
  customerId: string;
  otherCustomerId: string;
  foreignCustomerId: string;
  locationId: string;
  unnamedId: string;
  foreignLocationId: string;
  facilityId: string;
  formulationId: string;
  matchingBinId: string;
  unassignedBinId: string;
} | undefined;

beforeAll(async () => {
  fixture = await db.transaction(async (tx) => {
    await tx.insert(organizations).values([
      { id: orgId, name: `Picker ${tag}`, slug: orgId },
      { id: otherOrgId, name: `Other picker ${tag}`, slug: otherOrgId },
    ]);
    const [customer, otherCustomer, foreignCustomer] = await tx.insert(customers).values([
      { organizationId: orgId, code: "C-1", name: "Picker customer" },
      { organizationId: orgId, code: "C-2", name: "Other customer" },
      { organizationId: otherOrgId, code: "C-1", name: "Foreign customer" },
    ]).returning();
    const [location, unnamed, , foreignLocation] = await tx.insert(customerLocations).values([
      { organizationId: orgId, customerId: customer.id, name: "North field" },
      { organizationId: orgId, customerId: customer.id, name: null },
      { organizationId: orgId, customerId: otherCustomer.id, name: "North field" },
      { organizationId: otherOrgId, customerId: foreignCustomer.id, name: "North field" },
    ]).returning();
    const [facility] = await tx.insert(facilities).values({
      organizationId: orgId, code: "FAC-1", name: "Picker facility", timezone: "UTC",
    }).returning();
    const [formulation, otherFormulation] = await tx.insert(formulations).values([
      { organizationId: orgId, code: "F-1", name: "Picker mix", biocharRatio: 1 },
      { organizationId: orgId, code: "F-2", name: "Other mix", biocharRatio: 1 },
    ]).returning();
    const [matchingBin, unassignedBin] = await tx.insert(storageLocations).values([
      { organizationId: orgId, facilityId: facility.id, code: "B-1", name: "Matching bin", type: "product_bin" as const, formulationId: formulation.id },
      { organizationId: orgId, facilityId: facility.id, code: "B-2", name: "Unassigned bin", type: "product_bin" as const },
      { organizationId: orgId, facilityId: facility.id, code: "B-3", name: "Other mix bin", type: "product_bin" as const, formulationId: otherFormulation.id },
    ]).returning();
    return {
      customerId: customer.id, otherCustomerId: otherCustomer.id, foreignCustomerId: foreignCustomer.id,
      locationId: location.id, unnamedId: unnamed.id, foreignLocationId: foreignLocation.id,
      facilityId: facility.id, formulationId: formulation.id,
      matchingBinId: matchingBin.id, unassignedBinId: unassignedBin.id,
    };
  });
});

afterAll(async () => {
  if (!fixture) return;
  await db.transaction(async (tx) => {
    const orgs = [orgId, otherOrgId];
    await tx.delete(customerLocations).where(inArray(customerLocations.organizationId, orgs));
    await tx.delete(customers).where(inArray(customers.organizationId, orgs));
    await tx.delete(storageLocations).where(eq(storageLocations.organizationId, orgId));
    await tx.delete(formulations).where(eq(formulations.organizationId, orgId));
    await tx.delete(facilities).where(eq(facilities.organizationId, orgId));
    await tx.delete(organizations).where(inArray(organizations.id, orgs));
  });
});

function requireFixture() {
  if (!fixture) throw new Error("Picker search fixture was not created");
  return fixture;
}

describe("customerLocation entity search", () => {
  it("filters by customer and name within the organization", async () => {
    const f = requireFixture();
    const options = await getEntities(ctx, { entityType: "customerLocation", filterBy: { customerId: f.customerId }, search: "north" });
    expect(options.map((option) => option.id)).toEqual([f.locationId]);
  });

  it("does not return another organization's locations even with its customer id", async () => {
    const f = requireFixture();
    expect(await getEntities(ctx, { entityType: "customerLocation", filterBy: { customerId: f.foreignCustomerId } })).toEqual([]);
    expect(await getEntityById(ctx, "customerLocation", f.foreignLocationId)).toBeNull();
  });

  it("preserves the unnamed-location label and resolves selections by id", async () => {
    const f = requireFixture();
    const options = await getEntities(ctx, { entityType: "customerLocation", filterBy: { customerId: f.customerId } });
    expect(options.map((option) => option.id).sort()).toEqual([f.locationId, f.unnamedId].sort());
    expect(await getEntityById(ctx, "customerLocation", f.unnamedId)).toEqual({ id: f.unnamedId, code: "", name: "Unnamed location" });
  });

  it("fails closed without a customer or organization scope", async () => {
    expect(await getEntities(ctx, { entityType: "customerLocation" })).toEqual([]);
    await expect(getEntities({ ...ctx, organizationId: "" }, { entityType: "customerLocation" })).rejects.toThrow();
  });
});

describe("storage-bin formulation filter", () => {
  async function bins(strict: boolean) {
    const f = requireFixture();
    return getEntities(ctx, {
      entityType: "storageLocation",
      filterBy: {
        facilityId: f.facilityId, type: "product_bin", formulationId: f.formulationId,
        ...(strict ? { formulationMatch: STRICT_FORMULATION_MATCH } : {}),
      },
      limit: ENTITY_SEARCH_LIMIT,
    });
  }

  it("restricts delivery sources to exactly the order's formulation", async () => {
    expect((await bins(true)).map((option) => option.id)).toEqual([requireFixture().matchingBinId]);
  });

  it("keeps matching and unassigned bins for existing callers", async () => {
    const f = requireFixture();
    expect((await bins(false)).map((option) => option.id).sort()).toEqual([f.matchingBinId, f.unassignedBinId].sort());
  });

  it("does not widen a strict search without a formulation", async () => {
    expect(await getEntities(ctx, { entityType: "storageLocation", filterBy: { formulationMatch: STRICT_FORMULATION_MATCH } })).toEqual([]);
  });
});
