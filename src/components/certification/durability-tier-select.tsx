"use client";

import { LockIcon, SealCheckIcon } from "@phosphor-icons/react";
import { cn } from "@/lib/utils";
import { type DurabilityOption } from "@/schemas/credit-batches";

// Durability tier is declared once per facility and inherited downward
// (ADR 0021). 1000-year is the go-forward tier; 200-year is surfaced but
// disabled ("available later") until a 200-year client onboards — the entire
// 200-year code path stays intact, so re-enabling it is just flipping
// `available` here. Non-authoritative copy — verify tier method descriptions
// against the Biochar Storage in Soil Environments module before relying on
// them for a credit claim.

interface TierMeta {
  value: DurabilityOption;
  title: string;
  method: string;
  /** Selectable today, or surfaced-but-disabled ("available later"). */
  available: boolean;
}

const TIERS: readonly TierMeta[] = [
  {
    value: "1000_year",
    title: "1000-year",
    method: "Random reflectance (R₀) + TGA non-reactive carbon (Sanei 2024)",
    available: true,
  },
  {
    value: "200_year",
    title: "200-year",
    method: "H:Corg ratio + soil temperature (Woolf 2021)",
    available: false,
  },
];

interface DurabilityTierSelectProps {
  value: DurabilityOption;
  /** Provide to make the tiers selectable. Omit (or pass `readOnly`) for display-only. */
  onChange?: (value: DurabilityOption) => void;
  /** Form-submitting: interaction disabled without the display-only framing. */
  disabled?: boolean;
  /** Display-only — every tier is inert; the active one is highlighted. */
  readOnly?: boolean;
  "aria-label"?: string;
}

export function DurabilityTierSelect({
  value,
  onChange,
  disabled = false,
  readOnly = false,
  "aria-label": ariaLabel = "Durability tier",
}: DurabilityTierSelectProps) {
  const interactive = !readOnly && !!onChange;

  return (
    <div
      className="grid grid-cols-1 md:grid-cols-2 gap-12"
      role={interactive ? "radiogroup" : undefined}
      aria-label={interactive ? ariaLabel : undefined}
    >
      {TIERS.map((tier) => {
        const isActive = tier.value === value;
        // In display-only mode the facility's tier is always shown as active,
        // even if it is the not-yet-generally-available 200-year tier.
        const selectable = interactive && tier.available && !disabled;
        const Icon = tier.available ? SealCheckIcon : LockIcon;

        const card = (
          <div className="flex w-full items-start gap-12">
            <Icon
              aria-hidden
              weight="bold"
              className={cn(
                "mt-2 size-20 shrink-0",
                isActive
                  ? "text-[var(--color-text-primary)]"
                  : "text-[var(--color-text-tertiary)]",
              )}
            />
            <span className="flex flex-col gap-4">
              <span className="flex items-center gap-8">
                <span className="label-button text-[var(--color-text-primary)]">
                  {tier.title}
                </span>
                {!tier.available && (
                  <span className="body-small rounded-[2px] bg-[var(--color-surface-medium)] px-6 py-1 text-[var(--color-text-tertiary)]">
                    Available later
                  </span>
                )}
              </span>
              <span className="body-small text-[var(--color-text-secondary)]">
                {tier.method}
              </span>
            </span>
          </div>
        );

        const baseCardClass = cn(
          "min-h-[104px] border p-12 text-left transition-colors",
          isActive
            ? "border-[var(--color-text-primary)] bg-[var(--color-surface-medium)]"
            : "border-[var(--color-border-secondary)] bg-[var(--color-background-white)]",
          !tier.available && !isActive && "opacity-60",
        );

        if (!selectable) {
          return (
            <div
              key={tier.value}
              className={baseCardClass}
              // Keep radio semantics inside the radiogroup even when disabled
              // (e.g. form-submitting) so the group never loses all its
              // `role="radio"` descendants. A div carries no tabindex, so it
              // stays out of the tab order — the WAI-ARIA disabled-radio contract.
              role={interactive ? "radio" : undefined}
              aria-checked={interactive ? isActive : undefined}
              aria-disabled={interactive ? true : undefined}
              title={
                interactive && !tier.available
                  ? "Available when onboarding a client on the 200-year (H:Corg + soil-temperature) pathway"
                  : undefined
              }
            >
              {card}
            </div>
          );
        }

        return (
          <button
            key={tier.value}
            type="button"
            role="radio"
            aria-checked={isActive}
            onClick={() => onChange?.(tier.value)}
            className={cn(
              baseCardClass,
              "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-border-primary)]",
              !isActive &&
                "hover:border-[var(--color-border-primary)]",
            )}
          >
            {card}
          </button>
        );
      })}
    </div>
  );
}
