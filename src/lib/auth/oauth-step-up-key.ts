import { createHash } from "node:crypto";
import { OAUTH_STEP_UP_NAMESPACE } from "@/config/oauth";

export type StepUpBinding = { userId: string; clientId: string; organizationId: string };

/** The full tuple is the identifier; a deterministic primary key makes replacement atomic. */
export function stepUpKey(binding: StepUpBinding) {
  const identifier = OAUTH_STEP_UP_NAMESPACE + JSON.stringify([binding.userId, binding.clientId, binding.organizationId]);
  return { identifier, id: OAUTH_STEP_UP_NAMESPACE + createHash("sha256").update(identifier).digest("hex") };
}
