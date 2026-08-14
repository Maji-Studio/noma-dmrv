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
  useId,
  useMemo,
  type KeyboardEvent,
} from "react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { useEntityOptions, useEntityById } from "@/hooks/use-entities";
import type { EntitySelectProps, EntityOption } from "./types";
import { useDebounce } from "@/hooks/use-debounce";
import { DriverQuickAddDialog } from "./driver-quick-add-dialog";
import { VehicleQuickAddDialog } from "./vehicle-quick-add-dialog";
import { FeedstockTypeQuickAddDialog } from "./feedstock-type-quick-add-dialog";
import { FormulationQuickAddDialog } from "./formulation-quick-add-dialog";
import { OperatorQuickAddDialog } from "./operator-quick-add-dialog";
import { ENTITY_TYPE_LABELS } from "./entity-labels";
import { formatRemainingMass } from "./remaining-mass";

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

export function EntityOptionText({ option }: { option: EntityOption }) {
  return (
    <>
      <span className="block truncate text-[var(--text-s)] text-[var(--color-text-primary)]">
        {option.name}
      </span>
      {option.subtitle && (
        <span className="block body-small text-[var(--color-text-secondary)] mt-2">
          {option.subtitle}
        </span>
      )}
    </>
  );
}

const SEARCH_VISIBILITY_THRESHOLD = 5;

export function shouldRenderCreateAction({
  allowCreate,
  hasCreateAction,
  isLoading,
  hasFetchError,
  optionCount,
}: {
  allowCreate: boolean;
  hasCreateAction: boolean;
  isLoading: boolean;
  hasFetchError: boolean;
  optionCount: number;
}): boolean {
  return (
    hasCreateAction &&
    !isLoading &&
    (!hasFetchError || allowCreate) &&
    (allowCreate || optionCount === 0)
  );
}

function selectFreshRemainingMass({
  listedOption,
  listDataUpdatedAt,
  selectedEntity,
  detailDataUpdatedAt,
  value,
}: {
  listedOption: EntityOption | undefined;
  listDataUpdatedAt: number;
  selectedEntity: EntityOption | null | undefined;
  detailDataUpdatedAt: number;
  value: string | undefined;
}) {
  const listMass = listedOption?.remainingMass;
  const detailMass =
    selectedEntity && selectedEntity.id === value
      ? selectedEntity.remainingMass
      : undefined;

  if (!detailMass) return listMass;
  if (!listMass) return detailMass;
  return listDataUpdatedAt > detailDataUpdatedAt ? listMass : detailMass;
}

