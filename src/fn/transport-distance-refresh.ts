"use server";

import { getTransportDistanceDrift } from "@/data-access/transport-distance-drift";
import type { TransportDistanceDrift } from "@/data-access/transport-distance-drift";
import { refreshDeliveryDistance, refreshFeedstockDistance } from "@/data-access/transport-distance-refresh";
import { refreshTransportDistanceSchema, transportDistanceTargetSchema, type RefreshTransportDistanceInput, type TransportDistanceTarget } from "@/schemas/transport-distance-refresh";
import type { ActionResult } from "@/types/actions";
import { withAction } from "./with-action";

export async function getTransportDistanceDriftFn(input: TransportDistanceTarget): Promise<ActionResult<TransportDistanceDrift>> {
  return withAction(ctx => getTransportDistanceDrift(ctx, transportDistanceTargetSchema.parse(input)), {
    fallbackMessage: "The transport distance could not be loaded. Try again.",
  });
}

export async function refreshFeedstockDistanceFn(input: RefreshTransportDistanceInput): Promise<ActionResult<TransportDistanceDrift>> {
  return withAction(ctx => refreshFeedstockDistance(ctx, refreshTransportDistanceSchema.parse(input)), {
    fallbackMessage: "The feedstock distance was not refreshed. Try again.",
  });
}

export async function refreshDeliveryDistanceFn(input: RefreshTransportDistanceInput): Promise<ActionResult<TransportDistanceDrift>> {
  return withAction(ctx => refreshDeliveryDistance(ctx, refreshTransportDistanceSchema.parse(input)), {
    fallbackMessage: "The delivery distance was not refreshed. Try again.",
  });
}
