"use client";

/** Shared state for the credit batch page and its tabs. */
import { createContext, useContext, type ReactNode } from "react";
import type { CreditBatchWithRelations } from "@/data-access/credit-batches";
import type { CreditBatchPageModel } from "@/data-access/credit-batch-page-model";
import type { CreditBatchOpenItemGroups, CreditBatchPageTab } from "@/lib/credit-batches/batch-page";
import type { CreditBatchOpenItem } from "@/lib/credit-batches/open-items";
import type { SheetReadOnly } from "@/lib/linked-record-read-only";
import type { RecordLockStatus, RecordLockView } from "@/lib/record-lock-view";

export interface CreditBatchPageContextValue {
  batch: CreditBatchWithRelations;
  /** Removal slices, dry masses and milestones; undefined while loading. */
  pageModel: CreditBatchPageModel | undefined;
  pageModelError: Error | null;
  retryPageModel: () => void;
  retryingPageModel: boolean;
  openItems: CreditBatchOpenItemGroups;
  /** Blocking items once the to-do read has answered; null before. */
  blockingCount: number | null;
  /** Set when the to-do read failed; the page then shows no to-dos at all. */
  todosError: Error | null;
  /** The Components decided check's count of template components to decide; 0 when none or before the to-do read answers. */
  linesToDecide: number;
  retryTodos: () => void;
  retryingTodos: boolean;
  lock: RecordLockView | undefined;
  lockStatus: RecordLockStatus;
  canManage: boolean;
  /** Set when the batch opens read only (its facility is archived or unchecked). */
  readOnly?: SheetReadOnly;
  /** The batch's facility is archived: members read through the linked read. */
  archived: boolean;
  /**
   * The batch's own facility zone, set when that facility is archived. The
   * facility list leaves it out, so surfaces that format times read this first.
   */
  facilityTimeZone?: string;
  tab: CreditBatchPageTab;
  /** The row the URL asks to highlight (`?focus=`). */
  focus: string | null;
  /** Switch tab and optionally highlight a row there. */
  go: (tab: CreditBatchPageTab, focus?: string | null) => void;
  /** Follow an open item: a tab and row on this page, or its repair page. */
  openItem: (item: CreditBatchOpenItem) => void;
  /** Start editing the batch in the side sheet, when the lock allows it. */
  startEdit: (() => void) | null;
}

const CreditBatchPageContext = createContext<CreditBatchPageContextValue | null>(null);

export function CreditBatchPageProvider({ value, children }: { value: CreditBatchPageContextValue; children: ReactNode }) {
  return <CreditBatchPageContext.Provider value={value}>{children}</CreditBatchPageContext.Provider>;
}

export function useCreditBatchPage(): CreditBatchPageContextValue {
  const value = useContext(CreditBatchPageContext);
  if (!value) throw new Error("useCreditBatchPage needs a CreditBatchPageProvider");
  return value;
}
