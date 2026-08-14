"use client";

import * as React from "react";
import {
  flexRender,
  getCoreRowModel,
  getFilteredRowModel,
  getPaginationRowModel,
  getSortedRowModel,
  useReactTable,
  type ColumnDef,
  type ColumnFiltersState,
  type PaginationState,
  type RowSelectionState,
  type SortingState,
  type Table as TanStackTable,
  type VisibilityState,
} from "@tanstack/react-table";
import {
  CaretUpIcon,
  CaretDownIcon,
  MagnifyingGlassIcon,
  CheckIcon,
  XIcon,
} from "@phosphor-icons/react/dist/ssr";
import { cn } from "@/lib/utils";
import { pluralize } from "@/lib/copy-utils";
import { cva, type VariantProps } from "class-variance-authority";
import { Button } from "@/components/ui/button";
import { TableRowSkeleton } from "@/components/ui/loading-skeleton";
import { ListPagination } from "@/components/ui/list-pagination";
import {
  DEFAULT_LIST_PAGE_SIZE,
  LIST_PAGE_SIZE_OPTIONS,
} from "@/config/list-controls";

/* ------------------------------------------------------------------ */
/*  Data Table Context                                                  */
/* ------------------------------------------------------------------ */

interface DataTableContextValue<TData> {
  table: TanStackTable<TData>;
}

const DataTableContext = React.createContext<DataTableContextValue<unknown> | null>(null);

function useDataTable<TData>() {
  const context = React.useContext(DataTableContext) as DataTableContextValue<TData> | null;
  if (!context) {
    throw new Error("useDataTable must be used within a DataTable");
  }
  return context;
}

/* ------------------------------------------------------------------ */
/*  Table Variants (CVA)                                                */
/* ------------------------------------------------------------------ */

const tableVariants = cva(
  "w-full border-collapse",
  {
    variants: {
      variant: {
        default: "",
        bordered: "[border:var(--panel-border)]",
      },
      size: {
        default: "",
        compact: "[&_th]:py-6 [&_th]:px-8 [&_td]:py-4 [&_td]:px-8",
        comfortable: "[&_th]:py-16 [&_th]:px-16 [&_td]:py-12 [&_td]:px-16",
      },
    },
    defaultVariants: {
      variant: "bordered",
      size: "default",
    },
  }
);

const tableRowVariants = cva(
  // 1px 10%-plum divider between rows (--hair-3 weight); the panel frame
  // closes the bottom, so the last row drops its divider.
  "[border-bottom:var(--row-divider)] last:[border-bottom:none] align-middle transition-colors",
  {
    variants: {
      striped: {
        true: "even:bg-[var(--row-stripe-bg)]",
        false: "",
      },
      hoverable: {
        true: "hover:bg-[var(--row-hover-bg)]",
        false: "",
      },
      selected: {
        true: "bg-[var(--color-interaction)]/10",
        false: "",
      },
    },
    defaultVariants: {
      striped: false,
      hoverable: false,
      selected: false,
    },
  }
);

const MAX_LOADING_ROWS = 5;

/**
 * Derive a human-readable label for a column, used by the mobile card view
 * where each cell is shown as a label/value pair. Prefers a string `header`;
 * falls back to a humanized column id. Returns "" for structural columns
 * (selection / actions) so their cell renders without a label.
 */
function columnLabel(column: { id: string; columnDef: { header?: unknown } }): string {
  const header = column.columnDef.header;
  if (column.id === "select" || column.id === "actions") return "";
  if (typeof header === "string") return header;
  return column.id
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .replace(/[_-]+/g, " ")
    .replace(/\b\w/g, (c) => c.toUpperCase());
}

/**
 * Shared Enter/Space activation for a clickable row or card. Ignores key
 * events bubbling up from nested interactive controls (buttons, links,
 * inputs, label-wrapped controls) so they don't also fire the row-level
 * action. `tabindex="-1"`
 * elements are excluded (programmatically focusable, not user-interactive).
 */
