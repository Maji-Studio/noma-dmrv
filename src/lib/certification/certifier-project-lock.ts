export interface CertifierProjectLockIdentity {
  organizationId: string;
  facilityId: string;
  provider: string;
}

/** Shared lock namespace for project remapping and registry writes. */
export function certifierProjectLockKey(
  identity: CertifierProjectLockIdentity,
): string {
  return [
    "certifier-project-mapping",
    identity.organizationId,
    identity.provider,
    identity.facilityId,
  ].join(":");
}
