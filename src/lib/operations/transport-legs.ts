import { createTransportLegInTransaction } from "@/data-access/transport-legs";
import type { TransportLeg } from "@/db/schema";
import { createTransportLegSchema } from "@/schemas/transport-legs";
import type { Operation } from "./runner";

export const recordTransportLeg: Operation<typeof createTransportLegSchema, TransportLeg> = {
  id: "record_transport_leg",
  input: createTransportLegSchema,
  supportsDryRun: false,
  execute: ({ ctx, tx, source }, input) => createTransportLegInTransaction(ctx, tx, input, source),
};
