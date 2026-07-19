"use client";

import { CaretLeftIcon, CaretRightIcon } from "@phosphor-icons/react/dist/ssr";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

const DEFAULT_ROWS_PER_PAGE_OPTIONS = [10, 20, 30, 50];
const PAGINATION_NAV_BUTTON_CLASS = "h-44 w-44 sm:h-32 sm:w-32";

interface ListPaginationProps {
  page: number;
  pageCount: number;
  pageSize: number;
  onPageChange: (page: number) => void;
  onPageSizeChange: (pageSize: number) => void;
  rowsPerPageOptions?: number[];
  showRowsPerPage?: boolean;
  leadingContent?: React.ReactNode;
  className?: string;
}

/**
 * Shared pagination contract for data tables and bespoke card lists.
 * Page numbers are one-based at this boundary.
 */
function ListPagination({
  page,
  pageCount,
  pageSize,
  onPageChange,
  onPageSizeChange,
  rowsPerPageOptions = DEFAULT_ROWS_PER_PAGE_OPTIONS,
  showRowsPerPage = true,
  leadingContent,
  className,
}: ListPaginationProps) {
  const safePageCount = Math.max(pageCount, 1);
  const safePage = Math.min(Math.max(page, 1), safePageCount);
  const canGoBack = safePage > 1;
  const canGoForward = safePage < safePageCount;

  return (
    <div
      className={cn(
        "flex items-center justify-between gap-16 flex-wrap",
        "md:px-16 md:py-10 md:[border-top:var(--panel-head-border)]",
        className,
      )}
    >
      <div className="flex items-center gap-16">
        {leadingContent}
        {showRowsPerPage && (
          <label className="flex items-center gap-8">
            <span className="body-small text-[var(--color-text-secondary)]">
              Rows per page:
            </span>
            <select
              value={pageSize}
              onChange={(event) => onPageSizeChange(Number(event.target.value))}
              className="h-32 px-8 border border-[var(--color-border-primary)] bg-[var(--color-background-white)] body-small cursor-pointer"
              aria-label="Rows per page"
            >
              {rowsPerPageOptions.map((size) => (
                <option key={size} value={size}>
                  {size}
                </option>
              ))}
            </select>
          </label>
        )}
      </div>

      <div className="flex items-center gap-8">
        <span className="body-small text-[var(--color-text-secondary)]">
          Page {safePage} of {safePageCount}
        </span>
        <div className="flex items-center gap-4">
          <Button
            variant="noOutline"
            size="icon"
            onClick={() => onPageChange(1)}
            disabled={!canGoBack}
            className={PAGINATION_NAV_BUTTON_CLASS}
            aria-label="Go to first page"
          >
            <CaretLeftIcon size={14} weight="bold" className="pointer-events-none" />
            <CaretLeftIcon size={14} weight="bold" className="-ml-8 pointer-events-none" />
          </Button>
          <Button
            variant="noOutline"
            size="icon"
            onClick={() => onPageChange(safePage - 1)}
            disabled={!canGoBack}
            className={PAGINATION_NAV_BUTTON_CLASS}
            aria-label="Go to previous page"
          >
            <CaretLeftIcon size={14} weight="bold" className="pointer-events-none" />
          </Button>
          <Button
            variant="noOutline"
            size="icon"
            onClick={() => onPageChange(safePage + 1)}
            disabled={!canGoForward}
            className={PAGINATION_NAV_BUTTON_CLASS}
            aria-label="Go to next page"
          >
            <CaretRightIcon size={14} weight="bold" className="pointer-events-none" />
          </Button>
          <Button
            variant="noOutline"
            size="icon"
            onClick={() => onPageChange(safePageCount)}
            disabled={!canGoForward}
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

export { ListPagination };
export type { ListPaginationProps };
