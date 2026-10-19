import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

interface OrganizationRosterListProps {
  children: ReactNode;
  /** Accessible name, when a pane holds more than one list. */
  label?: string;
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
  label,
}: OrganizationRosterListProps) {
  return (
    <ul aria-label={label} className="flex flex-col border border-[var(--color-border-secondary)] bg-[var(--color-background-white)]">
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
        {actions && <div className="flex max-w-full flex-wrap items-center gap-8">{actions}</div>}
      </div>
      {details}
    </li>
  );
}

export interface OrganizationRosterDetail {
  label: string;
  value: ReactNode;
}

/**
 * A row's metadata as label and value pairs, for a row's `details` slot. The
 * label is a quiet caption and the value carries the ink, so a row reads at a
 * glance rather than as a wall of equal text.
 */
export function OrganizationRosterDetails({ items }: { items: OrganizationRosterDetail[] }) {
  return (
    // A phone stacks each label over its value so a long value keeps the full width.
    <dl className="flex flex-col gap-8 px-16 pb-12 sm:grid sm:grid-cols-[max-content_minmax(0,1fr)] sm:items-baseline sm:gap-x-16 sm:gap-y-6">
      {items.map((item) => (
        <div key={item.label} className="flex flex-col gap-2 sm:contents">
          <dt className="body-caption text-[var(--color-text-secondary)]">{item.label}</dt>
          <dd className="body-small break-words">{item.value}</dd>
        </div>
      ))}
    </dl>
  );
}
