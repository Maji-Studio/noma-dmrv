"use client";

import type { Ref } from "react";
import { Combobox } from "@base-ui/react/combobox";
import {
  CaretDownIcon,
  CheckIcon,
  MagnifyingGlassIcon,
} from "@phosphor-icons/react/dist/ssr";
import { formatTimezoneLabel } from "@/lib/date-utils";
import { cn } from "@/lib/utils";
import { timezones, type Timezone } from "@/schemas/facilities";

const POPOVER_SIDE_OFFSET_PX = 4;

interface TimezoneOption {
  value: Timezone;
  label: string;
}

const TIMEZONE_OPTIONS: readonly TimezoneOption[] = timezones.map((timezone) => ({
  value: timezone,
  label: formatTimezoneLabel(timezone),
}));

interface TimezoneComboboxProps {
  id: string;
  name: string;
  inputRef: Ref<HTMLInputElement>;
  value?: Timezone;
  onChange: (value: Timezone | undefined) => void;
  onBlur: () => void;
  disabled?: boolean;
  error?: boolean;
  placeholder?: string;
  "aria-describedby"?: string;
  "aria-invalid"?: boolean | "true" | "false";
}

export function TimezoneCombobox({
  id,
  name,
  inputRef,
  value,
  onChange,
  onBlur,
  disabled = false,
  error = false,
  placeholder = "Search timezone…",
  "aria-describedby": ariaDescribedBy,
  "aria-invalid": ariaInvalid,
}: TimezoneComboboxProps) {
  const selectedOption =
    TIMEZONE_OPTIONS.find((option) => option.value === value) ?? null;
  const isInvalid =
    error || ariaInvalid === true || ariaInvalid === "true";

  return (
    <Combobox.Root
      id={`${id}-combobox`}
      name={name}
      items={TIMEZONE_OPTIONS}
      value={selectedOption}
      onValueChange={(option) => onChange(option?.value)}
      isItemEqualToValue={(option, selected) =>
        option.value === selected.value
      }
      autoHighlight
      disabled={disabled}
      required
    >
      <div className="relative">
        <MagnifyingGlassIcon
          aria-hidden
          size={16}
          weight="bold"
          className="pointer-events-none absolute left-12 top-1/2 -translate-y-1/2 text-[var(--color-text-tertiary)]"
        />
        <Combobox.Input
          ref={inputRef}
          id={id}
          placeholder={placeholder}
          onBlur={onBlur}
          aria-describedby={ariaDescribedBy}
          aria-invalid={isInvalid ? "true" : "false"}
          className={cn(
            "flex h-40 w-full border border-[var(--color-border-secondary)] bg-[var(--color-background-white)] pl-36 pr-36 text-[var(--color-text-primary)] text-[var(--text-s)] transition-all",
            "placeholder:text-[var(--color-text-tertiary)] focus-visible:outline-none focus-visible:border-[var(--color-interaction)] focus-visible:ring-1 focus-visible:ring-[var(--color-interaction)]",
            "disabled:cursor-not-allowed disabled:opacity-50 rounded-none",
            "shadow-[inset_0_1px_2px_rgba(0,0,0,0.04)]",
            error && "border-[var(--color-signal-red)]",
          )}
        />
        <Combobox.Icon className="pointer-events-none absolute right-12 top-1/2 -translate-y-1/2 text-[var(--color-text-tertiary)]">
          <CaretDownIcon aria-hidden size={16} weight="bold" />
        </Combobox.Icon>
      </div>

      <Combobox.Portal>
        <Combobox.Positioner
          align="start"
          sideOffset={POPOVER_SIDE_OFFSET_PX}
          className="z-[var(--z-layer-popover)] w-[var(--anchor-width)]"
        >
          <Combobox.Popup className="w-full bg-[var(--paper)] [border:var(--hair)] outline-none">
            <Combobox.Empty className="px-12 py-10 body-small text-[var(--color-text-tertiary)]">
              No timezones found
            </Combobox.Empty>
            <Combobox.List className="max-h-320 overflow-y-auto py-4">
              {(option: TimezoneOption, index: number) => (
                <Combobox.Item
                  key={option.value}
                  value={option}
                  index={index}
                  className={cn(
                    "flex min-h-44 cursor-pointer items-center gap-8 px-12 py-8 body-small text-[var(--color-text-primary)] outline-none",
                    "data-[highlighted]:bg-[var(--color-background-medium)]",
                  )}
                >
                  <span className="min-w-0 flex-1">{option.label}</span>
                  <Combobox.ItemIndicator className="shrink-0 text-[var(--color-text-primary)]">
                    <CheckIcon aria-hidden size={16} weight="bold" />
                  </Combobox.ItemIndicator>
                </Combobox.Item>
              )}
            </Combobox.List>
          </Combobox.Popup>
        </Combobox.Positioner>
      </Combobox.Portal>
    </Combobox.Root>
  );
}
