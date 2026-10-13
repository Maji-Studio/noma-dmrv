import { beforeAll, expect, it } from "vitest";
import { getOrderById } from "@/data-access/orders";
import { getFeedstockTypeById } from "@/data-access/feedstock-types";
import { withLineageFixture } from "./helpers/certification-lineage-fixture";
import { createIntakeFixture, removeIntakeFixture } from "./helpers/operation-fixture";
import { ensureTestOrg, makeTestOrgContext } from "./helpers/test-org";

beforeAll(() => ensureTestOrg());

it("reads orders and feedstock types only within the owning organization", async () => {
  const other = await createIntakeFixture("picker-isolation");
  try {
    await withLineageFixture(async (fixture) => {
      const owner = makeTestOrgContext();
      await expect(getOrderById(owner, fixture.orderId)).resolves.toMatchObject({
        id: fixture.orderId, organizationId: owner.organizationId,
      });
      await expect(getFeedstockTypeById(owner, fixture.feedstockTypeId)).resolves.toMatchObject({
        id: fixture.feedstockTypeId, organizationId: owner.organizationId,
      });
      await expect(getOrderById(other.ctx, fixture.orderId)).rejects.toThrow("The record could not be found.");
      await expect(getFeedstockTypeById(other.ctx, fixture.feedstockTypeId)).rejects.toThrow("The record could not be found.");
    }, "none");
  } finally {
    await removeIntakeFixture(other);
  }
});
