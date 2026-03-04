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

// ============================================
// List Skeleton
// ============================================

interface ListSkeletonProps {
  items?: number;
  className?: string;
}

export function ListSkeleton({ items = 3, className }: ListSkeletonProps) {
  return (
    <div className={cn("space-y-24", className)}>
      {Array.from({ length: items }).map((_, i) => (
        <CardSkeleton key={i} lines={2} />
      ))}
    </div>
  );
}

// ============================================
// Form Skeleton
// ============================================

interface FormSkeletonProps {
  fields?: number;
  className?: string;
}

export function FormSkeleton({ fields = 4, className }: FormSkeletonProps) {
  return (
    <div className={cn("space-y-32", className)}>
      {Array.from({ length: fields }).map((_, i) => (
        <div key={i} className="space-y-16">
          {/* Label */}
          <Skeleton className="h-[14px] w-[120px]" />
          {/* Input */}
          <Skeleton className="h-[48px] w-full rounded-4" />
        </div>
      ))}
      {/* Submit button */}
      <Skeleton className="h-[48px] w-[120px] rounded-4" />
    </div>
  );
}

// ============================================
// Page Header Skeleton
// ============================================

interface PageHeaderSkeletonProps {
  className?: string;
  showButton?: boolean;
}

export function PageHeaderSkeleton({
  className,
  showButton = true,
}: PageHeaderSkeletonProps) {
  return (
    <div className={cn("flex items-center justify-between", className)}>
      <Skeleton className="h-[36px] w-[200px]" />
      {showButton && <Skeleton className="h-[48px] w-[160px] rounded-8" />}
    </div>
  );
}

// ============================================
// Stats Card Skeleton
// ============================================

interface StatsCardSkeletonProps {
  className?: string;
}

export function StatsCardSkeleton({ className }: StatsCardSkeletonProps) {
  return (
    <div
      className={cn(
        "border border-[var(--color-border-primary)] rounded-8 p-24 bg-[var(--color-background-white)]",
        className
      )}
    >
      <Skeleton className="h-[14px] w-[80px] mb-16" />
      <Skeleton className="h-[32px] w-[120px]" />
    </div>
  );
}

// ============================================
// Entity Detail Skeleton
// ============================================

interface EntityDetailSkeletonProps {
  className?: string;
  sections?: number;
}

export function EntityDetailSkeleton({
  className,
  sections = 3,
}: EntityDetailSkeletonProps) {
  return (
    <div className={cn("space-y-48", className)}>
      {/* Header */}
      <PageHeaderSkeleton showButton={false} />

      {/* Sections */}
      {Array.from({ length: sections }).map((_, i) => (
        <div key={i} className="space-y-24">
          <Skeleton className="h-[24px] w-[150px]" />
          <div className="grid grid-cols-2 gap-24">
            {Array.from({ length: 4 }).map((_, j) => (
              <div key={j} className="space-y-16">
                <Skeleton className="h-[12px] w-[80px]" />
                <Skeleton className="h-[16px] w-[120px]" />
              </div>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}
