/**
 * OrgBrand — the sidebar brand header, doubling as the Organization switcher.
 *
 * One row, two behaviors: users with at most one accessible organization get
 * the plain brand link to the dashboard (no tenancy chrome at all), while users
 * with multiple accessible organizations get the same row as a listbox trigger
 * — the org name is shown exactly once, and a caret is the only extra
 * affordance.
 * Switching resets facility selection and clears the query cache, because
 * every data view changes.
 */
"use client";

import { useEffect, useId, useRef, useState } from "react";
import Link from "next/link";
import { CaretDownIcon, CheckIcon } from "@phosphor-icons/react";
import { authClient } from "@/lib/auth/client";
import { useIsAdmin } from "@/hooks/use-is-admin";
import {
  useActiveOrganizationProfile,
  useAllOrganizations,
  useEnterOrganization,
} from "@/hooks/use-organizations";
import { shouldShowOrganizationSwitcher } from "./org-brand-switching";

type SwitchableOrg = { id: string; name: string };

function BrandMark({ initial }: { initial: string }) {
  return (
    <div className="size-28 bg-[var(--clr-purple)] flex items-center justify-center shrink-0">
      <span
        className="text-white font-bold text-[length:var(--text-xxs)] leading-none"
        suppressHydrationWarning
      >
        {initial}
      </span>
    </div>
  );
}

function OrgBrandLoading() {
  return (
    <div
      className="flex h-56 items-center gap-10 border-b border-[var(--color-white-10)] px-16 shrink-0"
      role="status"
      aria-label="Loading organization"
      aria-busy="true"
    >
      <div className="size-28 shrink-0 animate-pulse bg-[var(--color-white-10)]" />
      <div className="h-12 w-128 animate-pulse bg-[var(--color-white-10)]" />
    </div>
  );
}

