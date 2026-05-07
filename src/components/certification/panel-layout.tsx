import type { ReactNode } from "react";

export function Section({ children }: { children: ReactNode }) {
  return (
    <section className="border-t border-[var(--color-border-secondary)] pt-24">
      {children}
    </section>
  );
}

export function Field({
  label,
  children,
}: {
  label: string;
  children: ReactNode;
}) {
  return (
    <dl className="flex flex-col gap-2">
      <dt className="body-caption text-[var(--color-text-tertiary)] uppercase tracking-wide">
        {label}
      </dt>
      <dd className="flex flex-col gap-2">{children}</dd>
    </dl>
  );
}
