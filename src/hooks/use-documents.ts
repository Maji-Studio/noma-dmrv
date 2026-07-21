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

function invalidateTransportEvidenceOwner(
  queryClient: ReturnType<typeof useQueryClient>,
  row: { entityType: string },
) {
  queryClient.invalidateQueries({ queryKey: dashboardOverviewKeys.all });
  if (row.entityType === "feedstock") {
    queryClient.invalidateQueries({ queryKey: feedstockKeys.all });
  }
  if (row.entityType === "delivery") {
    queryClient.invalidateQueries({ queryKey: deliveryKeys.all });
  }
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
      invalidateTransportEvidenceOwner(qc, row);
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
    },
  });
}

export function useDeleteDocument(
  invalidateKey?: readonly unknown[],
  owner?: { entityType: string },
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
      if (owner) invalidateTransportEvidenceOwner(qc, owner);
    },
  });
}
