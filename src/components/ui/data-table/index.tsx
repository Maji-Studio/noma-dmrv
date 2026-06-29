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
import { CaretUpIcon, CaretDownIcon, MagnifyingGlassIcon, CaretLeftIcon, CaretRightIcon, CheckIcon } from "@phosphor-icons/react/dist/ssr";
import { cn } from "@/lib/utils";
import { cva, type VariantProps } from "class-variance-authority";
import { Button } from "@/components/ui/button";
import { TableRowSkeleton } from "@/components/ui/loading-skeleton";

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
        comfortable: "[&_th]:py-14 [&_th]:px-16 [&_td]:py-12 [&_td]:px-16",
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
  if (typeof header === "string") return header;
  if (column.id === "select" || column.id === "actions") return "";
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
  pageSize: externalPageSize = 10,
  pageIndex: externalPageIndex = 0,
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
    pageIndex: externalPageIndex,
    pageSize: externalPageSize,
  });

  // Sync pagination state when external props change
  React.useEffect(() => {
    setPagination((prev) => {
      if (prev.pageIndex === externalPageIndex && prev.pageSize === externalPageSize) return prev;
      return { pageIndex: externalPageIndex, pageSize: externalPageSize };
    });
  }, [externalPageIndex, externalPageSize]);

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
      const newVisibility = typeof updater === "function" ? updater(columnVisibility) : updater;
      setColumnVisibility(newVisibility);
      onColumnVisibilityChange?.(newVisibility);
    },
    [columnVisibility, onColumnVisibilityChange]
  );

  const handleRowSelectionChange = React.useCallback(
    (updater: RowSelectionState | ((old: RowSelectionState) => RowSelectionState)) => {
      const newSelection = typeof updater === "function" ? updater(rowSelection) : updater;
      setRowSelection(newSelection);
      onRowSelectionChange?.(newSelection);
    },
    [rowSelection, onRowSelectionChange]
  );

  const handlePaginationChange = React.useCallback(
    (updaterOrValue: PaginationState | ((old: PaginationState) => PaginationState)) => {
      setPagination((oldPagination) => {
        const newPagination = typeof updaterOrValue === "function"
          ? updaterOrValue(oldPagination)
          : updaterOrValue;
        onPaginationChange?.(newPagination);
        return newPagination;
      });
    },
    [onPaginationChange]
  );

  // Use external values if provided
  const effectiveGlobalFilter = externalGlobalFilter ?? globalFilter;
  const effectiveColumnVisibility = externalColumnVisibility ?? columnVisibility;
  const effectiveRowSelection = externalRowSelection ?? rowSelection;
  const loadingRows = Math.min(pagination.pageSize, MAX_LOADING_ROWS);

  const table = useReactTable({
    data,
    columns,
    state: {
      sorting,
      globalFilter: effectiveGlobalFilter,
      columnFilters,
      columnVisibility: effectiveColumnVisibility,
      rowSelection: effectiveRowSelection,
      pagination,
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
              ) : table.getRowModel().rows.length === 0 ? (
                <tr>
                  <td
                    colSpan={columns.length}
                    className="py-48 px-12 text-center text-[var(--color-text-secondary)]"
                  >
                    {emptyMessage}
                  </td>
                </tr>
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
                    // keyboard, so expose it as a focusable button when
                    // onRowClick is wired.
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
          ) : table.getRowModel().rows.length === 0 ? (
            <div className="border border-[var(--color-border-secondary)] bg-[var(--color-background-white)] py-48 px-16 text-center text-[var(--color-text-secondary)]">
              {emptyMessage}
            </div>
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
}

function DataTableSearch({ placeholder = "Search...", className }: DataTableSearchProps) {
  const { table } = useDataTable();
  const value = (table.getState().globalFilter as string) ?? "";

  return (
    <div className={cn("relative w-full sm:max-w-[320px] sm:flex-1", className)}>
      <MagnifyingGlassIcon
        size={18}
        className="absolute left-12 top-1/2 -translate-y-1/2 text-[var(--color-text-tertiary)] pointer-events-none"
      />
      <input
        value={value}
        onChange={(e) => table.setGlobalFilter(e.target.value)}
        placeholder={placeholder}
        className="w-full h-40 pl-36 pr-12 border border-[var(--color-border-primary)] bg-[var(--color-background-white)] body-small placeholder:text-[var(--color-text-tertiary)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-interaction)]"
        aria-label="Search table"
      />
    </div>
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

  React.useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(event.target as Node)) {
        setIsOpen(false);
      }
    };
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  return (
    <div className={cn("relative", className)} ref={dropdownRef}>
      <Button
        variant="default"
        onClick={() => setIsOpen(!isOpen)}
        className="bg-[var(--color-background-white)]"
      >
        Columns
      </Button>
      {isOpen && (
        <div className="absolute right-0 top-[calc(100%+4px)] z-10 min-w-[160px] border border-[var(--color-border-primary)] bg-[var(--color-background-white)]">
          {table.getAllLeafColumns().map((column) => {
            if (!column.getCanHide()) return null;
            return (
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
                <span className="capitalize">{column.id}</span>
              </label>
            );
          })}
        </div>
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  DataTable Pagination                                                */
/* ------------------------------------------------------------------ */

// Size override for the first/prev/next/last nav buttons. 44px touch target
// on mobile, condensed to the standard 32px icon size from `sm` up (matches
// the a11y touch-target rule).
const PAGINATION_NAV_BUTTON_CLASS = "h-44 w-44 sm:h-32 sm:w-32";

interface DataTablePaginationProps {
  showRowsPerPage?: boolean;
  rowsPerPageOptions?: number[];
  showSelectedCount?: boolean;
  className?: string;
}

function DataTablePagination({
  showRowsPerPage = true,
  rowsPerPageOptions = [10, 20, 30, 50],
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
    <div
      className={cn(
        // At md+ pagination sits inside the panel frame as its footer row.
        "flex items-center justify-between gap-16 flex-wrap",
        "md:px-16 md:py-10 md:[border-top:var(--panel-head-border)]",
        className,
      )}
    >
      <div className="flex items-center gap-16">
        {showSelectedCount && selectedCount > 0 && (
          <span className="body-small text-[var(--color-text-secondary)]">
            {selectedCount} of {totalRows} row(s) selected
          </span>
        )}
        {showRowsPerPage && (
          <div className="flex items-center gap-8">
            <span className="body-small text-[var(--color-text-secondary)]">Rows per page:</span>
            <select
              value={pageSize}
              onChange={(e) => table.setPageSize(Number(e.target.value))}
              className="h-32 px-8 border border-[var(--color-border-primary)] bg-[var(--color-background-white)] body-small cursor-pointer"
            >
              {rowsPerPageOptions.map((size) => (
                <option key={size} value={size}>
                  {size}
                </option>
              ))}
            </select>
          </div>
        )}
      </div>
      <div className="flex items-center gap-8">
        <span className="body-small text-[var(--color-text-secondary)]">
          Page {pageIndex + 1} of {pageCount || 1}
        </span>
        <div className="flex items-center gap-4">
          <Button
            variant="noOutline"
            size="icon"
            onClick={() => table.firstPage()}
            disabled={!table.getCanPreviousPage()}
            className={PAGINATION_NAV_BUTTON_CLASS}
            aria-label="Go to first page"
          >
            <CaretLeftIcon size={14} weight="bold" className="pointer-events-none" />
            <CaretLeftIcon size={14} weight="bold" className="-ml-8 pointer-events-none" />
          </Button>
          <Button
            variant="noOutline"
            size="icon"
            onClick={() => table.previousPage()}
            disabled={!table.getCanPreviousPage()}
            className={PAGINATION_NAV_BUTTON_CLASS}
            aria-label="Go to previous page"
          >
            <CaretLeftIcon size={14} weight="bold" className="pointer-events-none" />
          </Button>
          <Button
            variant="noOutline"
            size="icon"
            onClick={() => table.nextPage()}
            disabled={!table.getCanNextPage()}
            className={PAGINATION_NAV_BUTTON_CLASS}
            aria-label="Go to next page"
          >
            <CaretRightIcon size={14} weight="bold" className="pointer-events-none" />
          </Button>
          <Button
            variant="noOutline"
            size="icon"
            onClick={() => table.lastPage()}
            disabled={!table.getCanNextPage()}
            className={PAGINATION_NAV_BUTTON_CLASS}
            aria-label="Go to last page"
          >
            <CaretRightIcon size={14} weight="bold" className="pointer-events-none" />
            <CaretRightIcon size={14} weight="bold" className="-ml-8 pointer-events-none" />
          </Button>
        </div>
      </div>
    </div>
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
  Search: DataTableSearch,
  ColumnVisibility: DataTableColumnVisibility,
  Pagination: DataTablePagination,
  Checkbox: DataTableCheckbox,
});

export { createSelectionColumn, useDataTable };
export type { DataTableCheckboxProps };
