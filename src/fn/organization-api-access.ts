"use server";

import { setOrganizationApiAccess } from "@/data-access/organization-api-access";
import { setOrganizationApiAccessSchema } from "@/schemas/organization-api-access";
import { withAction } from "./with-action";

export async function setOrganizationApiAccessFn(input: unknown) {
  return withAction(async (ctx) => {
    const data = setOrganizationApiAccessSchema.parse(input);
    await setOrganizationApiAccess(ctx, data.id, data.enabled);
  });
}
