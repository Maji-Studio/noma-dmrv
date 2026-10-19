/**
 * The registry record of a Removal or GHG Statement, as every surface writes
 * and links it: the detail sheets' "Registry record" field and the list rows.
 */
import { isometricRegistry } from "@/lib/isometric/links";

export type RegistryRecordKind = "removal" | "ghgStatement";

/** "grm_01ABC · v3": the registry id, a dot and the version. */
export function formatRegistryRecord(
  externalId: string,
  version: number | null,
): string {
  return version == null ? externalId : `${externalId} · v${version}`;
}

/**
 * The record's page in the supplier's private Isometric Certify workspace, or
 * null when the facility has no mapped registry project to nest it under.
 */
export function registryRecordUrl(args: {
  kind: RegistryRecordKind;
  externalId: string;
  externalProjectId: string | null;
  isProduction: boolean;
}): string | null {
  const { kind, externalId, externalProjectId, isProduction } = args;
  if (!externalProjectId) return null;
  const environment = isProduction ? "production" : "sandbox";
  return kind === "removal"
    ? isometricRegistry.removal({
        environment,
        externalProjectId,
        externalRemovalId: externalId,
      })
    : isometricRegistry.ghgStatement({
        environment,
        externalProjectId,
        externalStatementId: externalId,
      });
}
