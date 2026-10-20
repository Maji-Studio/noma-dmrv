import { OAUTH_STEP_UP_NAMESPACE } from "@/config/oauth";

export type StepUpBinding = { userId: string; clientId: string; organizationId: string };

/** The full tuple is both identifier and primary key, so replacement is atomic and rows never collide. */
export function stepUpKey(binding: StepUpBinding) {
  const identifier = OAUTH_STEP_UP_NAMESPACE + JSON.stringify([binding.userId, binding.clientId, binding.organizationId]);
  return { identifier, id: identifier };
}
