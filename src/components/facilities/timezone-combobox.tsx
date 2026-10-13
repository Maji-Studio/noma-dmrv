"use client";

import { useState, type Ref } from "react";
import { Combobox } from "@base-ui/react/combobox";
import {
  CaretDownIcon,
  CheckIcon,
  MagnifyingGlassIcon,
} from "@phosphor-icons/react/dist/ssr";
import { formatTimezoneLabel } from "@/lib/date-utils";
import { cn } from "@/lib/utils";
import {
  orderWithSuggestions,
  searchQueryAfterInputChange,
  searchTimezones,
  findTimezoneEntry,
  timezonesForCountry,
  type TimezoneEntry,
} from "@/lib/timezones";

const POPOVER_SIDE_OFFSET_PX = 4;

interface TimezoneOption {
  value: string;
  label: string;
  /** "Tanzania · East Africa Time": what the id alone does not say. */
  detail: string;
}

/** Labels read the clock, so build each once and reuse it across renders. */
const optionCache = new Map<string, TimezoneOption>();

function toOption(entry: TimezoneEntry): TimezoneOption {
  const cached = optionCache.get(entry.id);
  if (cached) return cached;
  const option = {
    value: entry.id,
    label: formatTimezoneLabel(entry.id),
    detail: [entry.countryName, entry.readableName].filter(Boolean).join(" · "),
  };
  optionCache.set(entry.id, option);
  return option;
}

interface TimezoneComboboxProps {
  id: string;
  name: string;
  inputRef: Ref<HTMLInputElement>;
  value?: string;
  /** Free-text country of the record; its zones are offered first. */
  country?: string | null;
  onChange: (value: string | undefined) => void;
  onBlur: () => void;
  disabled?: boolean;
  /** Native required constraint; off where the zone is optional. */
  required?: boolean;
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
  country,
  onChange,
  onBlur,
  disabled = false,
  required = true,
  error = false,
  placeholder = "Select timezone",
  "aria-describedby": ariaDescribedBy,
  "aria-invalid": ariaInvalid,
}: TimezoneComboboxProps) {
  const [query, setQuery] = useState("");
  const selectedEntry = findTimezoneEntry(value);
  const selectedOption = selectedEntry ? toOption(selectedEntry) : null;
  const suggested = timezonesForCountry(country);
  const suggestedIds = new Set(suggested.map((entry) => entry.id));
  // The input shows the chosen label after a pick; that is not a search.
  const searchText = query;
  const visibleOptions = (
    searchText
      ? searchTimezones(searchText, suggestedIds)
      : orderWithSuggestions(suggested)
  ).map(toOption);
  const showSuggestedTag = !searchText && suggestedIds.size > 0;
  const isInvalid =
    error || ariaInvalid === true || ariaInvalid === "true";

  return (
    <Combobox.Root
      id={`${id}-combobox`}
      name={name}
      items={visibleOptions}
      filteredItems={visibleOptions}
      onInputValueChange={(value, details) =>
        setQuery(searchQueryAfterInputChange(value, details.reason))
      }
      value={selectedOption}
      onValueChange={(option) => onChange(option?.value)}
      isItemEqualToValue={(option, selected) =>
        option.value === selected.value
      }
      autoHighlight
      disabled={disabled}
      required={required}
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
            <Combobox.Empty className="px-12 py-10 empty:hidden body-small text-[var(--color-text-tertiary)]">
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
                  <span className="min-w-0 flex-1">
                    <span className="block">{option.label}</span>
                    {option.detail ? (
                      <span className="block body-caption text-[var(--color-text-tertiary)]">
                        {option.detail}
                      </span>
                    ) : null}
                  </span>
                  {showSuggestedTag && suggestedIds.has(option.value) ? (
                    <span className="shrink-0 body-caption text-[var(--color-text-tertiary)]">
                      Suggested
                    </span>
                  ) : null}
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
