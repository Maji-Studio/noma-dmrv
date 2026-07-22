"use client";

import { useState } from "react";
import {
  useDeferredAttachments,
  type DeferredAttachment,
  type DeferredAttachmentFlushResult,
  type UseDeferredAttachmentsResult,
} from "@/hooks/use-deferred-attachments";

interface CreatedEntity {
  id: string;
}

export interface CreatedWithEvidence<TEntity extends CreatedEntity, TResult> {
  entities: readonly TEntity[];
  result: TResult;
}

export interface AfterEvidenceFlushResult {
  failureMessage?: string;
  clearAttachmentsOnFailure?: boolean;
}

export interface EvidenceFlushContext<TEntity extends CreatedEntity, TResult> {
  created: CreatedWithEvidence<TEntity, TResult>;
  flushResult: DeferredAttachmentFlushResult;
}

interface CreateWithEvidenceChoreographyOptions<
  TInput,
  TEntity extends CreatedEntity,
  TResult,
> {
  input: TInput;
  entityType: string;
  entityNoun: string;
  executeCreate: (
    input: TInput,
  ) => Promise<CreatedWithEvidence<TEntity, TResult>>;
  flushMany: UseDeferredAttachmentsResult["flushMany"];
  clearAttachments: () => void;
  retainCreatedEntityIds: (entityIds: string[]) => void;
  setFlushing: (isFlushing: boolean) => void;
  setError: (message: string | null) => void;
  getCreateErrorMessage: (error: unknown) => string;
  openEditOnFailure: (entity: TEntity) => void;
  closeOnSuccess: () => void;
  onAfterFlush?: (
    context: EvidenceFlushContext<TEntity, TResult>,
  ) => Promise<AfterEvidenceFlushResult | void> | AfterEvidenceFlushResult | void;
  onFlushSuccess?: (
    context: EvidenceFlushContext<TEntity, TResult>,
  ) => Promise<void> | void;
  onSuccess: (created: CreatedWithEvidence<TEntity, TResult>) => void;
}

export async function runCreateWithEvidenceChoreography<
  TInput,
  TEntity extends CreatedEntity,
  TResult,
>(
  options: CreateWithEvidenceChoreographyOptions<TInput, TEntity, TResult>,
): Promise<void> {
  options.setError(null);
  try {
    const created = await options.executeCreate(options.input);
    const firstEntity = created.entities[0];
    if (!firstEntity) {
      throw new Error(`${options.entityNoun} creation returned no entity`);
    }

    const entityIds = created.entities.map((entity) => entity.id);
    options.retainCreatedEntityIds(entityIds);
    options.setFlushing(true);

    const flushResult = await options.flushMany(
      options.entityType,
      entityIds,
    );
    const context = { created, flushResult };
    const afterFlushResult = await options.onAfterFlush?.(context);
    const failureMessage =
      afterFlushResult?.failureMessage ??
      (!flushResult.ok
        ? `${options.entityNoun} created, but ${flushResult.failed.length} ${flushResult.failed.length === 1 ? "attachment" : "attachments"} failed to upload.`
        : undefined);

    if (failureMessage) {
      if (afterFlushResult?.clearAttachmentsOnFailure) {
        options.clearAttachments();
      }
      options.openEditOnFailure(firstEntity);
      options.setError(failureMessage);
      return;
    }

    options.clearAttachments();
    await options.onFlushSuccess?.(context);
    options.closeOnSuccess();
    options.onSuccess(created);
  } catch (error) {
    options.setError(options.getCreateErrorMessage(error));
  } finally {
    options.setFlushing(false);
  }
}

export interface ConfirmCreateCloseOptions {
  isFlushing: boolean;
  isCreateMode: boolean;
  unsavedAttachmentCount: number;
  confirmDiscard: (message: string) => boolean;
}

interface GuardCreateWithEvidenceUpdateOptions {
  attachments: readonly Pick<DeferredAttachment, "status">[];
  hasAdditionalUnresolved?: boolean;
  message: string;
  setError: (message: string) => void;
}

export function guardCreateWithEvidenceUpdate({
  attachments,
  hasAdditionalUnresolved = false,
  message,
  setError,
}: GuardCreateWithEvidenceUpdateOptions): boolean {
  const hasUnresolvedAttachments = attachments.some(
    (attachment) => attachment.status !== "uploaded",
  );
  if (!hasAdditionalUnresolved && !hasUnresolvedAttachments) return false;
  setError(message);
  return true;
}

