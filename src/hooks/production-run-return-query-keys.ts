export const productionRunReturnKeys = {
  all: ["productionRunReturns"] as const,
  rows: (runId: string) => [...productionRunReturnKeys.all, "rows", runId] as const,
  eligibility: (runId: string) => [...productionRunReturnKeys.all, "eligibility", runId] as const,
  balance: (runId: string) => [...productionRunReturnKeys.all, "balance", runId] as const,
};

