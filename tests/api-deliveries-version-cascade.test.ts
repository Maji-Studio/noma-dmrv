/** Outside writers must invalidate the delivery's REST ETag. */
import { afterEach, describe, expect, it } from "vitest";
import { archiveFacility, restoreFacility } from "@/data-access/facilities";
import { updatePostedDelivery } from "@/lib/operations/deliveries";
import { runOperationInProcess } from "@/lib/operations/runner";
import { DELIVERY_REPRESENTATION_REVISION } from "@/config/api-rest";
import {
  createApiDeliveryWriteFixture, removeApiDeliveryWriteFixture, postDelivery, readDelivery,
  DELIVERY_TEST_TIMEOUT_MS, type ApiDeliveryWriteFixture,
} from "./helpers/api-delivery-write-fixture";

const CORRECTED_WET_KG = 90;
const CORRECTED_MOISTURE = 25;
const fixtures: ApiDeliveryWriteFixture[] = [];
afterEach(async () => {
  for (const f of fixtures.splice(0)) await removeApiDeliveryWriteFixture(f);
}, DELIVERY_TEST_TIMEOUT_MS);
async function fixture() {
  const f = await createApiDeliveryWriteFixture();
  fixtures.push(f);
  const response = await postDelivery(f);
  expect(response.status).toBe(201);
  const { data } = await response.json();
  return { f, before: await readDelivery(f, data.id) };
}
function expectNewVersion(before: Awaited<ReturnType<typeof readDelivery>>, after: Awaited<ReturnType<typeof readDelivery>>) {
  expect(after.data.version).toBeGreaterThan(before.data.version);
  expect(after.etag).not.toBe(before.etag);
  expect(after.etag).toBe(`"${after.data.version}.${DELIVERY_REPRESENTATION_REVISION}"`);
}

describe("delivery version cascades", { timeout: DELIVERY_TEST_TIMEOUT_MS }, () => {
  it.each([
    { deliveredWetMassKg: CORRECTED_WET_KG },
    { moistureContentPercent: CORRECTED_MOISTURE },
  ])("UI stock correction invalidates the ETag: %j", async changes => {
    const { f, before } = await fixture();
    await runOperationInProcess(updatePostedDelivery, f.ctx, {
      deliveryId: before.data.id, expectedVersion: before.data.version, ...changes,
    });
    const after = await readDelivery(f, before.data.id);
    expectNewVersion(before, after);
    expect(after.data).toMatchObject("deliveredWetMassKg" in changes
      ? { deliveredWetMassKg: CORRECTED_WET_KG } : { moisturePercent: CORRECTED_MOISTURE });
    expect(after.data.dryBiocharKg).not.toBe(before.data.dryBiocharKg);
  });

  it("facility archive and restore each invalidate the ETag", async () => {
    const { f, before } = await fixture();
    const facility = await archiveFacility(f.ctx, f.facility.id, f.facility.version);
    const archived = await readDelivery(f, before.data.id);
    expectNewVersion(before, archived);
    expect(archived.data.archivedAt).not.toBeNull();
    await restoreFacility(f.ctx, f.facility.id, facility.version);
    const restored = await readDelivery(f, before.data.id);
    expectNewVersion(archived, restored);
    expect(restored.data.archivedAt).toBeNull();
  });
});
