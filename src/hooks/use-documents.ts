"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  confirmUpload,
  deleteDocument,
  getDocumentsForEntity,
  requestUpload,
  setDocumentVisibility,
  updateApplicationEvidenceMetadata,
  type RequestUploadResult,
} from "@/fn/documents";
import type { DocumentVisibility } from "@/schemas/documents";
import { feedstockKeys } from "./use-feedstocks";
import { deliveryKeys } from "./use-deliveries";
import { dashboardOverviewKeys } from "./use-dashboard-overview";
import { invalidateCertificationReadiness } from "./use-certification";
import { transportLegKeys } from "./use-transport-legs";
import { productionRunKeys } from "./use-production-runs";

function invalidateTransportEvidenceOwner(
  queryClient: ReturnType<typeof useQueryClient>,
  row: { entityType: string },
) {
  queryClient.invalidateQueries({ queryKey: dashboardOverviewKeys.all });
  // Evidence feeds certification readiness (removal overview, batch health,
  // New Removal wizard) and the leg lists' embedded evidence counts — leaving
  // either fresh for its stale window shows pre-mutation readiness, including
  // stale green after a deletion.
  invalidateCertificationReadiness(queryClient);
  queryClient.invalidateQueries({ queryKey: transportLegKeys.all });
  if (row.entityType === "feedstock") {
    queryClient.invalidateQueries({ queryKey: feedstockKeys.all });
  }
  if (row.entityType === "delivery") {
    queryClient.invalidateQueries({ queryKey: deliveryKeys.all });
  }
}

type DocumentOwner =
  | { entityType: "production_run"; entityId: string }
  | {
      entityType: "application" | "feedstock" | "delivery" | "transport_leg";
      entityId?: string;
    };

export function invalidateDocumentOwner(
  queryClient: ReturnType<typeof useQueryClient>,
  owner: { entityType: string; entityId: string },
) {
  if (owner.entityType === "production_run") {
    queryClient.invalidateQueries({ queryKey: productionRunKeys.lists() });
    queryClient.invalidateQueries({
      queryKey: productionRunKeys.detail(owner.entityId),
    });
    // Preserve the shared evidence invalidations that every completed upload
    // already triggered, then refresh the projections unique to run evidence.
    invalidateTransportEvidenceOwner(queryClient, owner);
    return;
  }

  invalidateTransportEvidenceOwner(queryClient, owner);
}

export function invalidateDeletedDocumentOwner(
  queryClient: ReturnType<typeof useQueryClient>,
  owner: DocumentOwner,
) {
  if (owner.entityType === "production_run") {
    return invalidateDocumentOwner(queryClient, owner);
  }
  if (owner.entityType === "application") {
    return invalidateCertificationReadiness(queryClient);
  }
  invalidateTransportEvidenceOwner(queryClient, owner);
}

export const documentKeys = {
  all: ["documents"] as const,
  forEntity: (entityType: string, entityId: string) =>
    [...documentKeys.all, entityType, entityId] as const,
};

export function useDocumentsForEntity(
  entityType: string,
  entityId: string | null | undefined,
  options?: { enabled?: boolean }
) {
  return useQuery({
    queryKey: documentKeys.forEntity(entityType, entityId ?? "__none__"),
    enabled: !!entityId && options?.enabled !== false,
    queryFn: async () => {
      if (!entityId) return [];
      const res = await getDocumentsForEntity(entityType, entityId);
      if (!res.success) throw new Error(res.error);
      return res.data;
    },
  });
}

export function useRequestUpload() {
  return useMutation({
    mutationFn: async (
      input: Parameters<typeof requestUpload>[0]
    ): Promise<RequestUploadResult> => {
      const res = await requestUpload(input);
      if (!res.success) throw new Error(res.error);
      return res.data;
    },
  });
}

export function useConfirmUpload() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (documentId: string) => {
      const res = await confirmUpload({ documentId });
      if (!res.success) throw new Error(res.error);
      return res.data;
    },
    onSuccess: (row) => {
      qc.invalidateQueries({
        queryKey: documentKeys.forEntity(row.entityType, row.entityId),
      });
      invalidateDocumentOwner(qc, row);
    },
  });
}

export function useSetDocumentVisibility(invalidateKey?: readonly unknown[]) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: {
      documentId: string;
      visibility: DocumentVisibility;
    }) => {
      const res = await setDocumentVisibility(input);
      if (!res.success) throw new Error(res.error);
      return res.data;
    },
    onSuccess: () => {
      if (invalidateKey) qc.invalidateQueries({ queryKey: invalidateKey });
    },
  });
}

export function useUpdateApplicationEvidenceMetadata(
  invalidateKey?: readonly unknown[],
) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (
      input: Parameters<typeof updateApplicationEvidenceMetadata>[0],
    ) => {
      const res = await updateApplicationEvidenceMetadata(input);
      if (!res.success) throw new Error(res.error);
      return res.data;
    },
    onSuccess: (row) => {
      qc.invalidateQueries({
        queryKey: invalidateKey ?? documentKeys.forEntity(row.entityType, row.entityId),
      });
      invalidateCertificationReadiness(qc);
    },
  });
}

export function useDeleteDocument(
  invalidateKey?: readonly unknown[],
  owner?: DocumentOwner,
) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (documentId: string) => {
      const res = await deleteDocument({ documentId });
      if (!res.success) throw new Error(res.error);
      return res.data;
    },
    onSuccess: () => {
      if (invalidateKey) qc.invalidateQueries({ queryKey: invalidateKey });
      if (owner) invalidateDeletedDocumentOwner(qc, owner);
    },
  });
}
