/**
 * Entity Select Component
 * Searchable dropdown for entity selection with async loading
 */
"use client";

import {
  useState,
  useRef,
  useEffect,
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
import { Combobox } from "@base-ui/react/combobox";
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
// TypeScript's DOM lib does not declare focusVisible yet; browsers without it ignore it.
const POINTER_FOCUS: FocusOptions & { focusVisible?: boolean } = { focusVisible: false };

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
  const [isDriverDialogOpen, setIsDriverDialogOpen] = useState(false);
  const [isOperatorDialogOpen, setIsOperatorDialogOpen] = useState(false);
  const [isVehicleDialogOpen, setIsVehicleDialogOpen] = useState(false);
  const [isFeedstockTypeDialogOpen, setIsFeedstockTypeDialogOpen] = useState(false);
  const [isFormulationDialogOpen, setIsFormulationDialogOpen] = useState(false);
  const isQuickAddDialogOpen = isDriverDialogOpen || isOperatorDialogOpen ||
    isVehicleDialogOpen || isFeedstockTypeDialogOpen || isFormulationDialogOpen;

  const containerRef = useRef<HTMLDivElement>(null);
  const [listElement, setListElement] = useState<HTMLDivElement | null>(null);
  const [explicitActionHighlight, setExplicitActionHighlight] = useState(false);
  const openingNavigationKey = useRef("Home");
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
    setExplicitActionHighlight(false);
    openingNavigationKey.current = "Home";
    triggerRef.current?.removeAttribute("aria-activedescendant");
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
  const showSearch = !disabled && !selectionLocked && !hideSearch &&
    (alwaysShowSearch || searchQuery.length > 0 || showMoreResults || options.length > SELECT_SEARCH_MIN_OPTIONS);

  const navigableRows = rows.filter((row) => row.kind !== "option" || !row.option.disabled);
  const defaultRow = rows.find((row) => row.kind === "none" || (row.kind === "option" && !row.option.disabled))
    ?? (selectionLocked ? rows[0] : undefined);
  const defaultRowId = defaultRow?.id;
  // Initialize Base UI's navigation at the first selectable row, preserving the
  // picker's Enter default even when opening by pointer or receiving async data.
  useEffect(() => {
    if (isOpen && listElement && (defaultRowId || openingNavigationKey.current === "End")) {
      const navigationKey = openingNavigationKey.current;
      let cancelled = false;
      const initialize = () => {
        if (!cancelled && listElement.isConnected) listElement.dispatchEvent(new window.KeyboardEvent("keydown", { key: navigationKey, bubbles: true }));
      };
      initialize();
      // Base UI 1.1.0 floating-ui-react/hooks/useListNavigation.js restores selectedIndex on open; repeat Home after mount.
      queueMicrotask(() => {
        initialize();
        if (!cancelled) openingNavigationKey.current = "Home";
      });
      return () => { cancelled = true; };
    }
  }, [isOpen, defaultRowId, listElement]);

  // Auto-select when there is exactly one option and no current value
  useEffect(() => {
    if (userClearedSource.current !== optionsSource) userClearedSource.current = null;
    if (autoSelectSingle && userClearedSource.current === null && !disabled && !selectionLocked && !value && options.length === 1 && !options[0].disabled && !isLoading && !fetchError && !searchQuery) {
      onChange(options[0].id);
    }
  }, [autoSelectSingle, disabled, selectionLocked, value, options, isLoading, fetchError, searchQuery, onChange, optionsSource]);

  const activateRow = (row: SelectRow, byPointer = false) => {
    if (row.kind === "option" && row.option.disabled) return;
    // Base UI items cancel pointerdown, so a pointer pick never moves focus and
    // the trigger would keep or inherit a keyboard focus ring. Drop focus as a
    // press on a non-focusable row did, and return it without the ring.
    if (byPointer && document.activeElement instanceof HTMLElement) document.activeElement.blur();
    triggerRef.current?.focus(byPointer ? POINTER_FOCUS : undefined);
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
    e: KeyboardEvent<HTMLElement> & { preventBaseUIHandler?: () => void },
  ) => {
    if (triggerDisabled) return;
    if (!isOpen) return;
    switch (e.key) {
      case "Home":
      case "End":
        // Preserve the native-caret contract test: Home/End must leave the input event uncanceled.
        if (e.currentTarget === inputRef.current) e.preventBaseUIHandler?.();
        break;
      case "Escape":
        e.preventDefault();
        e.stopPropagation();
        e.preventBaseUIHandler?.();
        triggerRef.current?.focus();
        closeMenu(true);
        break;
      case "Enter": {
        const highlighted = listElement?.querySelector("[data-highlighted]");
        if (highlighted?.getAttribute("role") === "button" && !explicitActionHighlight && !selectionLocked) {
          e.preventDefault();
          e.preventBaseUIHandler?.();
        } else if (!highlighted) {
          e.preventDefault();
          e.preventBaseUIHandler?.();
          if (defaultRow) activateRow(defaultRow);
        }
        break;
      }
      case "Tab":
        e.preventBaseUIHandler?.();
        if (popupRef.current?.contains(e.currentTarget)) {
          e.preventDefault();
          triggerRef.current?.focus();
          closeMenu();
        } else if (showEmptyStateRecoveryLink && !e.shiftKey) {
          e.preventDefault();
          recoveryLinkRef.current?.focus();
        } else closeMenu();
        break;
    }
  };

  const defaultPlaceholder = `Select ${entityLabel}...`;
  const defaultCreateLabel = `Add new ${entityLabel}`;

  return (
    <Combobox.Root<SelectRow>
      open={isOpen}
      onOpenChange={(open, details) => {
        if (!open && details.isCanceled) return;
        // Clear and the stock caption are siblings of Trigger, but still
        // belong to this field for pointer dismissal and touched validation.
        if (!open && details.reason === "outside-press" && isInsidePicker(details.event.target)) {
          details.cancel();
          return;
        }
        if (open) {
          blurNotified.current = false;
          setIsOpen(true);
        } else {
          if (details.reason === "escape-key") triggerRef.current?.focus();
          closeMenu(details.reason !== "item-press");
        }
      }}
      id={entitySelectId}
      items={navigableRows}
      value={rows.find((row) => row.kind === "option" && row.option.id === value) ?? null}
      isItemEqualToValue={(item, selected) => item.id === selected.id}
      itemToStringValue={(row) => row.kind === "option" ? row.option.id : ""}
      itemToStringLabel={(row) => row.kind === "option" ? row.option.name : row.kind === "none" ? noneOption?.label ?? "" : ""}
      onValueChange={(row, details) => {
        // Action rows participate in navigation, but never become a field value.
        details.cancel();
        if (details.reason !== "item-press") return;
        if (row && (row.kind === "option" || row.kind === "none" || selectionLocked || details.event.type !== "keydown" || explicitActionHighlight)) activateRow(row, details.event.type !== "keydown");
      }}
      onItemHighlighted={(_, details) => {
        // This Base UI version exposes the active descendant on Input and List,
        // but not Trigger, where touch and searchless pickers retain focus.
        // Highlight notification precedes the DOM update, so read the indexed
        // navigable item's real id rather than the previous data-highlighted row.
        const highlightedId = listElement?.querySelectorAll('[role="option"]:not([aria-disabled="true"]), [role="button"]')[details.index]?.id;
        if (highlightedId) triggerRef.current?.setAttribute("aria-activedescendant", highlightedId);
        else triggerRef.current?.removeAttribute("aria-activedescendant");
        setExplicitActionHighlight(details.reason === "keyboard" || details.reason === "pointer");
      }}
      inputValue={searchQuery}
      onInputValueChange={(query, details) => {
        if (details.reason === "input-change") {
          setExplicitActionHighlight(false);
          setSearchQuery(query);
        }
      }}
      filter={null}
      autoHighlight={Boolean(defaultRow)}
      loopFocus={false}
      disabled={triggerDisabled}
    >
      <div
        ref={containerRef}
        className={cn("relative", className)}
        onFocus={(event) => { if (!isInsidePicker(event.relatedTarget)) blurNotified.current = false; }}
        onBlur={handlePickerBlur}
      >
        {/* Trigger */}
        <div className="relative flex items-center">
          <Combobox.Trigger
            type="button"
            ref={triggerRef}
            id={id}
            onPointerDown={(event) => { openedWithTouch.current = event.pointerType === "touch"; }}
            onKeyDown={(event) => {
              if (!isOpen) {
                openedWithTouch.current = false;
                openingNavigationKey.current = event.key === "ArrowUp" ? "End" : "Home";
              }
              handleKeyDown(event);
              // Base UI 1.1.0 combobox/root/AriaCombobox.js wires navigation to Input/List, not Trigger.
              if (isOpen && !event.defaultPrevented && ["ArrowDown", "ArrowUp", "Home", "End", "Enter"].includes(event.key)) {
                event.preventDefault();
                listElement?.dispatchEvent(new window.KeyboardEvent("keydown", { key: event.key, bubbles: true, cancelable: true }));
              }
            }}
            disabled={triggerDisabled}
            role="combobox"
            aria-readonly={selectionLocked || undefined}
            aria-haspopup="listbox"
            aria-expanded={isOpen}
            aria-controls={listboxId}
            // A wrapping FormField passes its id so its <label htmlFor> names the
            // trigger; without one the placeholder is the only name available.
            aria-label={id ? undefined : placeholder || defaultPlaceholder}
            aria-describedby={triggerDescribedBy}
            aria-invalid={ariaInvalid}
            data-testid="entity-select-trigger"
            data-has-value={Boolean(value)}
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
              value && !disabled && !selectionLocked ? "pr-72" : "pr-36"
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
              <Combobox.Value>
                {displayText ||
                  (!value && noneOption
                    ? noneOption.label
                    : isSelectionLoading
                      ? "Loading selection…"
                      : placeholder || defaultPlaceholder)}
              </Combobox.Value>
            </span>
            <CaretDownIcon
              aria-hidden
              data-trailing-icon=""
              weight="bold"
              className={cn(
                "pointer-events-none absolute right-12 size-16 shrink-0 text-[var(--color-text-tertiary)] transition-transform",
                isOpen && "rotate-180"
              )}
            />
          </Combobox.Trigger>
          {value && !disabled && !selectionLocked && (
            <Button
              variant="noOutline"
              size="icon"
              onClick={handleClear}
              aria-label="Clear selection"
              data-testid="entity-select-clear"
              // The hit area ends where the chevron starts; align the X toward
              // that edge with an 8px gap, keeping all 44px clickable.
              className="absolute right-28 h-44 w-44 justify-end pr-8 hover:bg-[var(--color-background-medium)] text-[var(--color-text-tertiary)] hover:text-[var(--color-text-primary)]"
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
          <Combobox.Portal>
            <Combobox.Positioner
              anchor={triggerRef}
              sideOffset={MENU_SIDE_OFFSET}
              collisionPadding={MENU_COLLISION_PADDING}
              className="z-[var(--z-layer-popover)] w-[var(--anchor-width)]"
            >
              <Combobox.Popup
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
                      <Combobox.Input
                        ref={inputRef}
                        role="combobox"
                        aria-expanded={isOpen}
                        aria-controls={listboxId}
                        type="text"
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
                <Combobox.List
                  render={<ul />}
                  ref={setListElement}
                  onKeyDown={handleKeyDown}
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
                              if (event.key === "Enter") event.stopPropagation();
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
                      highlightActions={explicitActionHighlight || selectionLocked}
                      value={value}
                      noneOption={noneOption}
                      editLabel={editLabel ?? `Edit ${selectedOption?.name}`}
                      createLabel={createLabel || defaultCreateLabel}
                    />
                  ))}
                  {!disabled && !selectionLocked && showMoreResults && (
                    <li role="presentation" data-testid="entity-select-more-results" className="px-12 py-8 body-caption text-[var(--color-text-tertiary)]">
                      More results may be available. Refine your search.
                    </li>
                  )}
                </Combobox.List>
              </Combobox.Popup>
            </Combobox.Positioner>
          </Combobox.Portal>
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
    </Combobox.Root>
  );
}