export function OrgBrand({ onNavigate }: { onNavigate?: () => void }) {
  const isAdmin = useIsAdmin();
  const enterOrganization = useEnterOrganization();
  const listboxId = useId();
  const containerRef = useRef<HTMLDivElement>(null);
  const [isOpen, setIsOpen] = useState(false);
  const [isSwitching, setIsSwitching] = useState(false);

  // Override-aware active-org lookup: the plugin's useActiveOrganization() is
  // members-only, so it never resolves for Platform Admins inside an org they
  // don't belong to.
  const activeOrgQuery = useActiveOrganizationProfile();
  const { data: activeOrg } = activeOrgQuery;
  const sessionQuery = authClient.useSession();
  const { data: sessionData } = sessionQuery;
  const activeOrganizationId =
    (sessionData?.session as { activeOrganizationId?: string | null } | undefined)
      ?.activeOrganizationId ?? null;
  const memberOrgsQuery = authClient.useListOrganizations();
  const { data: memberOrgs } = memberOrgsQuery;
  // Platform Admins have no memberships, so their switch list is every org.
  const allOrgsQuery = useAllOrganizations(isAdmin);
  const { data: allOrgs } = allOrgsQuery;

  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (!containerRef.current?.contains(event.target as Node)) {
        setIsOpen(false);
      }
    };
    const handleEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") setIsOpen(false);
    };
    document.addEventListener("mousedown", handleClickOutside);
    document.addEventListener("keydown", handleEscape);
    return () => {
      document.removeEventListener("mousedown", handleClickOutside);
      document.removeEventListener("keydown", handleEscape);
    };
  }, []);

  const switchable: SwitchableOrg[] = isAdmin
    ? (allOrgs ?? []).map((org) => ({ id: org.id, name: org.name }))
    : (memberOrgs ?? []).map((org) => ({ id: org.id, name: org.name }));

  const canSwitch = shouldShowOrganizationSwitcher(switchable);

  const activeOrgName =
    activeOrg?.name?.trim() ||
    switchable.find((org) => org.id === activeOrganizationId)?.name ||
    "noma dMRV";
  const orgInitial = activeOrgName.charAt(0).toUpperCase();

  const organizationStatePending =
    (sessionQuery.isPending && !sessionQuery.error) ||
    (activeOrgQuery.isPending && !activeOrgQuery.error) ||
    (isAdmin
      ? allOrgsQuery.isPending && !allOrgsQuery.error
      : memberOrgsQuery.isPending && !memberOrgsQuery.error);

  async function handleSelect(organizationId: string) {
    if (organizationId === activeOrganizationId) {
      setIsOpen(false);
      return;
    }
    setIsSwitching(true);
    try {
      const result = await enterOrganization(organizationId);
      if (!result.success) {
        setIsSwitching(false);
        return;
      }
      setIsOpen(false);
    } finally {
      setIsSwitching(false);
    }
  }

  // Do not briefly claim the fallback brand or a single-org link while the
  // applicable organization list is still deciding the settled interaction.
  if (organizationStatePending) {
    return <OrgBrandLoading />;
  }

  // Single-org members: the brand header is just the brand — a link home.
  if (!canSwitch) {
    return (
      <div className="flex items-center h-56 px-16 border-b border-[var(--color-white-10)] shrink-0">
        <Link
          href="/dashboard"
          onClick={onNavigate}
          className="flex items-center gap-10 min-w-0"
        >
          <BrandMark initial={orgInitial} />
          <span
            className="body-small font-medium text-white truncate"
            suppressHydrationWarning
          >
            {activeOrgName}
          </span>
        </Link>
      </div>
    );
  }

  return (
    <div
      className="relative h-56 border-b border-[var(--color-white-10)] shrink-0"
      ref={containerRef}
    >
      <button
        type="button"
        onClick={() => setIsOpen((prev) => !prev)}
        aria-haspopup="listbox"
        aria-expanded={isOpen}
        aria-controls={listboxId}
        disabled={isSwitching}
        className="group flex items-center gap-10 w-full h-full px-16 text-left cursor-pointer hover:bg-[var(--color-white-100)]/[0.04] focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-inset focus-visible:ring-[var(--clr-purple)] transition-colors duration-150 disabled:opacity-60"
      >
        <BrandMark initial={orgInitial} />
        <span
          className="body-small font-medium text-white truncate flex-1"
          suppressHydrationWarning
        >
          {isSwitching ? "Switching…" : activeOrgName}
        </span>
        <CaretDownIcon
          size={12}
          weight="bold"
          className={`shrink-0 text-[var(--color-white-50)] group-hover:text-white transition-transform duration-150 ${
            isOpen ? "rotate-180" : ""
          }`}
        />
      </button>

      {isOpen && (
        <div className="absolute z-50 top-full left-0 right-0 border border-[var(--color-white-10)] bg-[var(--clr-dark-purple)] shadow-[0_8px_24px_rgba(0,0,0,0.35)]">
          <ul
            role="listbox"
            id={listboxId}
            aria-label="Select organization"
            className="max-h-[240px] overflow-y-auto py-4"
          >
            {switchable.length === 0 && (
              <li className="px-16 py-8 text-[var(--color-white-50)] body-caption">
                No organizations yet
              </li>
            )}
            {switchable.map((org) => {
              const isSelected = org.id === activeOrganizationId;
              return (
                <li key={org.id}>
                  <button
                    type="button"
                    role="option"
                    aria-selected={isSelected}
                    onClick={() => handleSelect(org.id)}
                    className={`w-full h-40 px-16 flex items-center justify-between gap-8 body-caption text-left transition-colors duration-150 ${
                      isSelected
                        ? "text-white bg-[var(--color-white-100)]/[0.08]"
                        : "text-[var(--color-white-75)] hover:text-white hover:bg-[var(--color-white-100)]/[0.06]"
                    }`}
                  >
                    <span className="truncate">{org.name}</span>
                    {isSelected && (
                      <CheckIcon size={14} weight="bold" className="shrink-0" />
                    )}
                  </button>
                </li>
              );
            })}
          </ul>
        </div>
      )}
    </div>
  );
}
