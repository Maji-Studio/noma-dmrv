"use client";

import { forwardRef, type ComponentProps } from "react";
import { CheckIcon } from "@phosphor-icons/react/dist/ssr";
import { FormTextarea } from "@/components/forms";
import { cn } from "@/lib/utils";

/** Common causes of a stock loss. Picking one starts the reason text; the operator adds the detail. */
export const LOSS_REASON_PRESETS = ["Spoilage", "Spillage", "Write-off", "Failed run"] as const;

const PRESET_SEPARATOR = ": ";

function presetOf(value: string): string | undefined {
  return LOSS_REASON_PRESETS.find((preset) => value === preset || value.startsWith(`${preset}${PRESET_SEPARATOR}`));
}

/** Swap the leading preset for the picked one, or put it in front of the typed text. */
export function reasonWithPreset(value: string, picked: string): string {
  const current = presetOf(value);
  if (current === picked) {
    // Picking the active chip again clears it and keeps the typed detail.
    return value.slice(current.length + PRESET_SEPARATOR.length);
  }
  const detail = current ? value.slice(current.length + PRESET_SEPARATOR.length) : value;
  return detail.trim() ? `${picked}${PRESET_SEPARATOR}${detail}` : picked;
}

type ReasonProps = ComponentProps<typeof FormTextarea> & {
  value: string;
  onPick: (next: string) => void;
};

/** Chips above the free-text reason. Forwards the FormField aria props to the textarea. */
export const LossReasonChips = forwardRef<HTMLTextAreaElement, ReasonProps>(
  ({ value, onPick, disabled, ...textareaProps }, ref) => {
    const active = presetOf(value);
    return (
      <div className="flex flex-col gap-8">
        <div role="group" aria-label="Common reasons" className="flex flex-wrap gap-6">
          {LOSS_REASON_PRESETS.map((preset) => (
            <button
              key={preset}
              type="button"
              disabled={disabled}
              aria-pressed={active === preset}
              onClick={() => onPick(reasonWithPreset(value, preset))}
              className={cn(
                "body-small inline-flex min-h-32 items-center gap-6 border px-12 transition-colors duration-300",
                "border-[var(--color-border-secondary)] bg-[var(--color-background-white)] text-[var(--color-text-secondary)]",
                "hover:border-[var(--color-border-primary)]",
                "aria-pressed:border-[var(--color-interaction)] aria-pressed:bg-[var(--color-background-interaction-light)] aria-pressed:text-[var(--color-text-primary)]",
                "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--color-interaction)]",
                "disabled:opacity-60",
              )}
            >
              {/* The mark says "picked" without relying on colour. */}
              {active === preset && <CheckIcon aria-hidden size={12} weight="bold" className="shrink-0" />}
              {preset}
            </button>
          ))}
        </div>
        <FormTextarea ref={ref} disabled={disabled} {...textareaProps} />
      </div>
    );
  },
);

LossReasonChips.displayName = "LossReasonChips";
