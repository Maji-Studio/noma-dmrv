"use client";

/**
 * SegmentedControl: short, equal options as one bar (loss / count, storage
 * type). Same native-radio contract as ChoiceCardGroup: one tab stop, arrow
 * keys move and select, register(name) or value + onValueChange. The selected
 * segment is raised, bordered and carries a check glyph, so it reads without
 * colour and in forced-colors mode.
 */

import {
  forwardRef,
  useId,
  type ChangeEvent,
  type FocusEventHandler,
} from "react";
import { CheckIcon } from "@phosphor-icons/react/dist/ssr";
import { cn } from "@/lib/utils";

export interface SegmentedOption {
  value: string;
  label: string;
  disabled?: boolean;
}

export interface SegmentedControlProps {
  options: readonly SegmentedOption[];
  /** Accessible name of the group (screen-reader legend). */
  legend: string;
  name?: string;
  id?: string;
  value?: string | null;
  onChange?: (event: ChangeEvent<HTMLInputElement>) => void;
  onValueChange?: (value: string) => void;
  onBlur?: FocusEventHandler<HTMLInputElement>;
  disabled?: boolean;
  error?: boolean;
  "aria-describedby"?: string;
  "aria-invalid"?: boolean | "true" | "false";
  className?: string;
}

export const SegmentedControl = forwardRef<HTMLInputElement, SegmentedControlProps>(
  (
    {
      options,
      legend,
      name,
      id,
      value,
      onChange,
      onValueChange,
      onBlur,
      disabled = false,
      error,
      className,
      ...aria
    },
    ref,
  ) => {
    const generatedName = useId();
    const groupName = name ?? generatedName;
    const controlled = value !== undefined;

    return (
      <fieldset
        id={id}
        className={cn(
          "m-0 grid min-w-0 auto-cols-fr grid-flow-col gap-2 border p-2",
          "bg-[var(--color-surface-light)]",
          error ? "border-[var(--color-signal-red)]" : "border-transparent",
          className,
        )}
        aria-describedby={aria["aria-describedby"]}
        aria-invalid={error ? true : aria["aria-invalid"]}
      >
        <legend className="sr-only">{legend}</legend>
        {options.map((option) => {
          const optionDisabled = disabled || option.disabled;
          return (
            <label
              key={option.value}
              className={cn("group relative flex", optionDisabled ? "cursor-not-allowed" : "cursor-pointer")}
            >
              <input
                ref={ref}
                type="radio"
                name={groupName}
                value={option.value}
                disabled={optionDisabled}
                {...(controlled ? { checked: value === option.value } : {})}
                onChange={(event) => {
                  onChange?.(event);
                  onValueChange?.(event.target.value);
                }}
                onBlur={onBlur}
                className="peer sr-only"
              />
              <span
                className={cn(
                  "flex min-h-44 w-full items-center justify-center gap-6 border border-transparent px-12 text-center",
                  "body-small text-[var(--color-text-secondary)] transition-colors duration-300",
                  "hover:text-[var(--color-text-primary)]",
                  "peer-checked:border-[var(--color-interaction)] peer-checked:bg-[var(--color-background-white)] peer-checked:text-[var(--color-text-primary)]",
                  "forced-colors:peer-checked:border-[Highlight] forced-colors:peer-checked:border-2",
                  "peer-focus-visible:outline-2 peer-focus-visible:outline-offset-2 peer-focus-visible:outline-[var(--color-interaction)]",
                  "peer-disabled:opacity-60",
                )}
              >
                <CheckIcon aria-hidden size={12} weight="bold" className="hidden shrink-0 group-has-[input:checked]:block" />
                {option.label}
              </span>
            </label>
          );
        })}
      </fieldset>
    );
  },
);

SegmentedControl.displayName = "SegmentedControl";
