"use client";

import { cn } from "@/lib/utils";

export interface RadioCardOption {
  key: string;
  title: string;
  description?: string;
  disabled?: boolean;
  badge?: string;
}

export function RadioCardGroup({
  label,
  value,
  options,
  onChange,
  disabled = false,
}: {
  label: string;
  value: string;
  options: readonly RadioCardOption[];
  onChange: (key: string) => void;
  disabled?: boolean;
}) {
  return (
    <div
      role="radiogroup"
      aria-label={label}
      className="grid grid-cols-1 gap-8 sm:grid-cols-2"
    >
      {options.map((option) => {
        const optionDisabled = disabled || option.disabled;
        const isActive = option.key === value;
        const body = (
          <>
            <span className="flex items-center gap-8">
              <RadioDot active={isActive} muted={optionDisabled} />
              <span className="body-small font-medium text-[var(--color-text-primary)]">
                {option.title}
              </span>
              {option.badge && (
                <span className="body-caption text-[var(--color-text-tertiary)]">
                  {option.badge}
                </span>
              )}
            </span>
            {option.description && (
              <span className="body-caption pl-24 text-[var(--color-text-tertiary)]">
                {option.description}
              </span>
            )}
          </>
        );
        const cardClass = cn(
          "flex flex-col gap-4 border px-12 py-10 text-left transition-colors duration-300",
          isActive
            ? "border-[var(--color-interaction)] bg-[var(--color-background-interaction-light)]"
            : "border-[var(--color-border-tertiary)] bg-[var(--color-background-white)]",
          optionDisabled && "opacity-60",
        );

        if (optionDisabled) {
          return (
            <div
              key={option.key}
              role="radio"
              aria-checked={isActive}
              aria-disabled
              className={cardClass}
            >
              {body}
            </div>
          );
        }

        return (
          <button
            key={option.key}
            type="button"
            role="radio"
            aria-checked={isActive}
            onClick={() => onChange(option.key)}
            className={cn(
              cardClass,
              "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-border-primary)]",
              !isActive && "hover:border-[var(--color-border-primary)]",
            )}
          >
            {body}
          </button>
        );
      })}
    </div>
  );
}

function RadioDot({ active, muted }: { active: boolean; muted?: boolean }) {
  return (
    <span
      aria-hidden
      className={cn(
        "flex size-16 shrink-0 items-center justify-center rounded-full border",
        active
          ? "border-[var(--color-interaction)]"
          : muted
            ? "border-[var(--color-border-tertiary)]"
            : "border-[var(--color-border-primary)]",
      )}
    >
      {active && (
        <span className="size-6 rounded-full bg-[var(--color-interaction)]" />
      )}
    </span>
  );
}
