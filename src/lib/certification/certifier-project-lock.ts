export interface CertifierProjectLockIdentity {
  organizationId: string;
  facilityId: string;
  provider: string;
}

export interface CertifierExternalProjectLockIdentity {
  organizationId: string;
  externalProjectId: string;
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

/** Serializes registry identity creation with every mapping sharing a project. */
export function certifierExternalProjectLockKey(
  identity: CertifierExternalProjectLockIdentity,
): string {
  return [
    "certifier-external-project",
    identity.organizationId,
    identity.provider,
    identity.externalProjectId,
  ].join(":");
}
