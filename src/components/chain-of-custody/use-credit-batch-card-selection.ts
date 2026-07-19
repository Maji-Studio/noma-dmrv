"use client";

import { useEffect } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useCreditBatches } from "@/hooks/use-credit-batches";
import type { CreditBatchWithRelations } from "@/data-access/credit-batches";

const CREDIT_BATCH_STORAGE_PREFIX =
  "noma:traceability:selected-credit-batch";
const EMPTY_CREDIT_BATCHES: CreditBatchWithRelations[] = [];

interface StorageLike {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

export type CreditBatchSelectionSource =
  | "url"
  | "application"
  | "remembered"
  | "first"
  | "none";

export interface CreditBatchSelectionResolution {
  batchId: string | null;
  source: CreditBatchSelectionSource;
}

interface ResolveCreditBatchSelectionInput {
  batches: ReadonlyArray<{ id: string }>;
  urlBatchId: string | null;
  applicationId: string | null;
  rememberedBatchId: string | null;
}

export function creditBatchStorageKey(facilityId: string): string {
  return `${CREDIT_BATCH_STORAGE_PREFIX}:${facilityId}`;
}

function browserStorage(): StorageLike | null {
  if (typeof window === "undefined") return null;

  try {
    return window.localStorage;
  } catch {
    return null;
  }
}

export function readRememberedCreditBatchId(
  facilityId: string,
  storage?: StorageLike | null,
): string | null {
  const target = storage === undefined ? browserStorage() : storage;
  if (!target) return null;

  try {
    return target.getItem(creditBatchStorageKey(facilityId));
  } catch {
    return null;
  }
}

export function writeRememberedCreditBatchId(
  facilityId: string,
  batchId: string | null,
  storage?: StorageLike | null,
): void {
  const target = storage === undefined ? browserStorage() : storage;
  if (!target) return;

  try {
    if (batchId) {
      target.setItem(creditBatchStorageKey(facilityId), batchId);
    } else {
      target.removeItem(creditBatchStorageKey(facilityId));
    }
  } catch {
    // Storage can be unavailable in private browsing or blocked by policy.
  }
}

/**
 * Resolve a facility-scoped batch without allowing a remembered value to
 * override a valid URL or a standalone application deep link.
 */
export function resolveCreditBatchSelection({
  batches,
  urlBatchId,
  applicationId,
  rememberedBatchId,
}: ResolveCreditBatchSelectionInput): CreditBatchSelectionResolution {
  const hasBatch = (batchId: string | null) =>
    Boolean(batchId && batches.some((batch) => batch.id === batchId));

  if (hasBatch(urlBatchId)) {
    return { batchId: urlBatchId, source: "url" };
  }

  if (applicationId) {
    return { batchId: null, source: "application" };
  }

  if (hasBatch(rememberedBatchId)) {
    return { batchId: rememberedBatchId, source: "remembered" };
  }

  const firstBatchId = batches[0]?.id ?? null;
  return firstBatchId
    ? { batchId: firstBatchId, source: "first" }
    : { batchId: null, source: "none" };
}

/**
 * Facility-scoped URL/localStorage synchronization for the card selector.
 * The existing newest-first list supplies the deterministic first fallback.
 */
export function useCreditBatchCardSelection(facilityId: string | null) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const selectedBatchId = searchParams.get("batch");
  const selectedApplicationId = searchParams.get("application");
  const query = useCreditBatches(facilityId ?? undefined);
  const batches = query.data ?? EMPTY_CREDIT_BATCHES;
  const validSelectedBatchId =
    query.isSuccess && selectedBatchId
      ? (batches.find((batch) => batch.id === selectedBatchId)?.id ?? null)
      : null;

  useEffect(() => {
    if (!facilityId || !query.isSuccess) return;

    const rememberedBatchId = readRememberedCreditBatchId(facilityId);
    const resolution = resolveCreditBatchSelection({
      batches,
      urlBatchId: selectedBatchId,
      applicationId: selectedApplicationId,
      rememberedBatchId,
    });

    if (resolution.source === "url") return;

    // An invalid batch alongside an application must be discarded without
    // replacing the application's standalone deep link with another batch.
    if (resolution.source === "application") {
      if (!selectedBatchId) return;
      const params = new URLSearchParams(searchParams.toString());
      params.delete("batch");
      params.delete("run");
      const nextQuery = params.toString();
      router.replace(nextQuery ? `${pathname}?${nextQuery}` : pathname, {
        scroll: false,
      });
      return;
    }

    writeRememberedCreditBatchId(facilityId, resolution.batchId);

    if (selectedBatchId === resolution.batchId) return;

    const params = new URLSearchParams(searchParams.toString());
    params.delete("application");
    params.delete("run");
    params.delete("view");
    if (resolution.batchId) {
      params.set("batch", resolution.batchId);
    } else {
      params.delete("batch");
    }
    const nextQuery = params.toString();
    router.replace(nextQuery ? `${pathname}?${nextQuery}` : pathname, {
      scroll: false,
    });
  }, [
    batches,
    facilityId,
    pathname,
    query.isSuccess,
    router,
    searchParams,
    selectedApplicationId,
    selectedBatchId,
  ]);

  const selectBatch = (batchId: string) => {
    if (!facilityId || !batches.some((batch) => batch.id === batchId)) return;

    writeRememberedCreditBatchId(facilityId, batchId);
    const params = new URLSearchParams(searchParams.toString());
    params.delete("application");
    params.delete("run");
    params.delete("view");
    params.set("batch", batchId);
    router.replace(`${pathname}?${params.toString()}`, { scroll: false });
  };

  return {
    ...query,
    batches,
    selectedBatchId,
    validSelectedBatchId,
    selectBatch,
  };
}
