"use server";

import { submitRateLimit } from "@/lib/certification/shared";

import { withAction } from "../with-action";
import { removalResendSchema, type RemovalResendInput } from "@/schemas/removal-resend";
import type { ActionResult } from "@/types/actions";
import type { RemovalRegistryPresence } from "@/lib/certification/removal-registry-presence";
import { checkRemovalRegistryPresenceCore, prepareRemovalResendCore } from "./removal-resend-core";

const PRESENCE_RATE_LIMIT_MAX = 30;

export async function checkRemovalRegistryPresence(input: RemovalResendInput): Promise<ActionResult<RemovalRegistryPresence>> {
  return withAction((ctx) => checkRemovalRegistryPresenceCore(ctx, removalResendSchema.parse(input)), {
    rateLimit: { ...submitRateLimit("cert:check-removal-presence"), max: PRESENCE_RATE_LIMIT_MAX },
  });
}

export async function prepareRemovalResend(input: RemovalResendInput): Promise<ActionResult<Awaited<ReturnType<typeof prepareRemovalResendCore>>>> {
  return withAction((ctx) => prepareRemovalResendCore(ctx, removalResendSchema.parse(input)), { rateLimit: submitRateLimit("cert:prepare-removal-resend") });
}
