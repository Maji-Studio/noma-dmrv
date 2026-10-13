/**
 * Entity Select Component
 * Searchable dropdown for entity selection with async loading
 */
"use client";

import {
  useState,
  useRef,
  useEffect,
  useEffectEvent,
  useId,
  type KeyboardEvent,
  type FocusEvent,
  type Dispatch,
  type SetStateAction,
} from "react";
import {
  ArrowSquareOutIcon,
  CaretDownIcon,
  MagnifyingGlassIcon,
  SpinnerIcon,
  XIcon,
} from "@phosphor-icons/react/dist/ssr";
import { Popover } from "@base-ui/react/popover";
import dynamic from "next/dynamic";
import { isEditableEntityType, useCanManageFeedstockTypes } from "@/hooks/use-entity-edit-record";
import { ENTITY_SEARCH_LIMIT, SELECT_SEARCH_MIN_OPTIONS } from "@/config/forms";
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

import { EntitySelectRow, type SelectRow } from "./entity-select-row";
export { EntityOptionText } from "./entity-select-row";

const EntityEditDialog = dynamic(() => import("./entity-edit-dialog").then((module) => module.EntityEditDialog));

const MENU_SIDE_OFFSET = 4;
const MENU_COLLISION_PADDING = 8;

function shouldFocusSearch(showSearch: boolean, openedWithTouch: boolean) {
  return showSearch && !openedWithTouch && window.matchMedia("(pointer: fine)").matches;
}

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

interface PickerState {
  isOpen: boolean;
  setIsOpen: Dispatch<SetStateAction<boolean>>;
  searchQuery: string;
  setSearchQuery: Dispatch<SetStateAction<string>>;
}

interface EntityQueryData {
  fetchedOptions: EntityOption[];
  listDataUpdatedAt: number;
  queryLoading: boolean;
  queryError: Error | null;
  selectedEntity: EntityOption | null | undefined;
  detailDataUpdatedAt: number;
  isSelectedEntityPending: boolean;
}

export function EntitySelect(props: EntitySelectProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const pickerState = { isOpen, setIsOpen, searchQuery, setSearchQuery };

  // Separate components keep query hooks unconditional in server mode and
  // let caller-owned lists render without a QueryClientProvider.
  return props.options !== undefined
    ? <EntitySelectView {...props} {...pickerState} />
    : props.entityType === "feedstockType" && props.allowEdit
      ? <FeedstockTypeSelect {...props} {...pickerState} />
      : <ServerEntitySelect {...props} {...pickerState} />;
}

type ServerEntitySelectProps = Extract<EntitySelectProps, { options?: undefined }> & PickerState;

function FeedstockTypeSelect(props: ServerEntitySelectProps) {
  const canManage = useCanManageFeedstockTypes();
  return <ServerEntitySelect {...props} allowEdit={canManage} onEditSelected={canManage ? props.onEditSelected : undefined} />;
}

function ServerEntitySelect(props: ServerEntitySelectProps) {
  const { entityType, filterBy, disabled, selectionLocked, isOpen, autoSelectSingle, value, searchQuery } = props;
  const [isEditOpen, setIsEditOpen] = useState(false);
  const onEditSelected = props.onEditSelected ?? (props.allowEdit && isEditableEntityType(entityType) ? () => setIsEditOpen(true) : undefined);
  const debouncedSearch = useDebounce(searchQuery, 200);
  const {
    data: fetchedOptions = [],
    dataUpdatedAt: listDataUpdatedAt,
    isLoading: queryLoading,
    error: queryError,
  } = useEntityOptions({
    entityType,
    search: debouncedSearch,
    filterBy,
    enabled: !disabled && !selectionLocked && (isOpen || (!!autoSelectSingle && !value)),
  });
  // Stock derivation filters must match between list and detail queries.
  const detailFilterBy = filterBy?.excludeOrderId
    ? { excludeOrderId: filterBy.excludeOrderId }
    : undefined;
  const {
    data: selectedEntity,
    dataUpdatedAt: detailDataUpdatedAt,
    isPending: isSelectedEntityPending,
  } = useEntityById(entityType, value, detailFilterBy);

  return (
    <>
      <EntitySelectView
        {...props}
        onEditSelected={onEditSelected}
        queryData={{
          fetchedOptions,
          listDataUpdatedAt,
          queryLoading,
          queryError,
          selectedEntity,
          detailDataUpdatedAt,
          isSelectedEntityPending,
        }}
      />
      {isEditOpen && isEditableEntityType(entityType) && (
        <EntityEditDialog entityType={entityType} entityId={value} isOpen={isEditOpen} onClose={() => setIsEditOpen(false)} />
      )}
    </>
  );
}

