"use server";

import { listOrganizationApiAccess, setOrganizationApiAccess } from "@/data-access/organization-api-access";
import { requirePlatformAdmin } from "@/lib/auth/server";
import { setOrganizationApiAccessSchema } from "@/schemas/organization-api-access";
import type { ActionResult } from "@/types/actions";
import { toActionFailure } from "./action-errors";

async function toResult<T>(fn: () => Promise<T>, fallback: string): Promise<ActionResult<T>> {
  try {
    return { success: true, data: await fn() };
  } catch (error) {
    return toActionFailure(error, {
      fallbackMessage: fallback,
      log: { message: "organization API access action failed" },
    });
  }
}

export async function setOrganizationApiAccessFn(input: unknown) {
  return toResult(async () => {
    await requirePlatformAdmin();
    const data = setOrganizationApiAccessSchema.parse(input);
    await setOrganizationApiAccess(data.id, data.enabled);
  }, "Failed to change organization API access.");
}

export async function listOrganizationApiAccessFn() {
  return toResult(async () => {
    await requirePlatformAdmin();
    return listOrganizationApiAccess();
  }, "Failed to load organization API access.");
}
