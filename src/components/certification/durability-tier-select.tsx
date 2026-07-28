"use client";

import { LockIcon, SealCheckIcon } from "@phosphor-icons/react/dist/ssr";
import { cn } from "@/lib/utils";
import { type DurabilityOption } from "@/schemas/credit-batches";

// Durability tier is declared once per facility and inherited downward
// (ADR 0021). 1000-year is the go-forward tier; the 200-year pathway stays
// fully wired but is not yet generally available — re-enabling it is just
// flipping `available` below, at which point the facility form turns back into
// a genuine two-option choice with no caller change. Until then a single-tier
// deployment (and every read-only surface) shows the tier as plain info, never
// a radio with one locked "Available later" option that reads as a choice the
// operator is failing to make (#348). Non-authoritative copy — verify tier
// method descriptions against the Biochar Storage in Soil Environments module
// before relying on them for a credit claim.

interface TierMeta {
  value: DurabilityOption;
  title: string;
  /** Plain-language, operator-facing summary of what the tier commits to. */
  plain: string;
  /** Measurement basis — the verification method + citation. */
  method: string;
  /** Selectable today, or surfaced-but-disabled ("available later"). */
  available: boolean;
}

const TIERS: readonly TierMeta[] = [
  {
    value: "1000_year",
    title: "1000-year",
    plain: "Long-term storage measured to a 1,000-year permanence standard.",
    method: "Random reflectance (R₀) + TGA non-reactive carbon (Sanei 2024)",
    available: true,
  },
  {
    value: "200_year",
    title: "200-year",
    plain: "Storage measured to a 200-year permanence standard.",
    method: "H:Corg ratio + soil temperature (Woolf 2021)",
    available: false,
  },
];

const AVAILABLE_TIER_COUNT = TIERS.filter((tier) => tier.available).length;

interface DurabilityTierSelectProps {
  value: DurabilityOption;
  /** Provide to make the tiers selectable when more than one tier is available. */
  onChange?: (value: DurabilityOption) => void;
  /** Form-submitting: interaction disabled without the display-only framing. */
  disabled?: boolean;
  /** Force display-only — the tier is shown as read-only info. */
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
  // A real choice exists only when the caller can change the value AND there is
  // more than one tier to change it to. On a single-tier deployment (or any
  // read-only surface) the tier is information, not an input — so it renders as
  // plain info rather than a radio group with a lone locked option (#348).
  const isChoice = !readOnly && !!onChange && AVAILABLE_TIER_COUNT > 1;

  if (!isChoice) {
    const activeTier = TIERS.find((tier) => tier.value === value) ?? TIERS[0];
    return (
      <div
        data-testid="durability-tier-info"
        className="flex items-start gap-12 border border-[var(--color-border-secondary)] bg-[var(--color-surface-medium)] p-12"
      >
        <SealCheckIcon
          aria-hidden
          weight="bold"
          className="mt-2 size-20 shrink-0 text-[var(--color-text-primary)]"
        />
        <span className="flex flex-col gap-4">
          <span className="label-button text-[var(--color-text-primary)]">
            {activeTier.title} durability
          </span>
          <span className="body-small text-[var(--color-text-secondary)]">
            {activeTier.plain}
          </span>
          <span className="body-small text-[var(--color-text-tertiary)]">
            Measured by {activeTier.method}.
          </span>
        </span>
      </div>
    );
  }

  // Genuine choice: more than one tier is available. A not-yet-available tier
  // still renders as a disabled (locked) radio so the group keeps every option
  // visible; the form-submitting `disabled` flag locks the available ones too.
  return (
    <div
      className="grid grid-cols-1 md:grid-cols-2 gap-12"
      role="radiogroup"
      aria-label={ariaLabel}
    >
      {TIERS.map((tier) => {
        const isActive = tier.value === value;
        const selectable = tier.available && !disabled;
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
              // (form-submitting or not-yet-available) so the group never loses
              // all its `role="radio"` descendants. A div carries no tabindex,
              // so it stays out of the tab order — the WAI-ARIA disabled-radio
              // contract.
              role="radio"
              aria-checked={isActive}
              aria-disabled
              title={
                !tier.available
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
              !isActive && "hover:border-[var(--color-border-primary)]",
            )}
          >
            {card}
          </button>
        );
      })}
    </div>
  );
}