function handleRowActivationKeyDown(
  event: React.KeyboardEvent<HTMLElement>,
  activate: () => void,
) {
  if (event.key !== "Enter" && event.key !== " ") return;
  const interactive = (event.target as HTMLElement).closest(
    'button, a, label, input, textarea, select, [role="button"], [tabindex]:not([tabindex="-1"])',
  );
  if (interactive && interactive !== event.currentTarget) return;
  event.preventDefault();
  activate();
}

/**
 * Shared click activation for a clickable row or card. Mirrors the keydown
 * guard: a click that originates on (or bubbles up from) a nested interactive
 * control must not also fire the row-level action, so the nested control's own
 * handler is the only one that runs.
 */
function handleRowActivationClick(
  event: React.MouseEvent<HTMLElement>,
  activate: () => void,
) {
  const interactive = (event.target as HTMLElement).closest(
    'button, a, label, input, textarea, select, [role="button"], [tabindex]:not([tabindex="-1"])',
  );
  if (interactive && interactive !== event.currentTarget) return;
  activate();
}

/* ------------------------------------------------------------------ */
/*  Data Table Props                                                    */
/* ------------------------------------------------------------------ */

export interface DataTableProps<TData, TValue> extends VariantProps<typeof tableVariants> {
  columns: ColumnDef<TData, TValue>[];
  data: TData[];
  // Sorting
  enableSorting?: boolean;
  defaultSorting?: SortingState;
  onSortingChange?: (sorting: SortingState) => void;
  // Filtering
  enableFiltering?: boolean;
  globalFilter?: string;
  onGlobalFilterChange?: (value: string) => void;
  // Pagination
  enablePagination?: boolean;
  pageSize?: number;
  pageIndex?: number;
  onPaginationChange?: (pagination: PaginationState) => void;
  manualPagination?: boolean;
  pageCount?: number;
  // Selection
  enableRowSelection?: boolean;
  rowSelection?: RowSelectionState;
  onRowSelectionChange?: (selection: RowSelectionState) => void;
  enableMultiRowSelection?: boolean;
  // Column visibility
  columnVisibility?: VisibilityState;
  onColumnVisibilityChange?: (visibility: VisibilityState) => void;
  // Row options
  striped?: boolean;
  hoverable?: boolean;
  // Callbacks
  onRowClick?: (row: TData) => void;
  // Loading state
  isLoading?: boolean;
  // Empty state
  emptyMessage?: React.ReactNode;
  // Accessibility
  "aria-label"?: string;
  // Styling
  className?: string;
  containerClassName?: string;
  // Custom row id
  getRowId?: (row: TData, index: number) => string;
  // Children (toolbar, pagination)
  children?: React.ReactNode;
}

/* ------------------------------------------------------------------ */
/*  Main DataTable Component                                            */
/* ------------------------------------------------------------------ */

