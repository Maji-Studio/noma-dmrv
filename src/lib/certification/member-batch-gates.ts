interface MemberBatchGateFacts {
  id: string;
  facilityEmissionsGateBlockers?: string[];
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
  soilTemperatureBlockers: readonly string[],
): T[] {
  const affectedBatchIds = new Set(
    batches
      .filter((batch) => batch.durabilityOption === "200_year")
      .map((batch) => batch.creditBatchId),
  );

  return members.map((member) => ({
    ...member,
    facilityEmissionsGateBlockers: [
      ...(member.facilityEmissionsGateBlockers ?? []),
      ...(affectedBatchIds.has(member.id) ? soilTemperatureBlockers : []),
    ],
  }));
}
