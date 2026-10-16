import { randomUUID } from "node:crypto";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { db } from "@/db";
import { biocharProducts } from "@/db/schema";
import { getBiocharProducts } from "@/data-access/biochar-products";
import { getBiocharProducts as getProductOptions } from "@/data-access/entities/biochar-products";
import { getStorageLocationWithFacility } from "@/data-access/storage-locations";
import type { OrgContext } from "@/lib/auth/server";
import { formatUtcDate } from "@/lib/date-utils";
import { formatCalendarDate } from "@/lib/format-utils";
import { cleanupActivityWriteFixture, createActivityWriteFixture } from "./helpers/activity-write-fixture";
import { insertEstablishedOutputApplicationFixture, outputProductFixtureValues, preparePureOutputProductFixture } from "./helpers/output-contract-fixtures";

const PAGE_SIZE = 2;
const PICKER_LIMIT = 3;
const SEARCH = "DAY-READ-";
const APPLICATION_TONNES = 0.01;
const APPLICATION_DATE = new Date("2026-01-12T00:00:00.000Z");
const OLD_CREATED_AT = new Date("2026-01-10T10:00:00.000Z");
const NEW_CREATED_AT = new Date("2026-01-10T11:00:00.000Z");
const EXPLICIT_PRODUCTION_DAY = "2026-01-09";
const ctx: OrgContext = {
  organizationId: `calendar-day-${randomUUID()}`,
  userId: `calendar-day-actor-${randomUUID()}`,
  orgRole: "owner",
  isPlatformAdmin: false,
};

let fixture: Awaited<ReturnType<typeof createActivityWriteFixture>>;
const [lowerId, higherId] = [randomUUID(), randomUUID()].sort();
const oldestDayId = randomUUID();
const newestDayId = randomUUID();
const olderProductId = randomUUID();
const ascendingIds = [oldestDayId, olderProductId, lowerId, higherId, newestDayId];
const descendingIds = [newestDayId, lowerId, higherId, olderProductId, oldestDayId];

beforeAll(async () => {
  fixture = await createActivityWriteFixture(ctx);
  // Deliberately insert ties in the opposite order to the expected tiebreakers.
  // Declare insert values so each layer gets its own database posting sequence.
  const products = await db.insert(biocharProducts).values(await outputProductFixtureValues(db, [
    { id: higherId, productionDate: "2026-01-10", createdAt: NEW_CREATED_AT },
    { id: olderProductId, productionDate: "2026-01-10", createdAt: OLD_CREATED_AT },
    { id: lowerId, productionDate: "2026-01-10", createdAt: NEW_CREATED_AT },
    { id: oldestDayId, productionDate: "2026-01-09", createdAt: NEW_CREATED_AT },
    { id: newestDayId, productionDate: "2026-01-11", createdAt: OLD_CREATED_AT },
  ].map((product) => ({
    organizationId: ctx.organizationId,
    facilityId: fixture.facility.id,
    formulationId: fixture.product.formulationId,
    storageLocationId: fixture.product.storageLocationId,
    ...product,
    code: `${SEARCH}${product.id}`,
  })))).returning();
  for (const product of products) await preparePureOutputProductFixture(db, product.id);
  await insertEstablishedOutputApplicationFixture(db, {
    organizationId: ctx.organizationId,
    code: "DAY-READ-AP",
    deliveryId: fixture.delivery.id,
    applicationDate: APPLICATION_DATE,
    biocharAppliedTons: APPLICATION_TONNES,
    biocharAppliedDryTons: APPLICATION_TONNES * fixture.delivery.massDryKg! / fixture.delivery.deliveredWetMassKg!,
    fieldSizeHa: 1,
  }, row => row);
});

afterAll(async () => {
  await cleanupActivityWriteFixture(ctx);
});

describe("calendar-day read regressions", () => {
  const originalTz = process.env.TZ;
  beforeEach(() => {
    process.env.TZ = "Europe/Zurich";
  });
  afterEach(() => {
    if (originalTz === undefined) delete process.env.TZ;
    else process.env.TZ = originalTz;
  });

  it.each([
    { sortOrder: "asc" as const, expected: ascendingIds },
    { sortOrder: "desc" as const, expected: descendingIds },
  ])("keeps production-date ties stable across $sortOrder pages", async ({ sortOrder, expected }) => {
    const pages = await Promise.all(
      Array.from({ length: Math.ceil(expected.length / PAGE_SIZE) }, (_, index) =>
        getBiocharProducts(ctx, {
          facilityId: fixture.facility.id,
          search: SEARCH,
          sortOrder,
          page: index + 1,
          pageSize: PAGE_SIZE,
        }),
      ),
    );
    expect(pages.flatMap((page) => page.items.map((product) => product.id))).toEqual(expected);
  });

  it("uses the same stable newest-first order for limited picker results", async () => {
    const options = await getProductOptions(ctx, {
      facilityId: fixture.facility.id,
      search: SEARCH,
      limit: PICKER_LIMIT,
    });
    expect(options.map((option) => option.id)).toEqual(descendingIds.slice(0, PICKER_LIMIT));
  });

  it("decodes the last application day before formatting it on a non-UTC server", async () => {
    const bin = await getStorageLocationWithFacility(ctx, fixture.delivery.storageLocationId);
    expect(formatCalendarDate(bin.productInventory.lastAppliedAt)).toBe("Jan 12, 2026");
    expect(bin.productInventory.lastAppliedAt).toEqual(APPLICATION_DATE);
    const sourceBin = await getStorageLocationWithFacility(ctx, fixture.run.biocharStorageLocationId!);
    expect(sourceBin.productInventory.lastAppliedAt).toBeNull();
  });

  it("preserves an explicit fixture production day over the linked run day", async () => {
    const values = await outputProductFixtureValues(db, {
      ...fixture.product,
      productionDate: EXPLICIT_PRODUCTION_DAY,
    });
    expect(values.productionDate).toBe(EXPLICIT_PRODUCTION_DAY);
  });

  it("defaults an omitted fixture production day to the linked run day", async () => {
    const values = await outputProductFixtureValues(db, {
      ...fixture.product,
      productionDate: undefined,
    });
    expect(values.productionDate).toBe(formatUtcDate(fixture.run.startTime));
  });
});
