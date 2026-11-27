"use server";

import { loadFacilityFailedRunEmissionTodos } from "@/data-access/failed-run-emission-guidance";
import { requireOrgFacility } from "@/data-access/utils";
import { uuidSchema } from "@/schemas/helpers";
import { withAction } from "../with-action";

/** Checks that can exist before the first credit batch is declared. */
export async function loadFacilityFailedRunEmissionTodosFn(facilityId: string) {
  return withAction(async ctx => {
    const validFacilityId = uuidSchema().parse(facilityId);
    await requireOrgFacility(ctx, validFacilityId);
    return loadFacilityFailedRunEmissionTodos(ctx, validFacilityId);
  });
}
