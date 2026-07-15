import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

interface OrganizationRosterListProps {
  children: ReactNode;
}

interface OrganizationRosterRowProps {
  primary: ReactNode;
  secondary?: ReactNode;
  actions?: ReactNode;
  details?: ReactNode;
  secondaryClassName?: string;
}

export function OrganizationRosterList({
  children,
}: OrganizationRosterListProps) {
  return (
    <ul className="flex flex-col border border-[var(--color-border-secondary)] bg-[var(--color-background-white)]">
      {children}
    </ul>
  );
}

export function OrganizationRosterRow({
  primary,
  secondary,
  actions,
  details,
  secondaryClassName,
}: OrganizationRosterRowProps) {
  return (
    <li className="flex flex-col border-b border-[var(--color-border-tertiary)] last:border-b-0">
      <div className="flex flex-wrap items-center justify-between gap-12 px-16 py-12">
        <div className="flex min-w-0 flex-col">
          <span className="body-small font-medium text-[var(--color-text-primary)] truncate">
            {primary}
          </span>
          {secondary && (
            <span
              className={cn(
                "body-caption text-[var(--color-text-secondary)] truncate",
                secondaryClassName,
              )}
            >
              {secondary}
            </span>
          )}
        </div>
        {actions && <div className="flex items-center gap-8">{actions}</div>}
      </div>
      {details}
    </li>
  );
}
