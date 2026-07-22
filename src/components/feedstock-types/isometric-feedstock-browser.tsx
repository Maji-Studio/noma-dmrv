/**
 * IsometricFeedstockBrowser
 * Read-only browse of the Isometric registry's feedstock-type catalogue for
 * the feedstock-type form's Isometric tab. Selection fills the surrounding
 * local form; creation still happens only when that form is saved.
 * Gated on the selected facility having a registry link — the catalogue is
 * account-global on Isometric, but browsing it is only meaningful for
 * facilities that participate in certification.
 */
"use client";

import Link from "next/link";
import { SealCheckIcon } from "@phosphor-icons/react";
import { EmptyState } from "@/components/ui";
import { useFacilityContext } from "@/hooks/use-facility-context";
import {
  useFacilityCertifierSummary,
  useIsometricFeedstockTypes,
} from "@/hooks/use-certification";
import type { IsometricFeedstockType } from "@/lib/isometric";

const settingsHref = (facilityId: string) =>
  `/certification/settings?facility=${encodeURIComponent(facilityId)}`;

interface IsometricFeedstockBrowserProps {
  onSelect?: (type: IsometricFeedstockType) => void;
  selectedId?: string | null;
}

export function IsometricFeedstockBrowser({
  onSelect,
  selectedId,
}: IsometricFeedstockBrowserProps) {
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
      <EmptyState
        padding="md"
        icon={<SealCheckIcon size={40} />}
        title="No registry feedstock types"
        description="No feedstock types were returned by the Isometric catalogue."
      />
    );
  }

  return (
    <div className="flex flex-col gap-12">
      <p className="body-caption text-[var(--color-text-tertiary)]">
        Choose the certified Isometric feedstock first. Noma will prefill the
        local record, then you finish the category and save.
      </p>
      <ul
        className="max-h-[320px] overflow-y-auto border border-[var(--color-border-secondary)] divide-y divide-[var(--color-border-tertiary)]"
        data-testid="isometric-feedstock-list"
      >
        {catalogue.data.map((type) => (
          <li key={type.id}>
            <button
              type="button"
              onClick={() => onSelect?.(type)}
              data-testid={`isometric-feedstock-option-${type.id}`}
              className="flex w-full items-start justify-between gap-12 px-12 py-8 text-left transition-colors hover:bg-[var(--color-background-medium)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-[var(--color-border-primary)]"
              aria-pressed={selectedId === type.id}
            >
              <span className="flex flex-col gap-2">
                <span className="body-small text-[var(--color-text-primary)]">
                  {type.name}
                </span>
                <span className="body-caption font-mono text-[var(--color-text-tertiary)]">
                  {type.id}
                  {type.supplier_reference_id
                    ? ` · ref ${type.supplier_reference_id}`
                    : ""}
                </span>
              </span>
              <span className="label-button shrink-0 text-[var(--color-interaction)]">
                {selectedId === type.id ? "Selected" : "Use"}
              </span>
            </button>
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
