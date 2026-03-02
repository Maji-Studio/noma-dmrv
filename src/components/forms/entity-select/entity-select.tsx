/**
 * Entity Select Component
 * Searchable dropdown for entity selection with async loading
 */
"use client";

import {
  useState,
  useRef,
  useEffect,
  useCallback,
  useMemo,
  type KeyboardEvent,
} from "react";
import { cn } from "@/lib/utils";
import { useEntityOptions, useEntityById } from "@/hooks/use-entities";
import type { EntitySelectProps, EntityOption } from "./types";

// Icons
function ChevronDown({ className }: { className?: string }) {
  return (
    <svg
      className={className}
      width="16"
      height="16"
      viewBox="0 0 16 16"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
    >
      <path
        d="M4 6L8 10L12 6"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function SearchIcon({ className }: { className?: string }) {
  return (
    <svg
      className={className}
      width="16"
      height="16"
      viewBox="0 0 16 16"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
    >
      <path
        d="M7.333 12.667A5.333 5.333 0 1 0 7.333 2a5.333 5.333 0 0 0 0 10.667ZM14 14l-2.9-2.9"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function PlusIcon({ className }: { className?: string }) {
  return (
    <svg
      className={className}
      width="16"
      height="16"
      viewBox="0 0 16 16"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
    >
      <path
        d="M8 3.333v9.334M3.333 8h9.334"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function XIcon({ className }: { className?: string }) {
  return (
    <svg
      className={className}
      width="16"
      height="16"
      viewBox="0 0 16 16"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
    >
      <path
        d="M12 4L4 12M4 4l8 8"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function SpinnerIcon({ className }: { className?: string }) {
  return (
    <svg
      className={cn("animate-spin", className)}
      width="16"
      height="16"
      viewBox="0 0 16 16"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
    >
      <circle
        cx="8"
        cy="8"
        r="6"
        stroke="currentColor"
        strokeOpacity="0.25"
        strokeWidth="2"
      />
      <path
        d="M8 2a6 6 0 0 1 6 6"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
      />
    </svg>
  );
}

// Human-readable entity type labels
const ENTITY_TYPE_LABELS: Record<string, string> = {
  facility: "facility",
  reactor: "reactor",
  supplier: "supplier",
  customer: "customer",
  driver: "driver",
  operator: "operator",
  storageLocation: "storage location",
  vehicle: "vehicle",
  feedstockType: "feedstock type",
  feedstock: "feedstock",
  productionRun: "production run",
  formulation: "formulation",
};
const SEARCH_VISIBILITY_THRESHOLD = 5;

// Debounce hook
function useDebounce<T>(value: T, delay: number): T {
  const [debouncedValue, setDebouncedValue] = useState(value);

  useEffect(() => {
    const timer = setTimeout(() => setDebouncedValue(value), delay);
    return () => clearTimeout(timer);
  }, [value, delay]);

  return debouncedValue;
}

export function EntitySelect({
  entityType,
  value,
  onChange,
  placeholder,
  disabled = false,
  error = false,
  className,
  allowCreate = false,
  createLabel,
  onCreateNew,
  filterBy,
}: EntitySelectProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [highlightedIndex, setHighlightedIndex] = useState(0);

  const containerRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const listboxRef = useRef<HTMLUListElement>(null);

  // Debounce search for better performance
  const debouncedSearch = useDebounce(searchQuery, 200);

  // Fetch options based on search
  const {
    data: options = [],
    isLoading,
    error: fetchError,
  } = useEntityOptions({
    entityType,
    search: debouncedSearch,
    filterBy,
    enabled: isOpen,
  });

  // Fetch selected entity details
  const { data: selectedEntity } = useEntityById(entityType, value);

  // Get display text for the selected value
  const displayText = useMemo(() => {
    if (selectedEntity) {
      return selectedEntity.name;
    }
    return "";
  }, [selectedEntity]);

  // Clamp highlighted index when options change
  const clampedHighlightedIndex = useMemo(() => {
    const maxIndex = options.length + (allowCreate && onCreateNew ? 1 : 0) - 1;
    return Math.min(Math.max(0, highlightedIndex), Math.max(0, maxIndex));
  }, [highlightedIndex, options.length, allowCreate, onCreateNew]);
  const showSearch = searchQuery.length > 0 || options.length > SEARCH_VISIBILITY_THRESHOLD;

  // Close dropdown when clicking outside
  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (
        containerRef.current &&
        !containerRef.current.contains(event.target as Node)
      ) {
        setIsOpen(false);
        setSearchQuery("");
      }
    }

    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  // Focus input when dropdown opens and search is visible
  useEffect(() => {
    if (isOpen && showSearch && inputRef.current) {
      inputRef.current.focus();
    }
  }, [isOpen, showSearch]);

  // Scroll highlighted option into view
  useEffect(() => {
    if (isOpen && listboxRef.current) {
      const highlightedElement = listboxRef.current.children[
        clampedHighlightedIndex
      ] as HTMLElement;
      if (highlightedElement) {
        highlightedElement.scrollIntoView({ block: "nearest" });
      }
    }
  }, [clampedHighlightedIndex, isOpen]);

  const handleSelect = useCallback(
    (option: EntityOption) => {
      onChange(option.id);
      setIsOpen(false);
      setSearchQuery("");
    },
    [onChange]
  );

  const handleClear = useCallback(
    (e: React.MouseEvent) => {
      e.stopPropagation();
      onChange("");
    },
    [onChange]
  );

  const handleKeyDown = useCallback(
    (e: KeyboardEvent<HTMLInputElement>) => {
      const optionCount = options.length + (allowCreate && onCreateNew ? 1 : 0);

      switch (e.key) {
        case "ArrowDown":
          e.preventDefault();
          setHighlightedIndex((prev) => Math.min(prev + 1, optionCount - 1));
          break;
        case "ArrowUp":
          e.preventDefault();
          setHighlightedIndex((prev) => Math.max(prev - 1, 0));
          break;
        case "Enter":
          e.preventDefault();
          if (clampedHighlightedIndex === options.length && allowCreate && onCreateNew) {
            // Create new option selected
            onCreateNew();
            setIsOpen(false);
            setSearchQuery("");
          } else if (options[clampedHighlightedIndex]) {
            handleSelect(options[clampedHighlightedIndex]);
          }
          break;
        case "Escape":
          e.preventDefault();
          setIsOpen(false);
          setSearchQuery("");
          break;
        case "Tab":
          setIsOpen(false);
          setSearchQuery("");
          break;
      }
    },
    [options, clampedHighlightedIndex, allowCreate, onCreateNew, handleSelect]
  );

  const handleToggle = useCallback(() => {
    if (!disabled) {
      setIsOpen((prev) => !prev);
    }
  }, [disabled]);

  const defaultPlaceholder = `Select ${ENTITY_TYPE_LABELS[entityType] || entityType}...`;
  const defaultCreateLabel = `Add new ${ENTITY_TYPE_LABELS[entityType] || entityType}`;

  return (
    <div ref={containerRef} className={cn("relative", className)}>
      {/* Trigger */}
      <div className="relative flex items-center">
        <button
          type="button"
          onClick={handleToggle}
          disabled={disabled}
          aria-haspopup="listbox"
          aria-expanded={isOpen}
          aria-label={placeholder || defaultPlaceholder}
          data-testid="entity-select-trigger"
          className={cn(
            "flex h-40 w-full items-center justify-between gap-2 border bg-[var(--color-background-white)] px-12 text-[var(--text-s)] transition-all shadow-[inset_0_1px_2px_rgba(0,0,0,0.04)]",
            "focus-visible:outline-none focus-visible:border-[var(--color-interaction)] focus-visible:ring-1 focus-visible:ring-[var(--color-interaction)]",
            error
              ? "border-[var(--color-signal-red)]"
              : "border-[var(--color-border-secondary)]",
            disabled
              ? "cursor-not-allowed opacity-50"
              : "cursor-pointer hover:border-[var(--color-interaction)]",
            value && !disabled ? "pr-[72px]" : "pr-[40px]"
          )}
        >
          <span
            className={cn(
              "truncate text-left",
              value
                ? "text-[var(--color-text-primary)]"
                : "text-[var(--color-text-tertiary)]"
            )}
          >
            {displayText || placeholder || defaultPlaceholder}
          </span>
          <ChevronDown
            className={cn(
              "w-4 h-4 shrink-0 text-[var(--color-text-tertiary)] transition-transform",
              isOpen && "rotate-180"
            )}
          />
        </button>
        {value && !disabled && (
          <button
            type="button"
            onClick={handleClear}
            aria-label="Clear selection"
            data-testid="entity-select-clear"
            className="absolute right-[32px] p-4 hover:bg-[var(--color-background-medium)] text-[var(--color-text-tertiary)] hover:text-[var(--color-text-primary)]"
          >
            <XIcon className="w-4 h-4" />
          </button>
        )}
      </div>

      {/* Dropdown */}
      {isOpen && (
        <div
          className="absolute z-50 mt-1 w-full border border-[var(--color-border-primary)] bg-[var(--color-background-white)] shadow-lg"
          role="presentation"
        >
          {/* Search input */}
          {showSearch && (
            <div className="p-8 border-b border-[var(--color-border-primary)]">
              <div className="relative">
                <SearchIcon className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-[var(--color-text-tertiary)]" />
                <input
                  ref={inputRef}
                  type="text"
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  onKeyDown={handleKeyDown}
                  placeholder={`Search ${ENTITY_TYPE_LABELS[entityType] || entityType}...`}
                  aria-label={`Search ${ENTITY_TYPE_LABELS[entityType] || entityType}`}
                  data-testid="entity-select-search"
                  className="w-full h-[40px] pl-10 pr-4 border border-[var(--color-border-secondary)] bg-[var(--color-background-white)] text-[var(--text-s)] placeholder:text-[var(--color-text-tertiary)] shadow-[inset_0_1px_2px_rgba(0,0,0,0.04)] focus:outline-none focus:border-[var(--color-interaction)] focus:ring-1 focus:ring-[var(--color-interaction)]"
                />
              </div>
            </div>
          )}

          {/* Options list */}
          <ul
            ref={listboxRef}
            role="listbox"
            aria-label={`${ENTITY_TYPE_LABELS[entityType] || entityType} options`}
            data-testid="entity-select-listbox"
            className="max-h-[240px] overflow-y-auto"
          >
            {isLoading ? (
              <li className="flex items-center justify-center gap-2 px-16 py-12 text-[var(--color-text-tertiary)]">
                <SpinnerIcon className="w-4 h-4" />
                <span className="text-[var(--text-s)]">Loading...</span>
              </li>
            ) : fetchError ? (
              <li className="px-16 py-12 text-[var(--text-s)] text-[var(--color-signal-red)]">
                Error loading options
              </li>
            ) : options.length === 0 ? (
              <li className="px-16 py-12 text-[var(--text-s)] text-[var(--color-text-tertiary)]">
                {searchQuery ? "No results found" : "No options available"}
              </li>
            ) : (
              options.map((option, index) => (
                <li
                  key={option.id}
                  role="option"
                  aria-selected={option.id === value}
                  data-testid={`entity-option-${option.id}`}
                  onClick={() => handleSelect(option)}
                  onMouseEnter={() => setHighlightedIndex(index)}
                  className={cn(
                    "px-12 py-8 cursor-pointer transition-colors",
                    index === clampedHighlightedIndex &&
                      "bg-[var(--color-background-medium)]",
                    option.id === value &&
                      "bg-[var(--color-interaction-light)]"
                  )}
                >
                  <span className="text-[var(--text-s)] text-[var(--color-text-primary)]">
                    {option.name}
                  </span>
                </li>
              ))
            )}

            {/* Quick-add option */}
            {allowCreate && onCreateNew && !isLoading && (
              <li
                role="option"
                aria-selected={false}
                data-testid="entity-select-create"
                onClick={() => {
                  onCreateNew();
                  setIsOpen(false);
                  setSearchQuery("");
                }}
                onMouseEnter={() => setHighlightedIndex(options.length)}
                className={cn(
                  "flex items-center gap-8 px-12 py-8 cursor-pointer border-t border-[var(--color-border-primary)] text-[var(--color-interaction)] hover:bg-[var(--color-background-medium)] transition-colors",
                  clampedHighlightedIndex === options.length &&
                    "bg-[var(--color-background-medium)]"
                )}
              >
                <PlusIcon className="w-4 h-4" />
                <span className="text-[var(--text-s)]">
                  {createLabel || defaultCreateLabel}
                </span>
              </li>
            )}
          </ul>
        </div>
      )}
    </div>
  );
}
