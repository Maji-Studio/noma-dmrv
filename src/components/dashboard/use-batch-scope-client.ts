/**
 * Computes a `DashboardBatchScopeView` on the client: one credit batch, or
 * every credit batch at the facility unioned (each batch's own roll-up,
 * deduped by record), so "All credit batches" counts only records traceable to
 * a batch. One roll-up read per batch.
 */
"use client";

import { useQueries } from "@tanstack/react-query";
import { buildLineageNodes, buildRollForwardNodes } from "@/components/chain-of-custody/use-chain-graph";
import type { LineageNodeKind } from "@/components/chain-of-custody/chain-constants";
import type { DashboardStationKey } from "@/data-access/dashboard-overview";
import { getCreditBatchChainFn } from "@/fn/chain-of-custody";
import { chainOfCustodyKeys } from "@/hooks/use-chain-of-custody";
import { unwrap } from "@/hooks/types";
import { useCreditBatches } from "@/hooks/use-credit-batches";
import { useFacilityClock } from "@/hooks/use-facility-context";
import { sumNullable } from "@/lib/nullable-sum";
import type { DashboardBatchScopeView } from "./batch-scope";

const KG_PER_TONNE = 1000;
const CHAIN_STALE_TIME_MS = 30_000;

/** Lineage node kinds behind each stage's count. Suppliers come from the feedstocks. */
const STAGE_NODE_KIND: Partial<Record<DashboardStationKey, LineageNodeKind>> = {
  feedstock: "feedstock",
  production: "productionRun",
  products: "biocharProduct",
  deliveries: "delivery",
  applications: "application",
};

const STAGE_KEYS = ["suppliers", "feedstock", "production", "products", "deliveries", "applications"] as const;

interface BatchScopeResult {
  data: DashboardBatchScopeView | undefined;
  isLoading: boolean;
  error: Error | null;
}

export function useBatchScopeClient(facilityId: string, creditBatchId: string | null): BatchScopeResult {
  const { timeZone } = useFacilityClock(facilityId);
  const batchesQuery = useCreditBatches(facilityId);
  const all = batchesQuery.data ?? [];
  const batch = all.find((item) => item.id === creditBatchId) ?? null;
  const chosen = batch ? [batch] : all;
  const chains = useQueries({
    queries: chosen.map((item) => ({
      queryKey: chainOfCustodyKeys.batch(item.id),
      queryFn: async () => unwrap(await getCreditBatchChainFn(item.id)),
      staleTime: CHAIN_STALE_TIME_MS,
    })),
  });

  const error = (batchesQuery.error as Error | null) ?? (chains.find((query) => query.error)?.error as Error | null) ?? null;
  if (error) return { data: undefined, isLoading: false, error };
  if (batchesQuery.isLoading || !chains.every((query) => query.data)) {
    return { data: undefined, isLoading: true, error: null };
  }

  const datas = chains.map((query) => query.data!);
  const lineages = datas.flatMap((data) => data.lineages);
  const rollForwards = datas.flatMap((data) => data.rollForwards);
  const nodes = new Map(
    [
      ...lineages.flatMap((lineage) => buildLineageNodes(lineage.chain, timeZone)),
      ...buildRollForwardNodes(rollForwards, timeZone),
    ].map((node) => [node.id, node]),
  );
  const countOf = (kind: LineageNodeKind) => [...nodes.values()].filter((node) => node.kind === kind).length;
  const suppliers = new Set(
    rollForwards.flatMap((rollForward) => rollForward.source.feedstocks.map((feedstock) => feedstock.supplierName)).filter(Boolean),
  );
  const stationTotals = Object.fromEntries(
    STAGE_KEYS.map((key) => {
      const kind = STAGE_NODE_KIND[key];
      return [key, kind ? countOf(kind) : suppliers.size];
    }),
  ) as Record<DashboardStationKey, number>;

  // A run or an application can sit in one batch only, but dedupe anyway.
  const runs = [...new Map(rollForwards.map((rollForward) => [rollForward.source.productionRun.id, rollForward.source.productionRun])).values()];
  const applied = new Map(lineages.map((lineage) => [lineage.chain.application.id, lineage.chain.application.biocharAppliedDryTons]));
  const feedstockKg = sumNullable(runs.map((run) => run.feedstockMassDryKg));
  const biocharKg = sumNullable(runs.map((run) => run.biocharDryMassKg));
  // CO₂e only when every chosen batch has an estimate: a partial sum would understate it.
  const co2eTonnes = chosen.every((item) => item.co2eStoredPreview?.co2eStoredTonnes != null)
    ? sumNullable(chosen.map((item) => item.co2eStoredPreview?.co2eStoredTonnes))
    : null;

  return {
    isLoading: false,
    error: null,
    data: {
      batchIds: chosen.map((item) => item.id),
      stationTotals,
      kpis: {
        feedstockProcessedDryTonnes: feedstockKg == null ? null : feedstockKg / KG_PER_TONNE,
        biocharProducedDryTonnes: biocharKg == null ? null : biocharKg / KG_PER_TONNE,
        // No applications is a true zero; applications with no recorded mass are unknown.
        appliedToSoilDryTonnes: applied.size === 0 ? 0 : sumNullable([...applied.values()]),
        co2eStoredTonnes: co2eTonnes,
      },
      recordIds: [...chosen.map((item) => item.id), ...[...nodes.keys()].map((id) => id.slice(id.indexOf(":") + 1))],
    },
  };
}
