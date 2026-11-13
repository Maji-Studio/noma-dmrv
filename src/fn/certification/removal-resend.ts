"use server";

import { withAction } from "../with-action";
import { removalResendSchema, type RemovalResendInput } from "@/schemas/removal-resend";
import type { ActionResult } from "@/types/actions";
import type { RemovalRegistryPresence } from "@/lib/certification/removal-registry-presence";
import { checkRemovalRegistryPresenceCore, prepareRemovalResendCore } from "./removal-resend-core";

export async function checkRemovalRegistryPresence(input: RemovalResendInput): Promise<ActionResult<RemovalRegistryPresence>> {
  return withAction((ctx) => checkRemovalRegistryPresenceCore(ctx, removalResendSchema.parse(input)));
}

export async function prepareRemovalResend(input: RemovalResendInput): Promise<ActionResult<Awaited<ReturnType<typeof prepareRemovalResendCore>>>> {
  return withAction((ctx) => prepareRemovalResendCore(ctx, removalResendSchema.parse(input)));
}
