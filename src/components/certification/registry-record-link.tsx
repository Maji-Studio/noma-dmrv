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
import { isometricRegistry } from "@/lib/isometric/links";

interface RegistryRecordLinkProps {
  facilityId: string;
  externalId: string;
  version: number | null;
  isProduction: boolean;
  kind: "removal" | "ghgStatement";
}

export function RegistryRecordLink({
  facilityId,
  externalId,
  version,
  isProduction,
  kind,
}: RegistryRecordLinkProps) {
  const { data } = useFacilityCertifierSummary(facilityId);
  const externalProjectId = data?.mapping?.externalProjectId ?? null;
  const environment = isProduction ? "production" : "sandbox";

  const url = externalProjectId
    ? kind === "removal"
      ? isometricRegistry.removal({
          environment,
          externalProjectId,
          externalRemovalId: externalId,
        })
      : isometricRegistry.ghgStatement({
          environment,
          externalProjectId,
          externalStatementId: externalId,
        })
    : null;

  return (
    <div className="flex flex-wrap items-center gap-x-12 gap-y-4">
      <span className="font-mono text-[var(--color-text-secondary)]">
        {externalId}
        {version != null && ` · v${version}`}
      </span>
      {url && (
        <a
          href={url}
          target="_blank"
          rel="noopener noreferrer"
          className="body-caption text-[var(--color-text-tertiary)] underline underline-offset-2 hover:text-[var(--color-text-secondary)]"
        >
          View on Isometric ↗
        </a>
      )}
    </div>
  );
}
