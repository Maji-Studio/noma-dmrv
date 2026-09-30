/**
 * DB-backed tests for the conflict a refused feedstock-type delete names.
 *
 * A production process and a formulation ingredient have no code of their
 * own, so the refusal points at the coded parent the operator manages them
 * from: the facility and the formulation (docs/architecture.md, conflict
 * section).
 *
 * Requires a running database (uses DATABASE_URL from .env.test or test
 * defaults).
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { inArray } from "drizzle-orm";
import { db } from "@/db";
import { facilities } from "@/db/schema/facilities";
import { feedstockTypes } from "@/db/schema/feedstock";
import { productionProcesses } from "@/db/schema/production-processes";
import { formulationIngredients, formulations } from "@/db/schema/products";
import { deleteFeedstockType } from "@/data-access/feedstock-types";
import { ActionConflictError } from "@/lib/errors";
import { ensureTestOrg, makeTestOrgContext, TEST_ORG_ID } from "./helpers/test-org";

const ctx = makeTestOrgContext();
const runId = Date.now().toString(36);

const createdIds = {
  facilities: [] as string[],
  feedstockTypes: [] as string[],
  productionProcesses: [] as string[],
  formulations: [] as string[],
};

async function insertFeedstockType(tag: string): Promise<string> {
  const [row] = await db
    .insert(feedstockTypes)
    .values({
      organizationId: TEST_ORG_ID,
      name: `Delete-Conflict ${tag} ${runId}`,
      code: `FT-DC-${tag}-${runId}`,
      category: "forestry",
    })
    .returning({ id: feedstockTypes.id });
  createdIds.feedstockTypes.push(row.id);
  return row.id;
}

async function refusal(feedstockTypeId: string): Promise<ActionConflictError> {
  const error = await deleteFeedstockType(ctx, feedstockTypeId).then(
    () => null,
    (caught: unknown) => caught,
  );
  expect(error).toBeInstanceOf(ActionConflictError);
  return error as ActionConflictError;
}

beforeAll(async () => {
  await ensureTestOrg();
});

afterAll(async () => {
  if (createdIds.productionProcesses.length) {
    await db.delete(productionProcesses).where(inArray(productionProcesses.id, createdIds.productionProcesses));
  }
  if (createdIds.formulations.length) {
    // Ingredients cascade with their formulation.
    await db.delete(formulations).where(inArray(formulations.id, createdIds.formulations));
  }
  if (createdIds.feedstockTypes.length) {
    await db.delete(feedstockTypes).where(inArray(feedstockTypes.id, createdIds.feedstockTypes));
  }
  if (createdIds.facilities.length) {
    await db.delete(facilities).where(inArray(facilities.id, createdIds.facilities));
  }
});

describe("deleteFeedstockType conflict", () => {
  it("names the facility when a production process uses the type", async () => {
    const feedstockTypeId = await insertFeedstockType("PP");
    const code = `FAC-DC-${runId}`;
    const [facility] = await db
      .insert(facilities)
      .values({ organizationId: TEST_ORG_ID, name: `Delete-Conflict ${runId}`, code })
      .returning({ id: facilities.id });
    createdIds.facilities.push(facility.id);
    const [process] = await db
      .insert(productionProcesses)
      .values({ organizationId: TEST_ORG_ID, facilityId: facility.id, feedstockTypeId })
      .returning({ id: productionProcesses.id });
    createdIds.productionProcesses.push(process.id);

    const error = await refusal(feedstockTypeId);

    expect(error.conflict).toEqual({ entity: "facility", id: facility.id, code });
  });

  it("names the formulation when a formulation ingredient uses the type", async () => {
    const feedstockTypeId = await insertFeedstockType("FI");
    const code = `BCF-DC-${runId}`;
    const [formulation] = await db
      .insert(formulations)
      .values({ organizationId: TEST_ORG_ID, name: `Delete-Conflict ${runId}`, code })
      .returning({ id: formulations.id });
    createdIds.formulations.push(formulation.id);
    await db
      .insert(formulationIngredients)
      .values({ organizationId: TEST_ORG_ID, formulationId: formulation.id, feedstockTypeId });

    const error = await refusal(feedstockTypeId);

    expect(error.conflict).toEqual({ entity: "formulation", id: formulation.id, code });
  });
});
