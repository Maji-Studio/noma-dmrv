"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  canChangeDocumentVisibility,
  updateApplicationEvidenceMetadata,
  confirmUpload,
  deleteDocument,
  getDocumentsForEntity,
  requestUpload,
  setDocumentVisibility,
  type RequestUploadResult,
} from "@/fn/documents";
import type { DocumentVisibility } from "@/schemas/documents";
import { throwActionError, StaleVersionError } from "@/lib/stale-version";
import type { ActionResult } from "@/types/actions";
import type { z } from "zod";
import type { updateApplicationEvidenceMetadataSchema } from "@/schemas/documents";

import { feedstockKeys } from "./use-feedstocks";
import { deliveryKeys } from "./use-deliveries";
import { dashboardOverviewKeys } from "./use-dashboard-overview";
import { invalidateCertificationReadiness } from "./use-certification";
import { transportLegKeys } from "./use-transport-legs";
import { productionRunKeys } from "./use-production-runs";
import { activityKeys } from "./activity-query-keys";

function unwrap<T>(result: ActionResult<T>): T {
  if (!result.success) throwActionError(result);
  return result.data;
}

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
      entityType: "application" | "feedstock" | "delivery" | "transport_leg" | "sample" | "credit_batch";
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
      return unwrap(await getDocumentsForEntity(entityType, entityId));
    },
  });
}

export function useRequestUpload() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (
      input: Parameters<typeof requestUpload>[0]
    ): Promise<RequestUploadResult> => unwrap(await requestUpload(input)),
    // The request records the document's creation in the owner's batch activity.
    onSuccess: () => qc.invalidateQueries({ queryKey: activityKeys.all }),
  });
}

export function useConfirmUpload() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (documentId: string) => unwrap(await confirmUpload({ documentId })),
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
      expectedVersion: number;
    }) => unwrap(await setDocumentVisibility(input)),
    onError: (error) => {
      if (error instanceof StaleVersionError && invalidateKey) qc.invalidateQueries({ queryKey: invalidateKey });
    },
    onSuccess: () => {
      if (invalidateKey) qc.invalidateQueries({ queryKey: invalidateKey });
      // A visibility change is a recorded document update.
      void qc.invalidateQueries({ queryKey: activityKeys.all });
    },
  });
}

export function useDeleteDocument(
  invalidateKey?: readonly unknown[],
  owner?: DocumentOwner,
) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: { documentId: string; expectedVersion: number }) => unwrap(await deleteDocument(input)),
    onError: (error) => {
      if (error instanceof StaleVersionError && invalidateKey) qc.invalidateQueries({ queryKey: invalidateKey });
    },
    onSuccess: () => {
      if (invalidateKey) qc.invalidateQueries({ queryKey: invalidateKey });
      if (owner) invalidateDeletedDocumentOwner(qc, owner);
      void qc.invalidateQueries({ queryKey: activityKeys.all });
    },
  });
}

export function useCanChangeDocumentVisibility() {
  return useQuery({
    queryKey: [...documentKeys.all, "canChangeVisibility"],
    queryFn: async () => unwrap(await canChangeDocumentVisibility()),
  }).data === true;
}

export function useReclassifyApplicationEvidence() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: z.infer<typeof updateApplicationEvidenceMetadataSchema> & { expectedVersion: number }) => unwrap(await updateApplicationEvidenceMetadata(input)),
    onSuccess: (row) => {
      qc.invalidateQueries({ queryKey: documentKeys.forEntity(row.entityType, row.entityId) });
      invalidateDocumentOwner(qc, row);
    },
    onError: (error) => {
      if (error instanceof StaleVersionError) qc.invalidateQueries({ queryKey: documentKeys.all });
    },
  });
}
