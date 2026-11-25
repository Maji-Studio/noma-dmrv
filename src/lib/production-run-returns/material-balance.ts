/** Dry accounting at the run boundary, independent of current bin holdings. */
export interface RunMaterialBalanceInput {
  runId: string;
  consumedDryKg: number;
  usableOutputDryKg: number;
  activeReturnedDryKg: number;
}

export function calculateRunMaterialBalance(input: RunMaterialBalanceInput) {
  return {
    ...input,
    conversionLossDryKg: input.consumedDryKg - input.usableOutputDryKg - input.activeReturnedDryKg,
  };
}
