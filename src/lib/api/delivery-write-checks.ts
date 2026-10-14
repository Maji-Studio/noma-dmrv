import { BILL_OF_LADING_WARNING } from "@/lib/delivery-guidance";
import type { ApiContext } from "@/lib/auth/api-context";
import { DELIVERY_REPRESENTATION_REVISION } from "@/config/api-rest";
import { DomainError } from "@/lib/domain-errors";
import { deliveryReferenceNotFound } from "@/lib/delivery-domain-errors";
import { describeRecordedDelivery, describeUpdatedDelivery, recordDelivery, updateDeliveryOperation } from "@/lib/operations/deliveries";
import type { Operation, OperationResult } from "@/lib/operations/runner";
import { readApiDelivery } from "@/lib/read-models/api-deliveries";
import { representDelivery, deliveryRepresentationSchema, type DeliveryRepresentation } from "@/lib/representations/deliveries";
import { deliveryAllocationSchema } from "@/lib/representations/delivery-writes";
import { recordDeliveryInput } from "@/schemas/delivery-input";
import { ApiHttpError } from "./http-error";

type RecordedDelivery = Awaited<ReturnType<typeof recordDelivery.execute>>;
interface DeliveryWriteOutput { delivery: DeliveryRepresentation; warnings: string[] }
export interface DeliveryCreateOutput extends DeliveryWriteOutput {
  basisFingerprint: string;
  allocations: RecordedDelivery["allocations"];
}

/** Store the published row and guidance in the idempotent outcome. Creates have no uploaded documents. */
export const representationCheckedRecord: Operation<typeof recordDeliveryInput, DeliveryCreateOutput> = {
  ...recordDelivery,
  describe: describeRecordedDelivery,
  execute: async (scope, input) => {
    const saved = await recordDelivery.execute(scope, input);
    return { ...saved, delivery: representDelivery(saved.delivery), warnings: [BILL_OF_LADING_WARNING] };
  },
};

/** Revision checks follow replay. The shared writer owns existence, archive and row-version guards. */
export function representationCheckedUpdate(id: string, revision: number): Operation<typeof updateDeliveryOperation.input, DeliveryWriteOutput> {
  return {
    ...updateDeliveryOperation,
    describe: (input, output) => describeUpdatedDelivery(input, output.delivery),
    execute: async (scope, input) => {
      if (revision !== DELIVERY_REPRESENTATION_REVISION) {
        const current = await readApiDelivery(scope.ctx, { id }, scope.tx);
        if (current.archivedAt) throw deliveryReferenceNotFound(["deliveryId"], "Delivery");
        throw new DomainError("stale_version", "The representation has changed.");
      }
      const saved = await updateDeliveryOperation.execute(scope, input);
      return { delivery: representDelivery(saved), warnings: [] };
    },
  };
}

export async function withCurrentOnStale<T>(ctx: ApiContext, id: string, fn: () => Promise<T>): Promise<T> {
  try { return await fn(); } catch (error) {
    if (error instanceof DomainError && error.code === "stale_version") {
      const current = await readApiDelivery(ctx, { id });
      throw new ApiHttpError(412, "stale_version", "The delivery has changed. Read the current representation before retrying.", current);
    }
    throw error;
  }
}

export function deliveryBody(output: DeliveryWriteOutput) {
  return { data: deliveryRepresentationSchema.parse(output.delivery), ...(output.warnings.length ? { warnings: output.warnings } : {}) };
}
export function recordedDeliveryBody(result: OperationResult<DeliveryCreateOutput>, dryRun: boolean) {
  return { ...deliveryBody(result.data), allocations: result.data.allocations.map(allocation => deliveryAllocationSchema.parse(allocation)),
    ...(dryRun ? { stockEffects: result.stockEffects, basisFingerprint: result.data.basisFingerprint } : {}) };
}
