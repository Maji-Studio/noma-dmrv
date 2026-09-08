/**
 * Loading Skeleton Components
 *
 * Provides skeleton placeholders for loading states.
 * Includes table skeleton, card skeleton, and individual skeleton primitives.
 */
"use client";

import { cn } from "@/lib/utils";

// ============================================
// Base Skeleton
// ============================================

interface SkeletonProps {
  className?: string;
  width?: string | number;
  height?: string | number;
}

export function Skeleton({ className, width, height }: SkeletonProps) {
  return (
    <div
      className={cn(
        "rounded-4 animate-skeleton",
        className
      )}
      style={{
        width: typeof width === "number" ? `${width}px` : width,
        height: typeof height === "number" ? `${height}px` : height,
      }}
    />
  );
}

// ============================================
// Table Row Skeleton
// ============================================

interface TableRowSkeletonProps {
  columns: number;
  className?: string;
}

export function TableRowSkeleton({ columns, className }: TableRowSkeletonProps) {
  return (
    <tr className={cn("border-b border-[var(--color-border-tertiary)]", className)}>
      {Array.from({ length: columns }).map((_, i) => (
        <td key={i} className="py-[12px] px-[12px]">
          <Skeleton
            className="h-[16px]"
            width={i === 0 ? "80%" : i === columns - 1 ? "60px" : "70%"}
          />
        </td>
      ))}
    </tr>
  );
}

// ============================================
// Table Skeleton
// ============================================

interface TableSkeletonProps {
  columns: number;
  rows?: number;
  showHeader?: boolean;
  className?: string;
}

export function TableSkeleton({
  columns,
  rows = 5,
  showHeader = true,
  className,
}: TableSkeletonProps) {
  return (
    <div className={cn("bg-[var(--color-background-white)] border border-[var(--color-border-secondary)]", className)}>
      <table className="w-full border-collapse">
        {showHeader && (
          <thead>
            <tr className="bg-[var(--color-background-medium)] border-b border-[var(--color-border-primary)]">
              {Array.from({ length: columns }).map((_, i) => (
                <th
                  key={i}
                  className="py-[10px] px-[12px] text-left"
                >
                  <Skeleton
                    className="h-[14px]"
                    width={i === 0 ? "100px" : i === columns - 1 ? "60px" : "80px"}
                  />
                </th>
              ))}
            </tr>
          </thead>
        )}
        <tbody>
          {Array.from({ length: rows }).map((_, i) => (
            <TableRowSkeleton key={i} columns={columns} />
          ))}
        </tbody>
      </table>
    </div>
  );
}

// ============================================
// Card Skeleton
// ============================================

interface CardSkeletonProps {
  className?: string;
  showImage?: boolean;
  lines?: number;
}

export function CardSkeleton({
  className,
  showImage = false,
  lines = 3,
}: CardSkeletonProps) {
  return (
    <div
      className={cn(
        "border border-[var(--color-border-primary)] rounded-8 p-32 bg-[var(--color-background-white)]",
        className
      )}
    >
      {showImage && (
        <Skeleton className="w-full h-[160px] mb-24 rounded-4" />
      )}
      <div className="space-y-16">
        {/* Title */}
        <Skeleton className="h-[20px] w-[60%]" />
        {/* Content lines */}
        {Array.from({ length: lines }).map((_, i) => (
          <Skeleton
            key={i}
            className="h-[14px]"
            width={i === lines - 1 ? "40%" : "100%"}
          />
        ))}
      </div>
    </div>
  );
}
