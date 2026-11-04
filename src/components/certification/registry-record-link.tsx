/**
 * RegistryRecordLink — the inner content of a "Registry record" detail field:
 * the registry id + version, plus a deep-link that opens the record in the
 * supplier's private Isometric Certify workspace (new tab).
 *
 * Shared by the Removal and GHG Statement detail views, which render the same
 * field but build different Certify URLs (`ghg-entry` vs `ghg-statement`).
 *
 * The deep-link needs the facility's mapped `externalProjectId`, which neither
 * detail summary carries — so we read it from the lightweight (DB-only)
 * certifier summary. If the facility is somehow unmapped, the link is omitted
 * and only the identifier is shown.
 */
"use client";

import { useFacilityCertifierSummary } from "@/hooks/use-certification";
import { IsometricLink } from "./isometric-link";
import {
  formatRegistryRecord,
  registryRecordUrl,
  type RegistryRecordKind,
} from "./registry-record";

interface RegistryRecordLinkProps {
  facilityId: string;
  externalId: string;
  version: number | null;
  isProduction: boolean;
  kind: RegistryRecordKind;
}

export function RegistryRecordLink({
  facilityId,
  externalId,
  version,
  isProduction,
  kind,
}: RegistryRecordLinkProps) {
  const { data } = useFacilityCertifierSummary(facilityId);
  const url = registryRecordUrl({
    kind,
    externalId,
    externalProjectId: data?.mapping?.externalProjectId ?? null,
    isProduction,
  });

  return (
    <div className="flex flex-wrap items-center gap-x-12 gap-y-4">
      <span className="font-mono text-[var(--color-text-secondary)]">
        {formatRegistryRecord(externalId, version)}
      </span>
      {url && <IsometricLink href={url} />}
    </div>
  );
}
