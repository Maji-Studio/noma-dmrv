import type { SoilTemperatureGate } from "@/lib/isometric/utils/durability-aggregation";

interface MemberBatchGateFacts {
  id: string;
  facilityEmissionsGateBlockers?: string[];
  facilityEmissionsGateFacts?: string[];
}

interface BatchDurabilityFacts {
  creditBatchId: string;
  durabilityOption: string;
}

export function attributeSoilTemperatureBlockers<
  T extends MemberBatchGateFacts,
>(
  members: readonly T[],
  batches: readonly BatchDurabilityFacts[],
  soilTemperatureGate: Pick<SoilTemperatureGate, "blockers" | "blockerFacts">,
): T[] {
  const affectedBatchIds = new Set(
    batches
      .filter((batch) => batch.durabilityOption === "200_year")
      .map((batch) => batch.creditBatchId),
  );

  return members.map((member) => ({
    ...member,
    facilityEmissionsGateFacts: [
      ...(member.facilityEmissionsGateFacts ?? []),
      ...(affectedBatchIds.has(member.id) ? soilTemperatureGate.blockerFacts : []),
    ],
    facilityEmissionsGateBlockers: [
      ...(member.facilityEmissionsGateBlockers ?? []),
      ...(affectedBatchIds.has(member.id) ? soilTemperatureGate.blockers : []),
    ],
  }));
}
