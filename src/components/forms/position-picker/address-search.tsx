"use client";

/**
 * Address search input for PositionPicker — debounced forward-geocode with a
 * keyboard-navigable results listbox. Selecting a hit hands the coordinates
 * to the picker; the query text is display-only and never written into the
 * entity's `address` field (plan: forward-geocode from an address is a read).
 */

import { useId, useRef, useState } from "react";
import { MagnifyingGlassIcon } from "@phosphor-icons/react/dist/ssr";
import { FormInput } from "@/components/forms/form-input";
import { cn } from "@/lib/utils";
import { GEOCODE_DEBOUNCE_MS } from "@/config/geo";
import { useDebounce } from "@/hooks/use-debounce";
import { useGeocodeSearch } from "@/hooks/use-geo";
import type { GeocodeResult } from "@/lib/geo/types";

const MIN_QUERY_LENGTH = 3;

interface AddressSearchProps {
  id: string;
  disabled?: boolean;
  /** From useGeoCapabilities — search is unavailable without the server key. */
  routingConfigured: boolean;
  onSelect: (result: GeocodeResult) => void;
}

export function AddressSearch({
  id,
  disabled = false,
  routingConfigured,
  onSelect,
}: AddressSearchProps) {
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState(false);
  const [activeIndex, setActiveIndex] = useState(-1);
  const inputRef = useRef<HTMLInputElement>(null);
  const listboxId = useId();

  const debouncedQuery = useDebounce(query, GEOCODE_DEBOUNCE_MS);
  const searchEnabled =
    routingConfigured && !disabled && open && query.trim().length >= MIN_QUERY_LENGTH;
  const { data: results, isFetching, isError } = useGeocodeSearch(
    debouncedQuery,
    searchEnabled
  );

  const showList =
    open &&
    query.trim().length >= MIN_QUERY_LENGTH &&
    (isFetching || isError || results !== undefined);
  const hits = results ?? [];

  const select = (result: GeocodeResult) => {
    onSelect(result);
    setQuery(result.label);
    setOpen(false);
    setActiveIndex(-1);
  };

  const handleKeyDown = (event: React.KeyboardEvent<HTMLInputElement>) => {
    if (!showList || hits.length === 0) {
      if (event.key === "Escape") setOpen(false);
      return;
    }
    switch (event.key) {
      case "ArrowDown":
        event.preventDefault();
        setActiveIndex((index) => (index + 1) % hits.length);
        break;
      case "ArrowUp":
        event.preventDefault();
        // -1 (no selection) and 0 both wrap to the last item.
        setActiveIndex((index) => (index <= 0 ? hits.length - 1 : index - 1));
        break;
      case "Enter":
        if (activeIndex >= 0) {
          event.preventDefault();
          select(hits[activeIndex]);
        }
        break;
      case "Escape":
        event.preventDefault();
        setOpen(false);
        setActiveIndex(-1);
        break;
    }
  };

  const unavailable = !routingConfigured;

  return (
    <div className="relative">
      <div className="relative">
        <MagnifyingGlassIcon
          size={16}
          aria-hidden="true"
          className="absolute left-12 top-1/2 -translate-y-1/2 text-[var(--color-text-tertiary)]"
        />
        <FormInput
          ref={inputRef}
          id={id}
          type="text"
          role="combobox"
          aria-expanded={showList}
          aria-controls={listboxId}
          aria-activedescendant={
            activeIndex >= 0 ? `${listboxId}-option-${activeIndex}` : undefined
          }
          aria-autocomplete="list"
          autoComplete="off"
          className="pl-36"
          placeholder={
            unavailable ? "Address search unavailable" : "Search address or place…"
          }
          disabled={disabled || unavailable}
          value={query}
          onChange={(event) => {
            setQuery(event.target.value);
            setOpen(true);
            setActiveIndex(-1);
          }}
          onFocus={() => setOpen(true)}
          onBlur={() => {
            // Delay matters less than correctness: option mousedown below
            // preventDefaults, so blur only fires for genuine focus loss.
            setOpen(false);
            setActiveIndex(-1);
          }}
          onKeyDown={handleKeyDown}
        />
      </div>

      {showList && (
        <ul
          id={listboxId}
          role="listbox"
          aria-label="Address matches"
          className="absolute z-20 mt-2 max-h-[220px] w-full overflow-y-auto border border-[var(--clr-dark-purple)] bg-[var(--color-background-white)] shadow-[0_4px_16px_var(--color-black-10)]"
        >
          {isFetching && hits.length === 0 && (
            <li className="px-12 py-10 body-caption uppercase tracking-[0.08em] text-[var(--color-text-tertiary)]">
              Searching…
            </li>
          )}
          {isError && (
            <li className="px-12 py-10 body-caption uppercase tracking-[0.08em] text-[var(--color-signal-red)]">
              Search failed — try again
            </li>
          )}
          {!isFetching && !isError && hits.length === 0 && (
            <li className="px-12 py-10 body-caption uppercase tracking-[0.08em] text-[var(--color-text-tertiary)]">
              No matches
            </li>
          )}
          {hits.map((hit, index) => (
            <li
              key={`${hit.label}-${hit.lat}-${hit.lng}`}
              id={`${listboxId}-option-${index}`}
              role="option"
              aria-selected={index === activeIndex}
              className={cn(
                "flex min-h-[44px] cursor-pointer items-center px-12 py-8 body-small",
                index === activeIndex
                  ? "bg-[var(--clr-dark-purple)] text-[var(--color-background-white)]"
                  : "text-[var(--color-text-primary)] hover:bg-[var(--color-background-interaction-light)]"
              )}
              // preventDefault keeps the input focused so onBlur doesn't
              // close the list before the click lands.
              onMouseDown={(event) => event.preventDefault()}
              onClick={() => select(hit)}
              onMouseEnter={() => setActiveIndex(index)}
            >
              {hit.label}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
