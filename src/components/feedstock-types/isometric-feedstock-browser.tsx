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

import { useState } from "react";
import Link from "next/link";
import { useFacilityContext } from "@/hooks/use-facility-context";
import {
  useFacilityCertifierSummary,
  useIsometricFeedstockTypes,
} from "@/hooks/use-certification";
import { FormInput } from "@/components/forms";
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
  const [search, setSearch] = useState("");
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

  const normalizedSearch = search.trim().toLowerCase();
  const filteredTypes = normalizedSearch
    ? catalogue.data.filter((type) => {
        const reference = type.supplier_reference_id ?? "";
        return [type.name, type.id, reference].some((value) =>
          value.toLowerCase().includes(normalizedSearch)
        );
      })
    : catalogue.data;

  return (
    <div className="flex flex-col gap-12">
      <p className="body-caption text-[var(--color-text-tertiary)]">
        Choose the certified Isometric feedstock first. Noma will prefill the
        local record, then you finish the category and save.
      </p>
      <FormInput
        id="isometric-feedstock-search"
        type="search"
        value={search}
        onChange={(event) => setSearch(event.target.value)}
        placeholder="Search certified feedstocks..."
        aria-label="Search certified feedstocks"
      />
      <ul className="max-h-[320px] overflow-y-auto border border-[var(--color-border-secondary)] divide-y divide-[var(--color-border-tertiary)]">
        {filteredTypes.map((type) => (
          <li key={type.id}>
            <button
              type="button"
              onClick={() => onSelect?.(type)}
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
      {filteredTypes.length === 0 && (
        <Message>
          No matching certified feedstock. Add it in Isometric Certify before
          using it for verified production.
        </Message>
      )}
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
