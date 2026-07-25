import type { CertifierProjectRow } from "@/data-access/certification";
import type { OrgContext } from "@/lib/auth/server";
import type { Logger } from "@/lib/log";
import versions from "../../../docs/isometric/versions.json";
import {
  appendSyncEventBestEffort,
  ISOMETRIC_PROVIDER,
  REMOVAL_ENTITY_TYPE,
} from "./shared";

const PROTOCOL_VERSION_CHECK_OPERATION = "removal:protocol-version-check";

export const PINNED_BIOCHAR_PROTOCOL_VERSION =
  versions.protocol.minor_version;

export type ProtocolVersionCheckOutcome = "match" | "mismatch" | "missing";

interface CheckProtocolVersionAtSubmitArgs {
  orgCtx: OrgContext;
  removalId: string;
  mapping: CertifierProjectRow;
  log: Logger;
}

/**
 * Compares the operator-recorded Certify project protocol version with noma's
 * interpretation pin. Drift is advisory because Certify exposes no protocol
 * version through its API; the operator must reconcile the project in the UI.
 */
export async function checkProtocolVersionAtSubmit({
  orgCtx,
  removalId,
  mapping,
  log,
}: CheckProtocolVersionAtSubmitArgs): Promise<ProtocolVersionCheckOutcome> {
  const configuredProtocolVersion = mapping.protocolVersion?.trim() || null;
  if (configuredProtocolVersion === PINNED_BIOCHAR_PROTOCOL_VERSION) {
    return "match";
  }

  const outcome: ProtocolVersionCheckOutcome = configuredProtocolVersion
    ? "mismatch"
    : "missing";
  const details = {
    outcome,
    facilityId: mapping.facilityId,
    certifierProjectId: mapping.id,
    externalProjectId: mapping.externalProjectId,
    configuredProtocolVersion,
    pinnedProtocolVersion: PINNED_BIOCHAR_PROTOCOL_VERSION,
  };

  log.warn(
    details,
    outcome === "mismatch"
      ? "certifier project protocol version differs from the interpretation pin"
      : "certifier project protocol version is missing",
  );

  await appendSyncEventBestEffort(
    orgCtx,
    {
      provider: ISOMETRIC_PROVIDER,
      entityType: REMOVAL_ENTITY_TYPE,
      entityId: removalId,
      operation: PROTOCOL_VERSION_CHECK_OPERATION,
      status: "succeeded",
      responsePayload: details,
    },
    {
      certifierProjectId: mapping.id,
      removalId,
    },
  );

  return outcome;
}
