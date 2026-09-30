"use client";

/**
 * ChoiceCardGroup: a radio group drawn as cards, for choices with a
 * consequence (docs/design-system.md, "Choice controls"). Built on native
 * radios, so one tab stop and arrow keys come from the browser. The whole card
 * is the touch target, the selected card carries a check glyph and a heavier
 * border (both survive forced-colors), and the columns follow the width of the
 * group, not the viewport: sheets are 360 to 640px wide.
 *
 * Two ways to wire it, like FormSelect: spread `register(name)` (uncontrolled,
 * `value` omitted) or pass `value` + `onValueChange` (controlled).
 */

import {
  forwardRef,
  useId,
  type ChangeEvent,
  type FocusEventHandler,
  type ReactNode,
} from "react";
import { CheckIcon } from "@phosphor-icons/react/dist/ssr";
import { cn } from "@/lib/utils";

export interface ChoiceCardOption {
  value: string;
  title: string;
  /** One short line: the consequence of choosing this option. */
  description?: string;
  /** Small monoline drawing, decorative (aria-hidden). */
  art?: ReactNode;
  disabled?: boolean;
  badge?: string;
}

export interface ChoiceCardGroupProps {
  options: readonly ChoiceCardOption[];
  /** Accessible name of the group (screen-reader legend). FormField's label is the visible one. */
  legend: string;
  name?: string;
  id?: string;
  /** Controlled value. Omit when spreading `register(name)`. */
  value?: string | null;
  onChange?: (event: ChangeEvent<HTMLInputElement>) => void;
  onValueChange?: (value: string) => void;
  onBlur?: FocusEventHandler<HTMLInputElement>;
  disabled?: boolean;
  error?: boolean;
  "aria-describedby"?: string;
  "aria-invalid"?: boolean | "true" | "false";
  className?: string;
  /** Put the art above the text at every width, for drawings too wide to sit beside it. */
  stackArt?: boolean;
}

/** Width of the group at which each column count starts. Cards keep about 176px. */
const COLUMN_CLASSES = {
  1: "",
  2: "@min-[17rem]:grid-cols-2",
  3: "@min-[34rem]:grid-cols-3",
} as const;

/**
 * Art sits beside the text (shortest card). Only three-up columns are too
 * narrow for that, so those stack the art above the text.
 */
const STACK_CLASSES = {
  1: "",
  2: "",
  3: "@min-[34rem]:flex-col @min-[34rem]:items-start",
} as const;

/** Columns once the group is wide: fill rows evenly so no half row is left dead. */
function wideColumns(count: number): 1 | 2 | 3 {
  if (count <= 1) return 1;
  if (count === 2 || count === 4) return 2;
  return 3;
}

export const ChoiceCardGroup = forwardRef<HTMLInputElement, ChoiceCardGroupProps>(
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
      stackArt = false,
      ...aria
    },
    ref,
  ) => {
    const generatedName = useId();
    const groupName = name ?? generatedName;
    const controlled = value !== undefined;
    const columns = wideColumns(options.length);

    return (
      <fieldset
        id={id}
        className="min-w-0 border-0 p-0 m-0"
        aria-describedby={aria["aria-describedby"]}
        aria-invalid={error ? true : aria["aria-invalid"]}
      >
        <legend className="sr-only">{legend}</legend>
        <div className="@container">
          <div className={cn("grid grid-cols-1 gap-8", COLUMN_CLASSES[columns], className)}>
            {options.map((option) => {
              const optionDisabled = disabled || option.disabled;
              return (
                <label
                  key={option.value}
                  className={cn(
                    "group relative flex h-full",
                    optionDisabled ? "cursor-not-allowed" : "cursor-pointer",
                  )}
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
                      "flex w-full items-center gap-12 border px-12 py-10 text-left transition-colors duration-300",
                      STACK_CLASSES[columns],
                      stackArt && "flex-col items-start",
                      "border-[var(--color-border-secondary)] bg-[var(--color-background-white)]",
                      "hover:border-[var(--color-border-primary)]",
                      "peer-checked:border-[var(--color-interaction)] peer-checked:bg-[var(--color-background-interaction-light)] peer-checked:shadow-[inset_0_0_0_1px_var(--color-interaction)]",
                      "forced-colors:peer-checked:border-[Highlight] forced-colors:peer-checked:border-2",
                      "peer-focus-visible:outline-2 peer-focus-visible:outline-offset-2 peer-focus-visible:outline-[var(--color-interaction)]",
                      "peer-disabled:opacity-60 peer-disabled:hover:border-[var(--color-border-secondary)]",
                      error && "border-[var(--color-signal-red)]",
                    )}
                  >
                    {option.art && (
                      <span
                        aria-hidden
                        className={cn(
                          "shrink-0 items-center text-[var(--color-text-secondary)]",
                          stackArt ? "flex" : "hidden @min-[22rem]:flex",
                        )}
                      >
                        {option.art}
                      </span>
                    )}
                    <span className="flex min-w-0 flex-1 flex-col gap-4">
                      <span className="flex items-center gap-8">
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
                        <span className="body-caption text-[var(--color-text-tertiary)]">
                          {option.description}
                        </span>
                      )}
                    </span>
                    <span
                      aria-hidden
                      className="absolute right-8 top-8 flex size-16 items-center justify-center rounded-full bg-[var(--color-interaction)] opacity-0 group-has-[input:checked]:opacity-100 text-[var(--color-background-white)] forced-colors:bg-[Highlight] forced-colors:text-[HighlightText]"
                    >
                      <CheckIcon size={10} weight="bold" />
                    </span>
                  </span>
                </label>
              );
            })}
          </div>
        </div>
      </fieldset>
    );
  },
);

ChoiceCardGroup.displayName = "ChoiceCardGroup";
