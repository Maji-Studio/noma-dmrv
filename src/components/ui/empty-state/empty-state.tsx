/**
 * EmptyState — shared dashed-border empty / zero-data card.
 *
 * Standardises the layout (centered icon → heading → description → optional
 * action) and the padding tiers used across list pages. Use `padding="lg"`
 * for top-level "no data yet" / "select a facility" states, `padding="md"`
 * for mid-tier empty sections, `padding="sm"` for nested empties (e.g.,
 * inside a card body or subsection).
 */
"use client";

import { type ReactNode } from "react";

const PADDING_CLASSES = {
  sm: "py-32",
  md: "py-40",
  lg: "py-56",
} as const;

export type EmptyStatePadding = keyof typeof PADDING_CLASSES;

export interface EmptyStateProps {
  /** Phosphor icon (or any element) — caller sizes it. Typical: 48px for lg, 40px for md, 32px for sm. */
  icon: ReactNode;
  /** Heading text — rendered as `title-heading-3`. */
  title: string;
  /** Optional secondary line — rendered as `body-small`. */
  description?: string;
  /** Optional CTA (typically a `<Button>`). */
  action?: ReactNode;
  /** Vertical padding tier. Defaults to `"lg"`. */
  padding?: EmptyStatePadding;
}

export function EmptyState({
  icon,
  title,
  description,
  action,
  padding = "lg",
}: EmptyStateProps) {
  return (
    <div
      className={`flex flex-col items-center justify-center gap-16 border border-dashed border-[var(--color-border-secondary)] bg-[var(--color-background-white)] ${PADDING_CLASSES[padding]}`}
    >
      <span className="text-[var(--color-text-tertiary)]">{icon}</span>
      <div className="flex flex-col gap-8 text-center max-w-[520px]">
        <h3 className="title-heading-3">{title}</h3>
        {description && (
          <p className="body-small text-[var(--color-text-secondary)]">
            {description}
          </p>
        )}
      </div>
      {action}
    </div>
  );
}