function getFeedstockTypeDefaultUsage(filterBy?: Record<string, string>) {
  const usage = filterBy?.usage ?? filterBy?.feedstockTypeUsage;
  return usage === "pyrolysis" || usage === "blend" ? usage : undefined;
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
  excludeIds,
  autoSelectSingle = false,
  alwaysShowSearch = false,
  hideSearch = false,
  showRemainingDryMass = true,
  formatSelectedLabel,
  emptyHint,
  noneOption,
  "aria-describedby": ariaDescribedBy,
  "aria-invalid": ariaInvalid,
}: EntitySelectProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [highlightedIndex, setHighlightedIndex] = useState(0);
  const [isDriverDialogOpen, setIsDriverDialogOpen] = useState(false);
  const [isOperatorDialogOpen, setIsOperatorDialogOpen] = useState(false);
  const [isVehicleDialogOpen, setIsVehicleDialogOpen] = useState(false);
  const [isFeedstockTypeDialogOpen, setIsFeedstockTypeDialogOpen] = useState(false);
  const [isFormulationDialogOpen, setIsFormulationDialogOpen] = useState(false);

  const containerRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const listboxRef = useRef<HTMLUListElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const entitySelectId = useId();
  const listboxId = `${entitySelectId}-listbox`;
  const remainingMassId = `${entitySelectId}-remaining-mass`;

  // Debounce search for better performance
  const debouncedSearch = useDebounce(searchQuery, 200);

  // Fetch options based on search
  // Also fetch eagerly when autoSelectSingle is enabled (to detect single-option case)
  const {
    data: fetchedOptions = [],
    dataUpdatedAt: listDataUpdatedAt,
    isLoading,
    error: fetchError,
  } = useEntityOptions({
    entityType,
    search: debouncedSearch,
    filterBy,
    enabled: !disabled && (isOpen || (autoSelectSingle && !value)),
  });

  // Hide already-picked options (e.g. blend materials chosen on other lines),
  // but never hide the current selection so it stays visible in its own field.
  const options =
    excludeIds && excludeIds.length > 0
      ? fetchedOptions.filter(
          (option) => option.id === value || !excludeIds.includes(option.id)
        )
      : fetchedOptions;

  // Fetch selected entity details. Derivation-affecting filters (the order
  // exclusion behind remaining-stock figures) must reach the detail fetch
  // too, or the caption's "freshest source wins" rule would mix an excluded
  // list figure with an unexcluded detail figure.
  const detailFilterBy = filterBy?.excludeOrderId
    ? { excludeOrderId: filterBy.excludeOrderId }
    : undefined;
  const {
    data: selectedEntity,
    dataUpdatedAt: detailDataUpdatedAt,
    isPending: isSelectedEntityPending,
  } = useEntityById(entityType, value, detailFilterBy);

  const listedOption = options.find((option) => option.id === value);
  const selectedOption =
    selectedEntity?.id === value ? selectedEntity : listedOption;
  const displayText = selectedOption
    ? (formatSelectedLabel ? formatSelectedLabel(selectedOption) : selectedOption.name)
    : "";
  // Identity remains detail-first, but stock is derived data: use whichever
  // query most recently succeeded. dataUpdatedAt intentionally survives a
  // failed refetch, so retained detail data cannot mask a fresher list result.
  const remainingMass = selectFreshRemainingMass({
    listedOption,
    listDataUpdatedAt,
    selectedEntity,
    detailDataUpdatedAt,
    value,
  });
  const triggerDescribedBy = [
    ariaDescribedBy,
    remainingMass ? remainingMassId : undefined,
  ]
    .filter(Boolean)
    .join(" ") || undefined;
  // Only while the by-ID fetch is unresolved — once it settles without a
  // match (deleted or inaccessible entity) the ordinary placeholder returns.
  const isSelectionLoading = Boolean(
    value && !selectedOption && isSelectedEntityPending,
  );

  const handleCreatedEntity = useCallback(
    (entity: EntityOption) => {
      onChange(entity.id);
      setIsOpen(false);
      setSearchQuery("");
    },
    [onChange]
  );

  const defaultCreateAction = useMemo(() => {
    switch (entityType) {
      case "driver":
        return () => setIsDriverDialogOpen(true);
      case "operator":
        return () => setIsOperatorDialogOpen(true);
      case "vehicle":
        return () => setIsVehicleDialogOpen(true);
      case "feedstockType":
        return () => setIsFeedstockTypeDialogOpen(true);
      case "formulation":
        return () => setIsFormulationDialogOpen(true);
      default:
        return undefined;
    }
  }, [entityType]);

  const resolvedCreateAction = onCreateNew ?? defaultCreateAction;
  const hasCreateAction = Boolean(resolvedCreateAction);
  const shouldShowCreateAction = shouldRenderCreateAction({
    allowCreate,
    hasCreateAction,
    isLoading,
    hasFetchError: Boolean(fetchError),
    optionCount: options.length,
  });

  // The none row only participates while the list is unsearched: a search is
  // a lookup for a real entity, not a way to reach "none".
  const showNoneOption = Boolean(noneOption) && searchQuery.length === 0;
  const noneOffset = showNoneOption ? 1 : 0;

  // Clamp highlighted index when options change
  const maxHighlightedIndex =
    noneOffset + options.length + (shouldShowCreateAction ? 1 : 0) - 1;
  const clampedHighlightedIndex = Math.min(
    Math.max(0, highlightedIndex),
    Math.max(0, maxHighlightedIndex),
  );
  const showSearch =
    !hideSearch &&
    (alwaysShowSearch ||
      searchQuery.length > 0 ||
      options.length > SEARCH_VISIBILITY_THRESHOLD);

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

  // Auto-select when there is exactly one option and no current value
  useEffect(() => {
    if (autoSelectSingle && !disabled && !value && options.length === 1 && !isLoading) {
      onChange(options[0].id);
    }
  }, [autoSelectSingle, disabled, value, options, isLoading, onChange]);

  const handleSelect = useCallback(
    (option: EntityOption) => {
      onChange(option.id);
      setIsOpen(false);
      setSearchQuery("");
    },
    [onChange]
  );

  const handleSelectNone = () => {
    onChange("");
    setIsOpen(false);
    setSearchQuery("");
  };

  const handleClear = useCallback(
    (e: React.MouseEvent) => {
      e.stopPropagation();
      onChange("");
    },
    [onChange]
  );

  // The empty-state renders a recovery link (`emptyHint.href`) only when the
  // list is genuinely empty (not loading/errored, no active search). While it's
  // showing, Tab must NOT close the dropdown — that would unmount the link before
  // focus could land on it, leaving it keyboard-unreachable.
  const showEmptyStateRecoveryLink =
    !isLoading &&
    !fetchError &&
    options.length === 0 &&
    searchQuery.length === 0 &&
    !!emptyHint?.href;

  const handleKeyDown = (
    e: KeyboardEvent<HTMLInputElement | HTMLButtonElement>,
  ) => {
    const optionCount =
      noneOffset + options.length + (shouldShowCreateAction ? 1 : 0);

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
        if (showNoneOption && clampedHighlightedIndex === 0) {
          handleSelectNone();
        } else if (
          clampedHighlightedIndex === noneOffset + options.length &&
          shouldShowCreateAction &&
          resolvedCreateAction
        ) {
          // Create new option selected
          resolvedCreateAction();
          setIsOpen(false);
          setSearchQuery("");
        } else if (options[clampedHighlightedIndex - noneOffset]) {
          handleSelect(options[clampedHighlightedIndex - noneOffset]);
        }
        break;
      case "Escape":
        if (isOpen) {
          e.preventDefault();
          e.stopPropagation();
          setIsOpen(false);
          setSearchQuery("");
          // Escape may fire from the search input, which unmounts on
          // close — return focus to the trigger so keyboard users are
          // not dropped onto the document body.
          triggerRef.current?.focus();
        }
        break;
      case "Tab":
        // Let Tab move focus to the empty-state recovery link instead of
        // closing (unmounting) the dropdown out from under it.
        if (!showEmptyStateRecoveryLink) {
          setIsOpen(false);
          setSearchQuery("");
        }
        break;
    }
  };

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
          ref={triggerRef}
          onClick={handleToggle}
          onKeyDown={handleKeyDown}
          disabled={disabled}
          role="combobox"
          aria-haspopup="listbox"
          aria-expanded={isOpen}
          aria-controls={listboxId}
          aria-label={placeholder || defaultPlaceholder}
          aria-describedby={triggerDescribedBy}
          aria-invalid={ariaInvalid}
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
              (value && !isSelectionLoading) || (!value && noneOption)
                ? "text-[var(--color-text-primary)]"
                : "text-[var(--color-text-tertiary)]"
            )}
          >
            {displayText ||
              (!value && noneOption
                ? noneOption.label
                : isSelectionLoading
                  ? "Loading selection…"
                  : placeholder || defaultPlaceholder)}
          </span>
          <ChevronDown
            className={cn(
              "size-16 shrink-0 text-[var(--color-text-tertiary)] transition-transform",
              isOpen && "rotate-180"
            )}
          />
        </button>
        {value && !disabled && (
          <Button
            variant="noOutline"
            size="icon"
            onClick={handleClear}
            aria-label="Clear selection"
            data-testid="entity-select-clear"
            className="absolute right-[32px] h-24 w-24 hover:bg-[var(--color-background-medium)] text-[var(--color-text-tertiary)] hover:text-[var(--color-text-primary)]"
          >
            <XIcon className="size-16" />
          </Button>
        )}
      </div>

      {remainingMass && (
        <p
          id={remainingMassId}
          className="body-caption text-[var(--color-text-tertiary)] mt-4"
        >
          {formatRemainingMass(remainingMass, showRemainingDryMass)}
        </p>
      )}

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
                <SearchIcon className="absolute left-12 top-1/2 -translate-y-1/2 size-16 text-[var(--color-text-tertiary)]" />
                <input
                  ref={inputRef}
                  type="text"
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  onKeyDown={handleKeyDown}
                  placeholder={`Search ${ENTITY_TYPE_LABELS[entityType] || entityType}...`}
                  aria-label={`Search ${ENTITY_TYPE_LABELS[entityType] || entityType}`}
                  data-testid="entity-select-search"
                  className="w-full h-[40px] pl-36 pr-12 border border-[var(--color-border-secondary)] bg-[var(--color-background-white)] text-[var(--text-s)] placeholder:text-[var(--color-text-tertiary)] shadow-[inset_0_1px_2px_rgba(0,0,0,0.04)] focus:outline-none focus:border-[var(--color-interaction)] focus:ring-1 focus:ring-[var(--color-interaction)]"
                />
              </div>
            </div>
          )}

          {/* Options list */}
          <ul
            id={listboxId}
            ref={listboxRef}
            role="listbox"
            aria-label={`${ENTITY_TYPE_LABELS[entityType] || entityType} options`}
            data-testid="entity-select-listbox"
            className="max-h-[280px] overflow-y-auto"
          >
            {showNoneOption && noneOption && (
              <li
                role="option"
                aria-selected={!value}
                data-testid="entity-select-none"
                onClick={handleSelectNone}
                onMouseEnter={() => setHighlightedIndex(0)}
                className={cn(
                  "px-12 py-8 cursor-pointer transition-colors border-b border-[var(--color-border-primary)]",
                  clampedHighlightedIndex === 0 &&
                    "bg-[var(--color-background-medium)]",
                  !value && "bg-[var(--color-background-interaction-light)]"
                )}
              >
                <span className="block truncate text-[var(--text-s)] text-[var(--color-text-primary)]">
                  {noneOption.label}
                </span>
                {noneOption.subtitle && (
                  <span className="block body-small text-[var(--color-text-secondary)] mt-2">
                    {noneOption.subtitle}
                  </span>
                )}
              </li>
            )}
            {isLoading ? (
              <li className="flex items-center justify-center gap-2 px-16 py-12 text-[var(--color-text-tertiary)]">
                <SpinnerIcon className="size-16" />
                <span className="text-[var(--text-s)]">Loading...</span>
              </li>
            ) : fetchError ? (
              <li className="px-16 py-12 text-[var(--text-s)] text-[var(--color-signal-red)]">
                Error loading options
              </li>
            ) : options.length === 0 ? (
              // Explain WHY the list is empty and link the upstream fix; a
              // search miss keeps the plain "no match" reading instead.
              emptyHint && searchQuery.length === 0 ? (
                <li className="flex flex-col gap-4 px-16 py-12">
                  <span className="text-[var(--text-s)] text-[var(--color-text-secondary)]">
                    {emptyHint.message}
                  </span>
                  {emptyHint.href && (
                    <a
                      href={emptyHint.href}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="self-start text-[var(--text-s)] font-medium text-[var(--color-interaction)] underline-offset-2 hover:underline"
                    >
                      {emptyHint.linkLabel ?? "Open prerequisite"}
                    </a>
                  )}
                </li>
              ) : null
            ) : (
              options.map((option, index) => (
                <li
                  key={option.id}
                  role="option"
                  aria-selected={option.id === value}
                  data-testid={`entity-option-${option.id}`}
                  onClick={() => handleSelect(option)}
                  onMouseEnter={() => setHighlightedIndex(index + noneOffset)}
                  className={cn(
                    "px-12 py-8 cursor-pointer transition-colors",
                    index + noneOffset === clampedHighlightedIndex &&
                      "bg-[var(--color-background-medium)]",
                    option.id === value &&
                      "bg-[var(--color-background-interaction-light)]"
                  )}
                >
                  <EntityOptionText option={option} />
                </li>
              ))
            )}

            {/* Quick-add option */}
            {shouldShowCreateAction && resolvedCreateAction && (
              <li
                role="option"
                aria-selected={false}
                data-testid="entity-select-create"
                onClick={() => {
                  resolvedCreateAction();
                  setIsOpen(false);
                  setSearchQuery("");
                }}
                onMouseEnter={() =>
                  setHighlightedIndex(noneOffset + options.length)
                }
                className={cn(
                  "flex items-center gap-8 px-12 py-8 cursor-pointer border-t border-[var(--color-border-primary)] text-[var(--color-interaction)] hover:bg-[var(--color-background-medium)] transition-colors",
                  clampedHighlightedIndex === noneOffset + options.length &&
                    "bg-[var(--color-background-medium)]"
                )}
              >
                <PlusIcon className="size-16" />
                <span className="text-[var(--text-s)]">
                  {createLabel || defaultCreateLabel}
                </span>
              </li>
            )}
          </ul>
        </div>
      )}

      <DriverQuickAddDialog
        isOpen={isDriverDialogOpen}
        onClose={() => setIsDriverDialogOpen(false)}
        onSuccess={handleCreatedEntity}
      />
      <OperatorQuickAddDialog
        isOpen={isOperatorDialogOpen}
        onClose={() => setIsOperatorDialogOpen(false)}
        onSuccess={handleCreatedEntity}
      />
      <VehicleQuickAddDialog
        isOpen={isVehicleDialogOpen}
        onClose={() => setIsVehicleDialogOpen(false)}
        onSuccess={handleCreatedEntity}
      />
      <FeedstockTypeQuickAddDialog
        isOpen={isFeedstockTypeDialogOpen}
        onClose={() => setIsFeedstockTypeDialogOpen(false)}
        onSuccess={handleCreatedEntity}
        defaultUsage={getFeedstockTypeDefaultUsage(filterBy)}
      />
      <FormulationQuickAddDialog
        isOpen={isFormulationDialogOpen}
        onClose={() => setIsFormulationDialogOpen(false)}
        onSuccess={handleCreatedEntity}
      />
    </div>
  );
}