function DataTableRoot<TData, TValue>({
  columns,
  data,
  // Sorting
  enableSorting = true,
  defaultSorting = [],
  onSortingChange,
  // Filtering
  enableFiltering = false,
  globalFilter: externalGlobalFilter,
  onGlobalFilterChange,
  // Pagination
  enablePagination = false,
  pageSize: externalPageSize,
  pageIndex: externalPageIndex,
  onPaginationChange,
  manualPagination = false,
  pageCount: externalPageCount,
  // Selection
  enableRowSelection = false,
  rowSelection: externalRowSelection,
  onRowSelectionChange,
  enableMultiRowSelection = true,
  // Column visibility
  columnVisibility: externalColumnVisibility,
  onColumnVisibilityChange,
  // Row options
  striped = false,
  hoverable = false,
  // Callbacks
  onRowClick,
  // Loading state
  isLoading = false,
  // Empty state
  emptyMessage = "No results found.",
  // Accessibility
  "aria-label": ariaLabel,
  // Styling
  className,
  containerClassName,
  variant,
  size,
  // Custom row id
  getRowId,
  // Children
  children,
}: DataTableProps<TData, TValue>) {
  // Internal state
  const [sorting, setSorting] = React.useState<SortingState>(defaultSorting);
  const [globalFilter, setGlobalFilter] = React.useState("");
  const [columnFilters, setColumnFilters] = React.useState<ColumnFiltersState>([]);
  const [columnVisibility, setColumnVisibility] = React.useState<VisibilityState>({});
  const [rowSelection, setRowSelection] = React.useState<RowSelectionState>({});
  const [pagination, setPagination] = React.useState<PaginationState>({
    pageIndex: externalPageIndex ?? 0,
    pageSize: externalPageSize ?? DEFAULT_LIST_PAGE_SIZE,
  });

  // Controlled state handlers
  const handleSortingChange = React.useCallback(
    (updater: SortingState | ((old: SortingState) => SortingState)) => {
      const newSorting = typeof updater === "function" ? updater(sorting) : updater;
      setSorting(newSorting);
      onSortingChange?.(newSorting);
    },
    [sorting, onSortingChange]
  );

  const handleGlobalFilterChange = React.useCallback(
    (value: string) => {
      setGlobalFilter(value);
      onGlobalFilterChange?.(value);
    },
    [onGlobalFilterChange]
  );

  const handleColumnVisibilityChange = React.useCallback(
    (updater: VisibilityState | ((old: VisibilityState) => VisibilityState)) => {
      const currentVisibility = externalColumnVisibility ?? columnVisibility;
      const newVisibility = typeof updater === "function" ? updater(currentVisibility) : updater;
      setColumnVisibility(newVisibility);
      onColumnVisibilityChange?.(newVisibility);
    },
    [columnVisibility, externalColumnVisibility, onColumnVisibilityChange]
  );

  const handleRowSelectionChange = React.useCallback(
    (updater: RowSelectionState | ((old: RowSelectionState) => RowSelectionState)) => {
      const currentSelection = externalRowSelection ?? rowSelection;
      const newSelection = typeof updater === "function" ? updater(currentSelection) : updater;
      setRowSelection(newSelection);
      onRowSelectionChange?.(newSelection);
    },
    [rowSelection, externalRowSelection, onRowSelectionChange]
  );

  const handlePaginationChange = React.useCallback(
    (updaterOrValue: PaginationState | ((old: PaginationState) => PaginationState)) => {
      if (externalPageIndex !== undefined || externalPageSize !== undefined) {
        const currentPagination = {
          pageIndex: externalPageIndex ?? pagination.pageIndex,
          pageSize: externalPageSize ?? pagination.pageSize,
        };
        const newPagination = typeof updaterOrValue === "function"
          ? updaterOrValue(currentPagination)
          : updaterOrValue;
        setPagination(newPagination);
        onPaginationChange?.(newPagination);
        return;
      }

      setPagination((oldPagination) => {
        const newPagination = typeof updaterOrValue === "function"
          ? updaterOrValue(oldPagination)
          : updaterOrValue;
        onPaginationChange?.(newPagination);
        return newPagination;
      });
    },
    [externalPageIndex, externalPageSize, onPaginationChange, pagination]
  );

  // Use external values if provided
  const effectiveGlobalFilter = externalGlobalFilter ?? globalFilter;
  const effectiveColumnVisibility = externalColumnVisibility ?? columnVisibility;
  const effectiveRowSelection = externalRowSelection ?? rowSelection;
  const effectivePagination = {
    pageIndex: externalPageIndex ?? pagination.pageIndex,
    pageSize: externalPageSize ?? pagination.pageSize,
  };
  const loadingRows = Math.min(effectivePagination.pageSize, MAX_LOADING_ROWS);

  const table = useReactTable({
    data,
    columns,
    state: {
      sorting,
      globalFilter: effectiveGlobalFilter,
      columnFilters,
      columnVisibility: effectiveColumnVisibility,
      rowSelection: effectiveRowSelection,
      pagination: effectivePagination,
    },
    onSortingChange: handleSortingChange,
    onGlobalFilterChange: handleGlobalFilterChange,
    onColumnFiltersChange: setColumnFilters,
    onColumnVisibilityChange: handleColumnVisibilityChange,
    onRowSelectionChange: handleRowSelectionChange,
    onPaginationChange: handlePaginationChange,
    getCoreRowModel: getCoreRowModel(),
    getSortedRowModel: enableSorting ? getSortedRowModel() : undefined,
    getFilteredRowModel: enableFiltering ? getFilteredRowModel() : undefined,
    getPaginationRowModel: enablePagination && !manualPagination ? getPaginationRowModel() : undefined,
    enableRowSelection,
    enableMultiRowSelection,
    manualPagination,
    pageCount: externalPageCount,
    getRowId,
  });

  const contextValue = React.useMemo(
    () => ({ table }),
    [table]
  );

  // Slot partition: pagination renders BELOW the table (visually and in DOM —
  // keyboard/screen-reader order must match the visual order inside the
  // framed panel); everything else (toolbar, filters) stays above.
  const childArray = React.Children.toArray(children);
  const footerChildren = childArray.filter(
    (child) => React.isValidElement(child) && child.type === DataTablePagination,
  );
  const headerChildren = childArray.filter(
    (child) => !(React.isValidElement(child) && child.type === DataTablePagination),
  );
  const framed = variant !== "default";
  const isEmpty = !isLoading && table.getRowModel().rows.length === 0;

  return (
    <DataTableContext.Provider value={contextValue as DataTableContextValue<unknown>}>
      {/* Panel frame (md+): toolbar, table, and pagination live inside one
          bordered paper panel so the table never sits flush on the warm
          field. Mobile keeps the stacked card layout with gaps. */}
      <div
        className={cn(
          "flex flex-col gap-16 md:gap-0",
          framed &&
            "md:bg-[var(--panel-bg)] md:[border:var(--panel-border)] md:[box-shadow:var(--panel-shadow)]",
          containerClassName,
        )}
      >
        {headerChildren}
        {isEmpty ? (
          <div className="border border-[var(--color-border-secondary)] bg-[var(--color-background-white)] py-48 px-16 text-center text-[var(--color-text-secondary)] md:border-0 md:bg-transparent md:px-12">
            {emptyMessage}
          </div>
        ) : (
          <>
        {/* Desktop: real table (hidden on mobile in favor of the card view) */}
        <div className="hidden md:block overflow-auto">
          <table
            className={cn(tableVariants({ variant: "default", size }), className)}
            aria-label={ariaLabel}
            aria-busy={isLoading}
          >
            <thead>
              {table.getHeaderGroups().map((headerGroup) => (
                <tr
                  key={headerGroup.id}
                  className="bg-[var(--panel-head-bg)] [border-bottom:var(--panel-head-border)]"
                >
                  {headerGroup.headers.map((header) => {
                    const isSortable = header.column.getCanSort() && enableSorting;
                    const sortDir = header.column.getIsSorted();
                    return (
                      <th
                        key={header.id}
                        scope="col"
                        className={cn(
                          // Mono uppercase micro-label — every label is GT Flexa
                          // Mono Medium per the Maji DS (incl. table headers).
                          "label-micro py-10 px-12 text-left text-[var(--color-text-secondary)]",
                          isSortable && "cursor-pointer select-none hover:bg-[var(--clr-dark-purple-5)]"
                        )}
                        style={{ width: header.getSize() !== 150 ? header.getSize() : undefined }}
                        onClick={isSortable ? header.column.getToggleSortingHandler() : undefined}
                        onKeyDown={isSortable ? (e) => {
                          if (e.key === "Enter" || e.key === " ") {
                            e.preventDefault();
                            header.column.getToggleSortingHandler()?.(e);
                          }
                        } : undefined}
                        tabIndex={isSortable ? 0 : undefined}
                        aria-roledescription={isSortable ? "sortable column" : undefined}
                        aria-sort={
                          sortDir === "asc"
                            ? "ascending"
                            : sortDir === "desc"
                            ? "descending"
                            : undefined
                        }
                      >
                        <span className="inline-flex items-center gap-4">
                          {header.isPlaceholder
                            ? null
                            : flexRender(header.column.columnDef.header, header.getContext())}
                          {isSortable && (
                            <span className="inline-flex flex-col leading-none text-[var(--color-text-tertiary)]">
                              <CaretUpIcon
                                size={10}
                                weight={sortDir === "asc" ? "fill" : "regular"}
                                className={sortDir === "asc" ? "text-[var(--color-interaction)]" : ""}
                              />
                              <CaretDownIcon
                                size={10}
                                weight={sortDir === "desc" ? "fill" : "regular"}
                                className={sortDir === "desc" ? "text-[var(--color-interaction)]" : ""}
                              />
                            </span>
                          )}
                        </span>
                      </th>
                    );
                  })}
                </tr>
              ))}
            </thead>
            <tbody>
              {isLoading ? (
                Array.from({ length: loadingRows }).map((_, index) => (
                  <TableRowSkeleton
                    key={index}
                    columns={table.getVisibleLeafColumns().length}
                  />
                ))
              ) : (
                table.getRowModel().rows.map((row) => (
                  <tr
                    key={row.id}
                    className={cn(
                      tableRowVariants({
                        striped,
                        hoverable: hoverable || !!onRowClick,
                        selected: row.getIsSelected(),
                      }),
                      onRowClick &&
                        "cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-[var(--color-interaction)]"
                    )}
                    onClick={
                      onRowClick
                        ? (event) =>
                            handleRowActivationClick(event, () =>
                              onRowClick(row.original),
                            )
                        : undefined
                    }
                    // A clickable row must be reachable and activatable by
                    // keyboard: focusable with Enter/Space activation, but
                    // WITHOUT role="button" — that would override the implicit
                    // role="row" and sever the cell to column-header
                    // association for screen readers.
                    tabIndex={onRowClick ? 0 : undefined}
                    onKeyDown={
                      onRowClick
                        ? (event) =>
                            handleRowActivationKeyDown(event, () =>
                              onRowClick(row.original),
                            )
                        : undefined
                    }
                    data-state={row.getIsSelected() ? "selected" : undefined}
                  >
                    {row.getVisibleCells().map((cell) => (
                      <td key={cell.id} className="py-8 px-12 body-small">
                        {flexRender(cell.column.columnDef.cell, cell.getContext())}
                      </td>
                    ))}
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>

        {/* Mobile: each row as a tappable stacked card. Preserves onRowClick
            (→ side sheet) and column headers as labels, so every table benefits
            without per-table work and no unreadable horizontal scroll. */}
        <div className="md:hidden flex flex-col gap-12">
          {isLoading ? (
            Array.from({ length: loadingRows }).map((_, index) => (
              <div
                key={index}
                className="border border-[var(--color-border-secondary)] bg-[var(--color-background-white)] p-16"
              >
                <div className="h-16 w-1/2 bg-[var(--color-background-medium)] animate-pulse" />
                <div className="mt-12 h-12 w-3/4 bg-[var(--color-background-medium)] animate-pulse" />
              </div>
            ))
          ) : (
            table.getRowModel().rows.map((row) => (
              <div
                key={row.id}
                className={cn(
                  "border border-[var(--color-border-secondary)] bg-[var(--color-background-white)] px-16 py-8",
                  row.getIsSelected() && "bg-[var(--color-interaction)]/10",
                  onRowClick &&
                    "cursor-pointer transition-colors hover:bg-[var(--color-background-medium)] active:bg-[var(--color-background-medium)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-[var(--color-interaction)]",
                )}
                onClick={
                  onRowClick
                    ? (event) =>
                        handleRowActivationClick(event, () =>
                          onRowClick(row.original),
                        )
                    : undefined
                }
                role={onRowClick ? "button" : undefined}
                tabIndex={onRowClick ? 0 : undefined}
                onKeyDown={
                  onRowClick
                    ? (event) =>
                        handleRowActivationKeyDown(event, () =>
                          onRowClick(row.original),
                        )
                    : undefined
                }
                data-state={row.getIsSelected() ? "selected" : undefined}
              >
                {row.getVisibleCells().map((cell) => {
                  const label = columnLabel(cell.column);
                  return (
                    <div
                      key={cell.id}
                      className={cn(
                        "flex items-start gap-12 py-8 border-b border-[var(--color-border-tertiary)] last:border-0",
                        label ? "justify-between" : "justify-end",
                      )}
                    >
                      {label && (
                        <span className="body-caption text-[var(--color-text-tertiary)] shrink-0 pt-2">
                          {label}
                        </span>
                      )}
                      <div className="body-small min-w-0 break-words text-right">
                        {flexRender(
                          cell.column.columnDef.cell,
                          cell.getContext(),
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            ))
          )}
        </div>
          </>
        )}
        {footerChildren}
      </div>
    </DataTableContext.Provider>
  );
}

/* ------------------------------------------------------------------ */
/*  DataTable Toolbar                                                   */
/* ------------------------------------------------------------------ */

interface DataTableToolbarProps {
  children?: React.ReactNode;
  className?: string;
}

function DataTableToolbar({ children, className }: DataTableToolbarProps) {
  return (
    <div
      className={cn(
        // Stack vertically on mobile so search + actions get full rows; the
        // original single-row layout returns at sm+. At md+ the toolbar sits
        // inside the panel frame, so it carries its own padding + hairline.
        "flex flex-col gap-12 sm:flex-row sm:items-center sm:justify-between sm:gap-16 sm:flex-wrap",
        "md:px-16 md:py-12 md:[border-bottom:var(--panel-head-border)]",
        className,
      )}
    >
      {children}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  DataTable Search                                                    */
/* ------------------------------------------------------------------ */

interface DataTableSearchProps {
  placeholder?: string;
  className?: string;
  "aria-label"?: string;
}

function DataTableSearch({
  placeholder = "Search...",
  className,
  "aria-label": ariaLabel = "Search table",
}: DataTableSearchProps) {
  const { table } = useDataTable();
  const value = (table.getState().globalFilter as string) ?? "";

  function setSearch(nextValue: string) {
    table.setGlobalFilter(nextValue);
    table.setPageIndex(0);
  }

  return (
    <div className={cn("relative w-full sm:max-w-[320px] sm:flex-1", className)}>
      <MagnifyingGlassIcon
        size={18}
        aria-hidden
        className="absolute left-12 top-1/2 -translate-y-1/2 text-[var(--color-text-tertiary)] pointer-events-none"
      />
      <input
        value={value}
        onChange={(event) => setSearch(event.target.value)}
        placeholder={placeholder}
        className={cn(
          "w-full h-40 pl-36 border border-[var(--color-border-primary)] bg-[var(--color-background-white)] body-small placeholder:text-[var(--color-text-tertiary)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-interaction)]",
          value ? "pr-40" : "pr-12",
        )}
        aria-label={ariaLabel}
      />
      {value && (
        <Button
          variant="noOutline"
          size="icon"
          onClick={() => setSearch("")}
          aria-label="Clear search"
          className="absolute right-4 top-1/2 -translate-y-1/2"
        >
          <XIcon size={16} weight="bold" aria-hidden />
        </Button>
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  DataTable Controls                                                  */
/* ------------------------------------------------------------------ */

interface DataTableControlsProps {
  children?: React.ReactNode;
  className?: string;
}

function DataTableControls({ children, className }: DataTableControlsProps) {
  return (
    <div
      className={cn(
        "flex w-full flex-col gap-8 [&>button]:h-40 [&>button]:w-full sm:w-auto sm:flex-row sm:items-center sm:flex-wrap sm:[&>button]:w-auto",
        className,
      )}
    >
      {children}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  DataTable Filter Select                                             */
/* ------------------------------------------------------------------ */

type DataTableFilterSelectProps = React.SelectHTMLAttributes<HTMLSelectElement>;

function DataTableFilterSelect({
  children,
  className,
  ...props
}: DataTableFilterSelectProps) {
  return (
    <select
      className={cn(
        "h-40 w-full border border-[var(--color-border-primary)] bg-[var(--color-background-white)] px-12 body-small text-[var(--color-text-primary)] cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-interaction)] disabled:cursor-not-allowed disabled:opacity-50 sm:w-auto",
        className,
      )}
      {...props}
    >
      {children}
    </select>
  );
}

/* ------------------------------------------------------------------ */
/*  DataTable Column Visibility                                         */
/* ------------------------------------------------------------------ */

interface DataTableColumnVisibilityProps {
  className?: string;
}

function DataTableColumnVisibility({ className }: DataTableColumnVisibilityProps) {
  const { table } = useDataTable();
  const [isOpen, setIsOpen] = React.useState(false);
  const dropdownRef = React.useRef<HTMLDivElement>(null);
  const triggerRef = React.useRef<HTMLButtonElement>(null);
  const menuId = React.useId();
  const hideableColumns = table
    .getAllLeafColumns()
    .filter((column) => column.getCanHide() && columnLabel(column));
  const hasVisibilityChanges = hideableColumns.some((column) => !column.getIsVisible());

  React.useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(event.target as Node)) {
        setIsOpen(false);
      }
    };
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  function handleKeyDown(event: React.KeyboardEvent<HTMLDivElement>) {
    if (event.key !== "Escape" || !isOpen) return;
    event.preventDefault();
    setIsOpen(false);
    triggerRef.current?.focus();
  }

  return (
    <div
      className={cn("relative w-full sm:w-auto", className)}
      ref={dropdownRef}
      onKeyDown={handleKeyDown}
    >
      <Button
        ref={triggerRef}
        variant="default"
        onClick={() => setIsOpen((open) => !open)}
        className="w-full bg-[var(--color-background-white)] sm:w-auto"
        aria-expanded={isOpen}
        aria-haspopup="dialog"
        aria-controls={menuId}
      >
        Columns
      </Button>
      {isOpen && (
        <div
          id={menuId}
          role="dialog"
          aria-label="Column visibility"
          className="absolute right-0 top-[calc(100%+4px)] z-10 min-w-[160px] border border-[var(--color-border-primary)] bg-[var(--color-background-white)]"
        >
          {hideableColumns.map((column) => (
            <label
              key={column.id}
              className="flex items-center gap-8 px-12 py-8 body-small text-[var(--color-text-primary)] hover:bg-[var(--color-background-medium)] cursor-pointer"
            >
              <span
                className={cn(
                  "flex items-center justify-center h-16 w-16 border border-[var(--color-border-primary)]",
                  column.getIsVisible() && "bg-[var(--color-interaction)] border-[var(--color-interaction)]"
                )}
              >
                {column.getIsVisible() && <CheckIcon size={12} weight="bold" className="text-white" />}
              </span>
              <input
                type="checkbox"
                checked={column.getIsVisible()}
                onChange={column.getToggleVisibilityHandler()}
                className="sr-only"
              />
              <span>{columnLabel(column)}</span>
            </label>
          ))}
          {hasVisibilityChanges && (
            <div className="border-t border-[var(--color-border-tertiary)] p-4">
              <Button
                variant="noOutline"
                size="small"
                width="full"
                onClick={() => table.resetColumnVisibility()}
              >
                Reset columns
              </Button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  DataTable Pagination                                                */
/* ------------------------------------------------------------------ */

interface DataTablePaginationProps {
  showRowsPerPage?: boolean;
  rowsPerPageOptions?: readonly number[];
  showSelectedCount?: boolean;
  className?: string;
}

function DataTablePagination({
  showRowsPerPage = true,
  rowsPerPageOptions = LIST_PAGE_SIZE_OPTIONS,
  showSelectedCount = false,
  className,
}: DataTablePaginationProps) {
  const { table } = useDataTable();
  const pageIndex = table.getState().pagination.pageIndex;
  const pageSize = table.getState().pagination.pageSize;
  const pageCount = table.getPageCount();
  const totalRows = table.getFilteredRowModel().rows.length;
  const selectedCount = Object.keys(table.getState().rowSelection).length;

  return (
    <ListPagination
      page={pageIndex + 1}
      pageCount={pageCount}
      pageSize={pageSize}
      onPageChange={(page) => table.setPageIndex(page - 1)}
      onPageSizeChange={(size) => table.setPageSize(size)}
      rowsPerPageOptions={rowsPerPageOptions}
      showRowsPerPage={showRowsPerPage}
      className={className}
      leadingContent={
        showSelectedCount && selectedCount > 0 ? (
          <span className="body-small text-[var(--color-text-secondary)]">
            {selectedCount} of {totalRows}{" "}
            {pluralize(totalRows, "row")} selected
          </span>
        ) : undefined
      }
    />
  );
}

/* ------------------------------------------------------------------ */
/*  DataTable Selection Checkbox                                        */
/* ------------------------------------------------------------------ */

interface DataTableCheckboxProps {
  checked: boolean;
  indeterminate?: boolean;
  onChange: (checked: boolean) => void;
  "aria-label"?: string;
}

function DataTableCheckbox({
  checked,
  indeterminate,
  onChange,
  "aria-label": ariaLabel,
}: DataTableCheckboxProps) {
  const ref = React.useRef<HTMLInputElement>(null);

  React.useEffect(() => {
    if (ref.current) {
      ref.current.indeterminate = indeterminate ?? false;
    }
  }, [indeterminate]);

  return (
    <label className="inline-flex items-center cursor-pointer">
      <span
        className={cn(
          "flex items-center justify-center h-18 w-18 border border-[var(--color-border-primary)] transition-colors",
          (checked || indeterminate) && "bg-[var(--color-interaction)] border-[var(--color-interaction)]"
        )}
      >
        {checked && <CheckIcon size={14} weight="bold" className="text-white" />}
        {!checked && indeterminate && (
          <span className="h-2 w-10 bg-white" />
        )}
      </span>
      <input
        ref={ref}
        type="checkbox"
        checked={checked}
        onChange={(e) => onChange(e.target.checked)}
        aria-label={ariaLabel}
        className="sr-only"
      />
    </label>
  );
}

/* ------------------------------------------------------------------ */
/*  Helper: Selection Column                                            */
/* ------------------------------------------------------------------ */

function createSelectionColumn<TData>(): ColumnDef<TData> {
  return {
    id: "select",
    header: ({ table }) => (
      <DataTableCheckbox
        checked={table.getIsAllPageRowsSelected()}
        indeterminate={table.getIsSomePageRowsSelected()}
        onChange={(checked) => table.toggleAllPageRowsSelected(checked)}
        aria-label="Select all rows"
      />
    ),
    cell: ({ row }) => (
      <DataTableCheckbox
        checked={row.getIsSelected()}
        onChange={(checked) => row.toggleSelected(checked)}
        aria-label="Select row"
      />
    ),
    enableSorting: false,
    enableHiding: false,
    size: 40,
  };
}

/* ------------------------------------------------------------------ */
/*  Export Compound Component                                           */
/* ------------------------------------------------------------------ */

export const DataTable = Object.assign(DataTableRoot, {
  Toolbar: DataTableToolbar,
  Controls: DataTableControls,
  Search: DataTableSearch,
  FilterSelect: DataTableFilterSelect,
  ColumnVisibility: DataTableColumnVisibility,
  Pagination: DataTablePagination,
  Checkbox: DataTableCheckbox,
});

export { createSelectionColumn, useDataTable };
export type {
  DataTableCheckboxProps,
  DataTableControlsProps,
  DataTableFilterSelectProps,
  DataTableSearchProps,
};