function EntitySelectView({
  id,
  entityType,
  options: suppliedOptions,
  optionLabel,
  isLoading: suppliedLoading = false,
  value,
  selectedLabel,
  onChange,
  onBlur,
  placeholder,
  disabled = false,
  selectionLocked = false,
  error = false,
  loadError,
  className,
  allowCreate = false,
  createLabel,
  onCreateNew,
  filterBy,
  dependsOn,
  excludeIds,
  autoSelectSingle = false,
  alwaysShowSearch = false,
  hideSearch = false,
  showRemainingMass = true,
  showRemainingDryMass = true,
  formatSelectedLabel,
  emptyHint,
  noneOption,
  onEditSelected,
  editLabel,
  "aria-describedby": ariaDescribedBy,
  "aria-invalid": ariaInvalid,
  isOpen,
  setIsOpen,
  searchQuery,
  setSearchQuery,
  queryData,
}: EntitySelectProps & PickerState & { queryData?: EntityQueryData }) {
  const [highlightedId, setHighlightedId] = useState<string | null>(null);
  const [isDriverDialogOpen, setIsDriverDialogOpen] = useState(false);
  const [isOperatorDialogOpen, setIsOperatorDialogOpen] = useState(false);
  const [isVehicleDialogOpen, setIsVehicleDialogOpen] = useState(false);
  const [isFeedstockTypeDialogOpen, setIsFeedstockTypeDialogOpen] = useState(false);
  const [isFormulationDialogOpen, setIsFormulationDialogOpen] = useState(false);
  const isQuickAddDialogOpen = isDriverDialogOpen || isOperatorDialogOpen ||
    isVehicleDialogOpen || isFeedstockTypeDialogOpen || isFormulationDialogOpen;

  const containerRef = useRef<HTMLDivElement>(null);
  const popupRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const recoveryLinkRef = useRef<HTMLAnchorElement>(null);
  const openedWithTouch = useRef(false);
  const blurNotified = useRef(false);
  const userClearedSource = useRef<string | null>(null);
  const optionsSource = JSON.stringify([
    entityType,
    dependsOn,
    Object.entries(filterBy ?? {}).sort(([a], [b]) => a.localeCompare(b)),
  ]);
  const entitySelectId = useId();
  const listboxId = `${entitySelectId}-listbox`;
  const remainingMassId = `${entitySelectId}-remaining-mass`;
  const selectedLabelId = `${entitySelectId}-selected`;

  const {
    fetchedOptions = [],
    listDataUpdatedAt = 0,
    queryLoading = false,
    queryError = null,
    selectedEntity,
    detailDataUpdatedAt = 0,
    isSelectedEntityPending = false,
  } = queryData ?? {};

  const isLocal = suppliedOptions !== undefined;
  const isLoading = isLocal ? suppliedLoading : queryLoading;
  const fetchError = isLocal ? (loadError ?? null) : queryError;
  const entityLabel = optionLabel ?? (entityType ? ENTITY_TYPE_LABELS[entityType] : "option");
  const sourceOptions = suppliedOptions ?? fetchedOptions;
  const normalizedSearch = searchQuery.trim().toLowerCase();
  const searchedOptions = isLocal && normalizedSearch
    ? sourceOptions.filter((option) =>
        [option.name, option.code, option.subtitle].some((text) => text?.toLowerCase().includes(normalizedSearch)))
    : sourceOptions;
  const showMoreResults = !isLocal && !isLoading && !fetchError && fetchedOptions.length >= ENTITY_SEARCH_LIMIT;

  // Hide already-picked options (e.g. blend materials chosen on other lines),
  // but never hide the current selection so it stays visible in its own field.
  const options =
    excludeIds && excludeIds.length > 0
      ? searchedOptions.filter(
          (option) => option.id === value || !excludeIds.includes(option.id)
        )
      : searchedOptions;

  const listedOption = options.find((option) => option.id === value);
  const selectedOption =
    isLocal ? suppliedOptions.find((option) => option.id === value)
      : selectedEntity?.id === value ? selectedEntity : listedOption;
  const displayText = selectedOption
    ? (formatSelectedLabel ? formatSelectedLabel(selectedOption) : selectedOption.name)
    : isLocal && value ? selectedLabel || value : "";
  // Identity remains detail-first, but stock is derived data: use whichever
  // query most recently succeeded. dataUpdatedAt intentionally survives a
  // failed refetch, so retained detail data cannot mask a fresher list result.
  const remainingMass = showRemainingMass
    ? selectFreshRemainingMass({
        listedOption,
        listDataUpdatedAt,
        selectedEntity: isLocal ? selectedOption : selectedEntity,
        detailDataUpdatedAt,
        value,
      })
    : undefined;
  // The trigger's aria-label names the field, which hides its content from
  // the accessible name. The selected label can carry the stock change
  // ("(−100 kg wet)"), so it is announced as the first description instead.
  const triggerDescribedBy = [
    ariaDescribedBy,
    displayText ? selectedLabelId : undefined,
    remainingMass ? remainingMassId : undefined,
  ]
    .filter(Boolean)
    .join(" ") || undefined;
  // Only while the by-ID fetch is unresolved — once it settles without a
  // match (deleted or inaccessible entity) the ordinary placeholder returns.
  const isSelectionLoading = Boolean(
    !isLocal && value && !selectedOption && isSelectedEntityPending,
  );

  const isInsidePicker = (target: EventTarget | null) => target instanceof Node && (
    containerRef.current?.contains(target) || popupRef.current?.contains(target)
  );
  const notifyBlur = () => {
    if (blurNotified.current) return;
    blurNotified.current = true;
    onBlur?.();
  };
  const closeMenu = (dismissed = false) => {
    if (isOpen && (dismissed || !isInsidePicker(document.activeElement))) notifyBlur();
    setIsOpen(false);
    setSearchQuery("");
    setHighlightedId(null);
  };
  const handlePickerBlur = (event: FocusEvent<HTMLElement>) => {
    // Opening quick-add moves focus outside the picker without touching it.
    if (isQuickAddDialogOpen || isInsidePicker(event.relatedTarget)) return;
    // A pointer press on a non-focusable row can blur to the body before
    // its click selects the value. Let selection or dismissal finish first.
    if (isOpen && !event.relatedTarget) return;
    notifyBlur();
    closeMenu();
  };
  const handleCreatedEntity = (entity: EntityOption) => {
    onChange(entity.id);
    closeMenu();
  };
  const createActions = {
    driver: () => setIsDriverDialogOpen(true),
    operator: () => setIsOperatorDialogOpen(true),
    vehicle: () => setIsVehicleDialogOpen(true),
    feedstockType: () => setIsFeedstockTypeDialogOpen(true),
    formulation: () => setIsFormulationDialogOpen(true),
  };
  const defaultCreateAction = isLocal ? undefined : createActions[entityType as keyof typeof createActions];

  const resolvedCreateAction = onCreateNew ?? defaultCreateAction;
  const hasCreateAction = Boolean(resolvedCreateAction);
  const shouldShowCreateAction = shouldRenderCreateAction({
    allowCreate,
    hasCreateAction,
    isLoading,
    hasFetchError: Boolean(fetchError),
    optionCount: options.length,
  });

  const canEdit = Boolean(value && selectedOption && onEditSelected);
  const triggerDisabled = disabled || (selectionLocked && !canEdit);
  const rows: SelectRow[] = [];
  if (!disabled && !selectionLocked) {
    if (noneOption && !searchQuery) {
      rows.push({ id: `${entitySelectId}-none`, kind: "none" });
    }
    if (!isLoading && !fetchError) {
      rows.push(...options.map((option): SelectRow => ({
        id: `${entitySelectId}-option-${option.id}`,
        kind: "option",
        option,
      })));
    }
  }
  if (canEdit) rows.push({ id: `${entitySelectId}-edit`, kind: "edit" });
  if (!disabled && !selectionLocked && shouldShowCreateAction) {
    rows.push({ id: `${entitySelectId}-create`, kind: "create" });
  }
  const selectableRows = rows.filter((row) => row.kind !== "option" || !row.option.disabled);
  // Without an explicit highlight, Enter picks the first entity (or None),
  // never Edit or Add new; a locked picker only has its Edit row.
  const activeRow = selectableRows.find((row) => row.id === highlightedId)
    ?? selectableRows.find((row) => row.kind === "option" || row.kind === "none")
    ?? (selectionLocked ? selectableRows[0] : undefined);
  const activeId = isOpen ? activeRow?.id : undefined;
  const showSearch = !disabled && !selectionLocked && !hideSearch &&
    (alwaysShowSearch || searchQuery.length > 0 || showMoreResults || options.length > SELECT_SEARCH_MIN_OPTIONS);

  const closeMenuFromEffect = useEffectEvent(closeMenu);

  // Portalled content counts as inside the picker for pointer dismissal.
  useEffect(() => {
    function handlePointerDown(event: PointerEvent) {
      if (!containerRef.current?.contains(event.target as Node) &&
          !popupRef.current?.contains(event.target as Node)) {
        closeMenuFromEffect(true);
      }
    }
    document.addEventListener("pointerdown", handlePointerDown);
    return () => document.removeEventListener("pointerdown", handlePointerDown);
  }, []);

  useEffect(() => {
    if (isOpen && shouldFocusSearch(showSearch, openedWithTouch.current)) {
      inputRef.current?.focus();
    }
  }, [isOpen, showSearch]);

  // Auto-select when there is exactly one option and no current value
  useEffect(() => {
    if (userClearedSource.current !== optionsSource) userClearedSource.current = null;
    if (autoSelectSingle && userClearedSource.current === null && !disabled && !selectionLocked && !value && options.length === 1 && !options[0].disabled && !isLoading && !fetchError && !searchQuery) {
      onChange(options[0].id);
    }
  }, [autoSelectSingle, disabled, selectionLocked, value, options, isLoading, fetchError, searchQuery, onChange, optionsSource]);

  const activateRow = (row: SelectRow) => {
    if (row.kind === "option" && row.option.disabled) return;
    triggerRef.current?.focus();
    closeMenu();
    switch (row.kind) {
      case "none":
        userClearedSource.current = optionsSource;
        onChange("");
        break;
      case "option":
        onChange(row.option.id);
        break;
      case "edit":
        onEditSelected?.();
        break;
      case "create":
        resolvedCreateAction?.();
        break;
    }
  };
  const handleClear = (event: React.MouseEvent) => {
    event.stopPropagation();
    userClearedSource.current = optionsSource;
    triggerRef.current?.focus();
    onChange("");
  };

  // The empty-state renders a recovery link (`emptyHint.href`) only when the
  // list is genuinely empty (not loading/errored, no active search). While it's
  // showing, forward Tab explicitly enters the portal before the next form field.
  const showEmptyStateRecoveryLink =
    !disabled && !selectionLocked &&
    !isLoading &&
    !fetchError &&
    options.length === 0 &&
    searchQuery.length === 0 &&
    !!emptyHint?.href;

  const handleKeyDown = (
    e: KeyboardEvent<HTMLInputElement | HTMLButtonElement | HTMLAnchorElement>,
  ) => {
    if (triggerDisabled) return;
    if (!isOpen) {
      if (["ArrowDown", "ArrowUp", "Enter", " "].includes(e.key)) {
        e.preventDefault();
        openedWithTouch.current = false;
        blurNotified.current = false;
        setIsOpen(true);
        setHighlightedId(e.key === "ArrowUp" ? selectableRows.at(-1)?.id ?? null : null);
      }
      return;
    }
    const index = selectableRows.findIndex((row) => row.id === activeRow?.id);
    switch (e.key) {
      case "ArrowDown":
      case "ArrowUp":
      case "Home":
      case "End": {
        if ((e.key === "Home" || e.key === "End") && e.currentTarget === inputRef.current) break;
        e.preventDefault();
        const next = e.key === "Home" ? 0 : e.key === "End" ? selectableRows.length - 1
          : Math.max(0, Math.min(selectableRows.length - 1, index + (e.key === "ArrowDown" ? 1 : -1)));
        setHighlightedId(selectableRows[next]?.id ?? null);
        break;
      }
      case "Enter":
        e.preventDefault();
        if (activeRow) activateRow(activeRow);
        break;
      case "Escape":
        if (isOpen) {
          e.preventDefault();
          e.stopPropagation();
          // Escape may fire from the search input, which unmounts on
          // close — return focus to the trigger so keyboard users are
          // not dropped onto the document body.
          triggerRef.current?.focus();
          closeMenu(true);
        }
        break;
      case "Tab":
        if (popupRef.current?.contains(e.currentTarget)) {
          e.preventDefault();
          closeMenu();
          triggerRef.current?.focus();
        } else if (showEmptyStateRecoveryLink && !e.shiftKey) {
          e.preventDefault();
          recoveryLinkRef.current?.focus();
        } else closeMenu();
        break;
    }
  };

  const handleToggle = () => {
    if (isOpen) closeMenu(true);
    else if (!triggerDisabled) {
      blurNotified.current = false;
      setIsOpen(true);
    }
  };

  const defaultPlaceholder = `Select ${entityLabel}...`;
  const defaultCreateLabel = `Add new ${entityLabel}`;

  return (
    <Popover.Root open={isOpen} onOpenChange={(open) => { if (!open) closeMenu(true); }}>
      <div
        ref={containerRef}
        className={cn("relative", className)}
        onFocus={(event) => { if (!isInsidePicker(event.relatedTarget)) blurNotified.current = false; }}
        onBlur={handlePickerBlur}
      >
        {/* Trigger */}
        <div className="relative flex items-center">
          <button
            type="button"
            ref={triggerRef}
            id={id}
            onClick={handleToggle}
            onPointerDown={(event) => { openedWithTouch.current = event.pointerType === "touch"; }}
            onKeyDown={handleKeyDown}
            disabled={triggerDisabled}
            role="combobox"
            aria-readonly={selectionLocked || undefined}
            aria-haspopup="listbox"
            aria-expanded={isOpen}
            aria-controls={listboxId}
            aria-activedescendant={activeId}
            // A wrapping FormField passes its id so its <label htmlFor> names the
            // trigger; without one the placeholder is the only name available.
            aria-label={id ? undefined : placeholder || defaultPlaceholder}
            aria-describedby={triggerDescribedBy}
            aria-invalid={ariaInvalid}
            data-testid="entity-select-trigger"
            className={cn(
              "flex h-40 w-full items-center justify-between gap-2 border bg-[var(--color-background-white)] px-12 text-[var(--text-s)] transition-all",
              "focus-visible:outline-none focus-visible:border-[var(--color-interaction)] focus-visible:ring-1 focus-visible:ring-[var(--color-interaction)]",
              error
                ? "border-[var(--color-signal-red)]"
                : "border-[var(--color-border-secondary)]",
              triggerDisabled
                ? "cursor-not-allowed opacity-50"
                : selectionLocked
                  ? "cursor-pointer opacity-50"
                  : "cursor-pointer hover:border-[var(--color-interaction)]",
              value && !disabled && !selectionLocked ? "pr-[72px]" : "pr-[40px]"
            )}
          >
            <span
              id={selectedLabelId}
              className={cn(
                "min-w-0 flex-1 truncate text-left",
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
            <CaretDownIcon
              aria-hidden
              weight="bold"
              className={cn(
                "size-16 shrink-0 text-[var(--color-text-tertiary)] transition-transform",
                isOpen && "rotate-180"
              )}
            />
          </button>
          {value && !disabled && !selectionLocked && (
            <Button
              variant="noOutline"
              size="icon"
              onClick={handleClear}
              aria-label="Clear selection"
              data-testid="entity-select-clear"
              className="absolute right-20 h-44 w-44 hover:bg-[var(--color-background-medium)] text-[var(--color-text-tertiary)] hover:text-[var(--color-text-primary)]"
            >
              <XIcon aria-hidden weight="bold" className="size-16" />
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
          <Popover.Portal>
            <Popover.Positioner
              anchor={triggerRef}
              sideOffset={MENU_SIDE_OFFSET}
              collisionPadding={MENU_COLLISION_PADDING}
              className="z-[var(--z-layer-popover)] w-[var(--anchor-width)]"
            >
              <Popover.Popup
                ref={popupRef}
                initialFocus={() => shouldFocusSearch(showSearch, openedWithTouch.current) ? inputRef.current : false}
                finalFocus={false}
                role="presentation"
                className="flex max-h-[var(--available-height)] flex-col overflow-hidden bg-[var(--paper)] [border:var(--hair)]"
              >
                {/* Search input */}
                {showSearch && (
                  <div className="shrink-0 p-8">
                    <div className="relative">
                      <MagnifyingGlassIcon aria-hidden weight="bold" className="absolute left-12 top-1/2 -translate-y-1/2 size-16 text-[var(--color-text-tertiary)]" />
                      <input
                        ref={inputRef}
                        role="combobox"
                        aria-expanded={isOpen}
                        aria-controls={listboxId}
                        aria-activedescendant={activeId}
                        type="text"
                        value={searchQuery}
                        onChange={(e) => {
                          setSearchQuery(e.target.value);
                          setHighlightedId(null);
                        }}
                        onKeyDown={handleKeyDown}
                        placeholder={`Search ${entityLabel}...`}
                        aria-label={`Search ${entityLabel}`}
                        data-testid="entity-select-search"
                        className="w-full h-[40px] pl-36 pr-12 border border-[var(--color-border-secondary)] bg-[var(--color-background-white)] text-[var(--text-s)] placeholder:text-[var(--color-text-tertiary)] focus:outline-none focus:border-[var(--color-interaction)] focus:ring-1 focus:ring-[var(--color-interaction)]"
                      />
                    </div>
                  </div>
                )}

                {/* Options list */}
                <ul
                  id={listboxId}
                  role="listbox"
                  aria-label={`${entityLabel} options`}
                  data-testid="entity-select-listbox"
                  className="min-h-0 overflow-y-auto"
                >
                  {!disabled && !selectionLocked && (isLoading ? (
                    <li className="flex items-center justify-center gap-2 px-16 py-12 text-[var(--color-text-tertiary)]">
                      <SpinnerIcon aria-hidden weight="bold" className="size-16 animate-spin" />
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
                      <li role="presentation" data-testid="entity-select-empty">
                        <p className="px-12 py-10 body-small text-[var(--color-text-tertiary)]">
                          {emptyHint.message}
                        </p>
                        {/*
                          The fix reads as a row, not an inline link: full-width, its
                          own hover background, and a 44px hit target, so it is reachable the
                          same way an option is.
                        */}
                        {emptyHint.href && (
                          <a
                            ref={recoveryLinkRef}
                            href={emptyHint.href}
                            target="_blank"
                            rel="noopener noreferrer"
                            onKeyDown={(event) => {
                              if (event.key === "Tab" || event.key === "Escape") handleKeyDown(event);
                            }}
                            className="flex min-h-44 w-full items-center gap-8 px-12 py-8 body-small font-medium text-[var(--color-interaction)] transition-colors hover:bg-[var(--color-background-medium)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-[var(--color-interaction)]"
                          >
                            <ArrowSquareOutIcon aria-hidden size={16} weight="bold" />
                            {emptyHint.linkLabel ?? "Open prerequisite"}
                          </a>
                        )}
                      </li>
                    ) : (
                      <li role="presentation" data-testid="entity-select-empty" className="px-16 py-12 text-[var(--text-s)] text-[var(--color-text-tertiary)]">
                        {searchQuery.length > 0 ? "No matches. Change or clear your search." : `No matching ${entityLabel} records.`}
                      </li>
                    )
                  ) : null)}
                  {rows.map((row) => (
                    <EntitySelectRow
                      key={row.id}
                      row={row}
                      active={activeId === row.id}
                      value={value}
                      noneOption={noneOption}
                      editLabel={editLabel ?? `Edit ${selectedOption?.name}`}
                      createLabel={createLabel || defaultCreateLabel}
                      onActivate={() => activateRow(row)}
                      onHighlight={() => setHighlightedId(row.id)}
                    />
                  ))}
                  {!disabled && !selectionLocked && showMoreResults && (
                    <li role="presentation" data-testid="entity-select-more-results" className="px-12 py-8 body-caption text-[var(--color-text-tertiary)]">
                      More results may be available. Refine your search.
                    </li>
                  )}
                </ul>
              </Popover.Popup>
            </Popover.Positioner>
          </Popover.Portal>
        )}
      </div>
      {!isLocal && (
        <>
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
        </>
      )}
    </Popover.Root>
  );
}
