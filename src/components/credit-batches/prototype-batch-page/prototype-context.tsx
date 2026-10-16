"use client";

/** PROTOTYPE (throwaway): shared state for the credit batch page. */
import { createContext, useContext, type ReactNode } from "react";
import type { CreditBatchWithRelations, CreditBatchProductionRunOption } from "@/data-access/credit-batches";
import type { BatchModel, TabKey } from "./prototype-model";

export interface ProtoContextValue {
  batch: CreditBatchWithRelations;
  model: BatchModel;
  canManage: boolean;
  tab: TabKey;
  focus: string | null;
  /** Switch tab and optionally highlight a row there. */
  go: (tab: TabKey, focus?: string | null) => void;
  runs: CreditBatchProductionRunOption[];
  runsLoading: boolean;
  /** What an inert prototype button would do, shown under the tabs. */
  message: string | null;
  /** Inert prototype buttons call this to say what they would do. */
  say: (message: string) => void;
}

const ProtoContext = createContext<ProtoContextValue | null>(null);

export function ProtoProvider({ value, children }: { value: ProtoContextValue; children: ReactNode }) {
  return <ProtoContext.Provider value={value}>{children}</ProtoContext.Provider>;
}

export function useProto(): ProtoContextValue {
  const value = useContext(ProtoContext);
  if (!value) throw new Error("useProto needs a ProtoProvider");
  return value;
}
