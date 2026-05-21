"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  confirmUpload,
  deleteDocument,
  getDocumentsForEntity,
  requestUpload,
  setDocumentVisibility,
  type RequestUploadResult,
} from "@/fn/documents";
import type { DocumentVisibility } from "@/schemas/documents";

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

export function useDeleteDocument(invalidateKey?: readonly unknown[]) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (documentId: string) => {
      const res = await deleteDocument({ documentId });
      if (!res.success) throw new Error(res.error);
      return res.data;
    },
    onSuccess: () => {
      if (invalidateKey) qc.invalidateQueries({ queryKey: invalidateKey });
    },
  });
}
