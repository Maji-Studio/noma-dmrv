"use client";

/**
 * Throwaway: the "Choose where to work" screen of settings prototype variant C.
 * In the product it replaces the silent organization pick at sign-in when a
 * person can reach two or more organizations, and opens again from the
 * organization name in the sidebar.
 */
import { BuildingsIcon, CaretRightIcon, GearSixIcon } from "@phosphor-icons/react/dist/ssr";
import type { Icon } from "@phosphor-icons/react";
import { cn } from "@/lib/utils";
import { NomaLogo } from "@/components/ui";
import type { VariantCOrg, VariantCViewer } from "./variant-c-fixtures";

export type VariantCWorkspace = { kind: "org"; orgId: string } | { kind: "platform" };

interface VariantCChooserProps {
  viewer: VariantCViewer;
  orgs: readonly VariantCOrg[];
  current: VariantCWorkspace | null;
  onChoose: (workspace: VariantCWorkspace) => void;
}

export function VariantCChooser({ viewer, orgs, current, onChoose }: VariantCChooserProps) {
  const reachable = orgs.filter((org) => viewer === "platform" || org.roleFor[viewer] !== null);

  return (
    <div className="flex justify-center px-16 py-48 md:py-80">
      <div className="flex w-full max-w-[560px] flex-col gap-24">
        <div className="flex flex-col gap-16">
          <NomaLogo className="h-24 w-auto" />
          <h1 className="title-heading-2">Choose where to work</h1>
        </div>

        {viewer === "platform" && (
          <ChooserCard
            icon={GearSixIcon}
            title="Platform"
            detail="Organizations, diagnostics, template mapping"
            role="Platform Admin"
            selected={current?.kind === "platform"}
            onClick={() => onChoose({ kind: "platform" })}
          />
        )}

        <section aria-labelledby="variant-c-chooser-orgs" className="flex flex-col gap-8">
          <h2 id="variant-c-chooser-orgs" className="body-small font-medium text-[var(--color-text-secondary)]">
            Organizations
          </h2>
          <ul className="flex flex-col gap-8">
            {reachable.map((org) => {
              const role = org.roleFor[viewer] ?? "Platform Admin";
              const lastOpened = org.lastOpened[viewer];
              const facilities =
                org.facilities.length === 1 ? "1 facility" : `${org.facilities.length} facilities`;
              return (
                <li key={org.id}>
                  <ChooserCard
                    icon={BuildingsIcon}
                    title={org.name}
                    detail={lastOpened ? `${facilities}. Last opened ${lastOpened}` : `${facilities}. Never opened`}
                    role={role}
                    selected={current?.kind === "org" && current.orgId === org.id}
                    onClick={() => onChoose({ kind: "org", orgId: org.id })}
                  />
                </li>
              );
            })}
          </ul>
        </section>
      </div>
    </div>
  );
}

function ChooserCard({
  icon: CardIcon,
  title,
  detail,
  role,
  selected,
  onClick,
}: {
  icon: Icon;
  title: string;
  detail: string;
  role: string;
  selected: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-current={selected ? "true" : undefined}
      className={cn(
        "flex w-full min-h-72 items-center gap-16 bg-[var(--paper)] px-16 py-12 text-left transition-colors",
        "hover:bg-[var(--sea)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-interaction)]",
        selected
          ? "border-[1.5px] border-[var(--clr-dark-purple)]"
          : "border-[1.5px] border-[var(--clr-dark-purple-20)]",
      )}
    >
      <CardIcon size={24} weight="bold" aria-hidden className="shrink-0 text-[var(--color-text-secondary)]" />
      <span className="flex min-w-0 flex-1 flex-col gap-2">
        <span className="body-medium font-medium">{title}</span>
        <span className="body-caption text-[var(--color-text-tertiary)]">{detail}</span>
      </span>
      <span
        className={cn(
          "body-caption shrink-0 rounded-full px-8 py-2",
          role === "Platform Admin"
            ? "bg-[var(--st-run-bg)] text-[var(--st-run)]"
            : "bg-[var(--clr-dark-purple-5)] text-[var(--color-text-secondary)]",
        )}
      >
        {role}
      </span>
      <CaretRightIcon size={16} weight="bold" aria-hidden className="shrink-0 text-[var(--color-text-tertiary)]" />
    </button>
  );
}
