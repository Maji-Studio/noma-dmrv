/**
 * OrgSwitcher — sidebar control to change the session's active Organization.
 *
 * Rendered only for users who can actually switch: multi-org members and
 * Platform Admins (who can enter any org). Single-org members never see it, so
 * the default UX carries no tenancy chrome. Switching resets facility selection
 * and clears the query cache, because every data view changes.
 */
"use client";

import { useEffect, useId, useRef, useState } from "react";
import {
  BuildingsIcon,
  CaretDownIcon,
  CheckIcon,
} from "@phosphor-icons/react";
import { authClient } from "@/lib/auth/client";
import { useIsAdmin } from "@/hooks/use-is-admin";
import {
  useAllOrganizations,
  useEnterOrganization,
} from "@/hooks/use-organizations";

type SwitchableOrg = { id: string; name: string };

export function OrgSwitcher() {
  const isAdmin = useIsAdmin();
  const enterOrganization = useEnterOrganization();
  const listboxId = useId();
  const containerRef = useRef<HTMLDivElement>(null);
  const [isOpen, setIsOpen] = useState(false);
  const [isSwitching, setIsSwitching] = useState(false);

  // The plugin's useActiveOrganization() resolves the full org through a
  // members-only endpoint, so it stays empty for Platform Admins entering an
  // org they don't belong to. The session's activeOrganizationId works for
  // both members and Platform Admins; the name resolves from the switch list.
  const { data: sessionData } = authClient.useSession();
  const activeOrganizationId =
    (sessionData?.session as { activeOrganizationId?: string | null } | undefined)
      ?.activeOrganizationId ?? null;
  const { data: memberOrgs } = authClient.useListOrganizations();
  // Platform Admins have no memberships, so their switch list is every org.
  const { data: allOrgs } = useAllOrganizations(isAdmin);

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

  // Nothing to switch between and not a Platform Admin: render no chrome.
  if (!isAdmin && switchable.length <= 1) {
    return null;
  }

  const activeOrgName =
    switchable.find((org) => org.id === activeOrganizationId)?.name ??
    "Select organization";

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

  return (
    <div className="mx-8 px-10 pt-10" ref={containerRef}>
      <div className="relative">
        <BuildingsIcon
          size={16}
          weight="fill"
          className="absolute left-10 top-1/2 -translate-y-1/2 text-white pointer-events-none z-10"
        />
        <button
          type="button"
          onClick={() => setIsOpen((prev) => !prev)}
          aria-haspopup="listbox"
          aria-expanded={isOpen}
          aria-controls={listboxId}
          disabled={isSwitching}
          className="w-full h-44 md:h-36 pl-32 pr-28 bg-[var(--color-white-100)]/[0.06] border border-[var(--color-white-10)] text-white body-caption cursor-pointer text-left hover:bg-[var(--color-white-100)]/[0.10] focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-[var(--clr-purple)] transition-colors duration-150 disabled:opacity-60"
        >
          <span className="block truncate">
            {isSwitching ? "Switching…" : activeOrgName}
          </span>
        </button>
        <CaretDownIcon
          size={14}
          weight="bold"
          className={`absolute right-10 top-1/2 -translate-y-1/2 text-[var(--color-white-50)] pointer-events-none transition-transform duration-150 ${
            isOpen ? "rotate-180" : ""
          }`}
        />

        {isOpen && (
          <div className="absolute z-50 mt-6 w-full border border-[var(--color-white-10)] bg-[var(--clr-dark-purple)] shadow-[0_8px_24px_rgba(0,0,0,0.35)]">
            <ul
              role="listbox"
              id={listboxId}
              aria-label="Select organization"
              className="max-h-[240px] overflow-y-auto py-4"
            >
              {switchable.length === 0 && (
                <li className="px-10 py-8 text-[var(--color-white-50)] body-caption">
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
                      className={`w-full h-40 px-10 flex items-center justify-between gap-8 body-caption text-left transition-colors duration-150 ${
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
    </div>
  );
}
