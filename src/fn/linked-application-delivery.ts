"use server";

import { z } from "zod";
import { getLinkedApplicationDelivery } from "@/data-access/applications";
import { withAction } from "./with-action";
import type { ActionResult } from "@/types/actions";

export async function getLinkedApplicationDeliveryFn(applicationId: string): Promise<ActionResult<Awaited<ReturnType<typeof getLinkedApplicationDelivery>>>> {
  return withAction(ctx => getLinkedApplicationDelivery(ctx, z.uuid().parse(applicationId)), {
    fallbackMessage: "Failed to load linked record",
    log: { message: "linked record read failed", context: { op: "linked-application-delivery:read" } },
  });
}
