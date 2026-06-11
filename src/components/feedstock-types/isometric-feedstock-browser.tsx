/**
 * IsometricFeedstockBrowser
 * Read-only browse of the Isometric registry's feedstock-type catalogue for
 * the feedstock-type form's Isometric tab. Browse-only by design (locked
 * decision: no local record is created from registry entries, no import).
 * Gated on the selected facility having a registry link — the catalogue is
 * account-global on Isometric, but browsing it is only meaningful for
 * facilities that participate in certification.
 */
"use client";

import Link from "next/link";
import { useFacilityContext } from "@/hooks/use-facility-context";
import {
  useFacilityCertifierSummary,
  useIsometricFeedstockTypes,
} from "@/hooks/use-certification";

const settingsHref = (facilityId: string) =>
  `/certification/settings?facility=${encodeURIComponent(facilityId)}`;

export function IsometricFeedstockBrowser() {
  const { facilityId } = useFacilityContext();
  const summary = useFacilityCertifierSummary(facilityId ?? "", !!facilityId);
  const isConnected = !!summary.data?.mapping;
  const catalogue = useIsometricFeedstockTypes(isConnected);

  if (!facilityId) {
    return (
      <Message>Select a facility to browse registry feedstock types.</Message>
    );
  }

  if (summary.isLoading) {
    return <Message>Checking registry link…</Message>;
  }

  if (summary.error || !summary.data) {
    return <ErrorMessage>Unable to check the registry link.</ErrorMessage>;
  }

  if (!isConnected) {
    return (
      <Message>
        This facility isn&apos;t linked to an Isometric project, so the
        registry catalogue isn&apos;t available. Link it in{" "}
        <Link
          href={settingsHref(facilityId)}
          className="underline underline-offset-2 hover:text-[var(--color-text-primary)]"
        >
          Certification → Settings
        </Link>
        .
      </Message>
    );
  }

  if (catalogue.isLoading) {
    return <Message>Loading registry feedstock types…</Message>;
  }

  if (catalogue.error || !catalogue.data) {
    return (
      <ErrorMessage>
        Failed to load registry feedstock types
        {catalogue.error instanceof Error ? `: ${catalogue.error.message}` : "."}
      </ErrorMessage>
    );
  }

  if (catalogue.data.length === 0) {
    return (
      <Message>No feedstock types found on the Isometric registry.</Message>
    );
  }

  return (
    <div className="flex flex-col gap-12">
      <p className="body-caption text-[var(--color-text-tertiary)]">
        Read-only view of the registry catalogue — local feedstock types stay
        separate and are managed in the General tab.
      </p>
      <ul className="max-h-[320px] overflow-y-auto border border-[var(--color-border-secondary)] divide-y divide-[var(--color-border-tertiary)]">
        {catalogue.data.map((type) => (
          <li key={type.id} className="flex flex-col gap-2 px-12 py-8">
            <span className="body-small text-[var(--color-text-primary)]">
              {type.name}
            </span>
            <span className="body-caption font-mono text-[var(--color-text-tertiary)]">
              {type.id}
              {type.supplier_reference_id
                ? ` · ref ${type.supplier_reference_id}`
                : ""}
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}

function Message({ children }: { children: React.ReactNode }) {
  return (
    <p className="body-small text-[var(--color-text-secondary)]">{children}</p>
  );
}

function ErrorMessage({ children }: { children: React.ReactNode }) {
  return (
    <p className="body-small text-[var(--color-signal-red)]" role="alert">
      {children}
    </p>
  );
}
