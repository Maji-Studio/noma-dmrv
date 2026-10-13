/** Real handlers, credentials and Postgres. Written for reviewer execution; never run by the implementation agent. */
import { afterEach, beforeEach, expect, it } from "vitest";
import { and, eq } from "drizzle-orm";
import { db } from "@/db";
import { facilities } from "@/db/schema";
import { updateFacility } from "@/data-access/facilities";
import { GET as LIST } from "@/app/api/v1/facilities/route";
import { GET } from "@/app/api/v1/facilities/[idOrCode]/route";
import { createApiLabFixture, labApiParams, labApiRequest, removeApiLabFixture, type ApiLabFixture } from "./helpers/api-lab-sample-fixture";

const TIMEOUT_MS = 60_000;
/** Facility representation revision 2 added durabilityOption. */
const FACILITY_REVISION = 2;
let a: ApiLabFixture;
const get = () => GET(labApiRequest("facilities", `/${a.facility.id}`, a.key), labApiParams(a.facility.id));

beforeEach(async () => { a = await createApiLabFixture({ durabilityOption: "200_year" }); }, TIMEOUT_MS);
afterEach(async () => { await removeApiLabFixture(a); }, TIMEOUT_MS);

it("publishes the facility durability tier on get and list, with a revision 2 ETag", { timeout: TIMEOUT_MS }, async () => {
  const response = await get();
  expect(response.status).toBe(200);
  const { data } = await response.json();
  expect(data).toMatchObject({ id: a.facility.id, durabilityOption: "200_year", timeZone: "Africa/Dar_es_Salaam" });
  expect(response.headers.get("etag")).toBe(`"${data.version}.${FACILITY_REVISION}"`);
  const page = await (await LIST(labApiRequest("facilities", `?code=${encodeURIComponent(a.facility.code)}`, a.key))).json();
  expect(page.data).toEqual([data]);
});

it("changes the facility ETag and tier when an operator edits the tier", { timeout: TIMEOUT_MS }, async () => {
  const before = await get();
  const { data: beforeData } = await before.json();
  await updateFacility(a.ctx, a.facility.id, { expectedVersion: beforeData.version, durabilityOption: "1000_year" });
  const after = await get();
  const { data: afterData } = await after.json();
  expect(afterData.durabilityOption).toBe("1000_year");
  expect(afterData.version).toBe(beforeData.version + 1);
  expect(after.headers.get("etag")).not.toBe(before.headers.get("etag"));
  expect(after.headers.get("etag")).toBe(`"${afterData.version}.${FACILITY_REVISION}"`);
  const [row] = await db.select({ durabilityOption: facilities.durabilityOption }).from(facilities)
    .where(and(eq(facilities.id, a.facility.id), eq(facilities.organizationId, a.ctx.organizationId)));
  expect(row.durabilityOption).toBe("1000_year");
});
