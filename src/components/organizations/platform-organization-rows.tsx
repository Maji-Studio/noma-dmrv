"use client";

import { MagnifyingGlassIcon, PlusIcon, WarningCircleIcon } from "@phosphor-icons/react/dist/ssr";
import type { usePlatformOrganizations } from "@/hooks/use-organizations";
import { cn } from "@/lib/utils";

/** One row of the Platform Admin directory (`usePlatformOrganizations`). */
export type PlatformOrganization = NonNullable<ReturnType<typeof usePlatformOrganizations>["data"]>[number];

export function membersLabel(count: number): string {
  if (count === 0) return "No members";
  return `${count} member${count === 1 ? "" : "s"}`;
}

export function adminsLabel(count: number): string {
  return `${count} Admin${count === 1 ? "" : "s"}`;
}

/** What still keeps an organization from working, in operator words. */
export function setupGaps(organization: PlatformOrganization): string[] {
  const gaps: string[] = [];
  if (!organization.isometricKeysSaved) gaps.push("no Isometric keys");
  if (organization.memberCount === 0) gaps.push("no members");
  return gaps;
}

interface PlatformOrganizationListProps {
  organizations: PlatformOrganization[];
  selectedId: string | null;
  creating: boolean;
  currentId: string | null;
  query: string;
  onQueryChange: (query: string) => void;
  onSelect: (organizationId: string) => void;
  onCreate: () => void;
  className?: string;
}

/**
 * The left column of the Platform page: search, "New organization", and one
 * row per organization. A warning mark names what an organization still lacks.
 */
export function PlatformOrganizationList({
  organizations,
  selectedId,
  creating,
  currentId,
  query,
  onQueryChange,
  onSelect,
  onCreate,
  className,
}: PlatformOrganizationListProps) {
  const needle = query.trim().toLowerCase();
  const shown = needle ? organizations.filter((org) => org.name.toLowerCase().includes(needle)) : organizations;

  return (
    <nav aria-label="Organizations" className={cn("flex flex-col border-[1.5px] border-[var(--clr-dark-purple-40)] bg-[var(--paper)]", className)}>
      <div className="flex items-center gap-8 border-b border-[var(--color-border-secondary)] px-12">
        <MagnifyingGlassIcon size={18} className="shrink-0 text-[var(--color-icon-secondary)]" aria-hidden />
        <input
          type="search"
          aria-label="Search organizations"
          placeholder="Search"
          value={query}
          onChange={(event) => onQueryChange(event.target.value)}
          className="body-medium h-44 w-full bg-transparent outline-none"
        />
      </div>
      <button
        type="button"
        onClick={onCreate}
        aria-current={creating ? "page" : undefined}
        className={cn(
          "body-small flex min-h-44 items-center gap-8 border-b border-[var(--color-border-secondary)] px-12 font-medium",
          creating ? "bg-[var(--clr-dark-purple-5)]" : "hover:bg-[var(--clr-dark-purple-1)]",
        )}
      >
        <PlusIcon size={16} weight="bold" aria-hidden /> New organization
      </button>
      {shown.length === 0 ? (
        <p className="body-small px-12 py-16 text-[var(--color-text-secondary)]">No organization matches.</p>
      ) : (
        <ul className="flex flex-col">
          {shown.map((org) => {
            const gaps = setupGaps(org);
            const selected = org.id === selectedId;
            return (
              <li key={org.id} className="border-b border-[var(--color-border-secondary)] last:border-b-0">
                <button
                  type="button"
                  onClick={() => onSelect(org.id)}
                  aria-current={selected ? "page" : undefined}
                  className={cn(
                    "flex min-h-[56px] w-full items-center gap-10 px-12 py-8 text-left",
                    selected
                      ? "bg-[var(--clr-dark-purple-5)] shadow-[inset_3px_0_0_var(--clr-dark-purple)]"
                      : "hover:bg-[var(--clr-dark-purple-1)]",
                  )}
                >
                  <span className="flex min-w-0 flex-1 flex-col">
                    <span className="body-medium break-words font-medium">{org.name}</span>
                    <span className="body-small text-[var(--color-text-secondary)]">
                      {org.id === currentId ? "Current · " : ""}
                      {membersLabel(org.memberCount)}
                    </span>
                  </span>
                  {gaps.length > 0 && (
                    <WarningCircleIcon
                      size={18}
                      className="shrink-0 text-[var(--st-wait)]"
                      role="img"
                      aria-label={`Needs setup: ${gaps.join(", ")}`}
                    />
                  )}
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </nav>
  );
}
