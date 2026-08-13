import type { components } from "./generated/certify";

export type CreateBiocharApplicationRequest =
  components["schemas"]["CreateBiocharApplicationRequest"];

export type BiocharApplicationGateReason =
  | "multi_batch_allocation_contract_missing"
  | "arrival_departure_mass_contract_missing";

export type BiocharApplicationBuildResult = {
  status: "unsupported";
  ready: false;
  reason: BiocharApplicationGateReason;
  message: string;
  request: null;
};

export interface NetMassBiocharApplicationInput {
  applicationId: string;
  creditBatchIds: string[];
  netMassKg: number;
}

/**
 * Hard contract gate. Noma currently holds net mass, while the generated API
 * requires distinct observed arrival and departure masses. No request may be
 * built until Isometric defines that encoding; multi-batch allocation is also
 * unsupported until its physical-mass contract is confirmed.
 */
export function buildBiocharApplicationRequestIfReady(
  input: NetMassBiocharApplicationInput,
): BiocharApplicationBuildResult {
  const creditBatchIds = new Set(input.creditBatchIds);
  if (input.creditBatchIds.length !== 1 || creditBatchIds.size !== 1) {
    return {
      status: "unsupported",
      ready: false,
      reason: "multi_batch_allocation_contract_missing",
      message:
        "This application spans multiple credit batches, and the registry allocation contract is not confirmed.",
      request: null,
    };
  }
  return {
    status: "unsupported",
    ready: false,
    reason: "arrival_departure_mass_contract_missing",
    message:
      "This application records net mass only. Isometric requires separate observed truck masses on arrival and departure, and no approved alternative encoding is available.",
    request: null,
  };
}
