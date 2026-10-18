"use client";

/** Shared state for the credit batch page and its tabs. */
import { createContext, useContext, type ReactNode } from "react";
import type { CreditBatchWithRelations } from "@/data-access/credit-batches";
import type { CreditBatchPageModel } from "@/data-access/credit-batch-page-model";
import type { CreditBatchOpenItemGroups, CreditBatchPageTab } from "@/lib/credit-batches/batch-page";
import type { CreditBatchOpenItem } from "@/lib/credit-batches/open-items";
import type { RecordLockStatus, RecordLockView } from "@/lib/record-lock-view";

export interface CreditBatchPageContextValue {
  batch: CreditBatchWithRelations;
  /** Removal slices, dry masses and milestones; undefined while loading. */
  pageModel: CreditBatchPageModel | undefined;
  pageModelError: Error | null;
  retryPageModel: () => void;
  openItems: CreditBatchOpenItemGroups;
  /** Blocking items once the batch health has answered; null before. */
  blockingCount: number | null;
  healthError: Error | null;
  retryHealth: () => void;
  retryingHealth: boolean;
  lock: RecordLockView | undefined;
  lockStatus: RecordLockStatus;
  canManage: boolean;
  emissionsEntriesEnabled: boolean;
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
