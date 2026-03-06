/**
 * SectionLabel — reusable form section header
 */

export function SectionLabel({ children }: { children: React.ReactNode }) {
  return (
    <h3 className="body-caption font-medium uppercase tracking-[0.08em] text-[var(--color-text-tertiary)]">
      {children}
    </h3>
  );
}