export function confirmCreateWithEvidenceClose({
  isFlushing,
  isCreateMode,
  unsavedAttachmentCount,
  confirmDiscard,
}: ConfirmCreateCloseOptions): boolean {
  if (isFlushing) return false;
  return (
    !isCreateMode ||
    unsavedAttachmentCount === 0 ||
    confirmDiscard(
      `Discard ${unsavedAttachmentCount} unsaved attachment(s)?`,
    )
  );
}

export interface UseCreateWithEvidenceOptions<
  TInput,
  TEntity extends CreatedEntity,
  TResult,
> {
  entityType: string;
  entityNoun: string;
  executeCreate: (
    input: TInput,
  ) => Promise<CreatedWithEvidence<TEntity, TResult>>;
  setError: (message: string | null) => void;
  setUpdateError: (message: string) => void;
  getCreateErrorMessage: (error: unknown) => string;
  unresolvedUpdateMessage: string;
  openEditOnFailure: (entity: TEntity) => void;
  closeOnSuccess: () => void;
  onAfterFlush?: (
    context: EvidenceFlushContext<TEntity, TResult>,
  ) => Promise<AfterEvidenceFlushResult | void> | AfterEvidenceFlushResult | void;
  onFlushSuccess?: (
    context: EvidenceFlushContext<TEntity, TResult>,
  ) => Promise<void> | void;
  onSuccess: (created: CreatedWithEvidence<TEntity, TResult>) => void;
}

export interface UseCreateWithEvidenceResult<TInput> {
  deferredAttachments: UseDeferredAttachmentsResult;
  createdEntityIds: string[];
  isFlushing: boolean;
  unsavedAttachmentCount: number;
  handleCreate: (input: TInput) => Promise<void>;
  guardUpdate: (hasAdditionalUnresolved?: boolean) => boolean;
  confirmClose: (
    isCreateMode: boolean,
    additionalUnsavedCount?: number,
  ) => boolean;
  reset: () => void;
  runWhileFlushing: <T>(task: () => Promise<T>) => Promise<T>;
}

export function useCreateWithEvidence<
  TInput,
  TEntity extends CreatedEntity,
  TResult,
>(
  options: UseCreateWithEvidenceOptions<TInput, TEntity, TResult>,
): UseCreateWithEvidenceResult<TInput> {
  const deferredAttachments = useDeferredAttachments();
  const [createdEntityIds, setCreatedEntityIds] = useState<string[]>([]);
  const [isFlushing, setIsFlushing] = useState(false);
  const unsavedAttachmentCount = deferredAttachments.attachments.filter(
    (attachment) => attachment.status !== "uploaded",
  ).length;

  function handleCreate(input: TInput) {
    return runCreateWithEvidenceChoreography({
      ...options,
      input,
      flushMany: deferredAttachments.flushMany,
      clearAttachments: deferredAttachments.clear,
      retainCreatedEntityIds: setCreatedEntityIds,
      setFlushing: setIsFlushing,
    });
  }

  function guardUpdate(hasAdditionalUnresolved = false): boolean {
    return guardCreateWithEvidenceUpdate({
      attachments: deferredAttachments.attachments,
      hasAdditionalUnresolved,
      message: options.unresolvedUpdateMessage,
      setError: options.setUpdateError,
    });
  }

  function confirmClose(
    isCreateMode: boolean,
    additionalUnsavedCount = 0,
  ): boolean {
    return confirmCreateWithEvidenceClose({
      isFlushing,
      isCreateMode,
      unsavedAttachmentCount:
        unsavedAttachmentCount + additionalUnsavedCount,
      confirmDiscard: (message) => window.confirm(message),
    });
  }

  function reset() {
    deferredAttachments.clear();
    setCreatedEntityIds([]);
  }

  async function runWhileFlushing<T>(task: () => Promise<T>): Promise<T> {
    setIsFlushing(true);
    try {
      return await task();
    } finally {
      setIsFlushing(false);
    }
  }

  return {
    deferredAttachments,
    createdEntityIds,
    isFlushing,
    unsavedAttachmentCount,
    handleCreate,
    guardUpdate,
    confirmClose,
    reset,
    runWhileFlushing,
  };
}
