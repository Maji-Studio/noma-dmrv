"use client";

import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { FileIcon } from "@phosphor-icons/react/dist/ssr";
import { FormFileUpload, ServerError } from "@/components/forms";
import { FailedDeferredAttachments } from "@/components/forms/failed-deferred-attachments";
import { DeleteConfirmDialog } from "@/components/ui/delete-confirm-dialog";
import { useToast } from "@/components/ui/toast";
import { applicationKeys } from "@/hooks/use-applications";
import type { UseDeferredAttachmentsResult } from "@/hooks/use-deferred-attachments";
import {
  documentKeys,
  useDeleteDocument,
  useDocumentsForEntity,
} from "@/hooks/use-documents";
import {
  APPLICATION_VISUAL_EVIDENCE_DOCUMENT_TYPE,
  isApplicationIsometricSourceDocumentType,
} from "@/lib/certification/application-evidence";
import type { DocumentEntityType, DocumentType } from "@/schemas/documents";
import {
  ApplicationEvidenceDocumentList,
  isUploadedDocument,
} from "./application-evidence-document-list";

const ENTITY_TYPE = "application" satisfies DocumentEntityType;
const DOCUMENT_TYPE: DocumentType = "pdf";
const SUPPORTING_EVIDENCE_ACCEPT = "image/*,application/pdf,.pdf";

function resolveSupportingEvidenceDocumentType(file: File): DocumentType {
  return file.type.toLowerCase().startsWith("image/")
    ? APPLICATION_VISUAL_EVIDENCE_DOCUMENT_TYPE
    : DOCUMENT_TYPE;
}
interface ApplicationSupportingEvidencePanelProps {
  applicationId?: string;
  disabled?: boolean;
  deferredAttachments?: UseDeferredAttachmentsResult;
  readOnly?: boolean;
}

export function ApplicationSupportingEvidencePanel({
  applicationId,
  disabled = false,
  deferredAttachments,
  readOnly = false,
}: ApplicationSupportingEvidencePanelProps) {
  const toast = useToast();
  const queryClient = useQueryClient();
  const [deleteId, setDeleteId] = useState<string | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const { data: docs, isLoading, error } = useDocumentsForEntity(
    ENTITY_TYPE,
    applicationId,
    { enabled: !!applicationId },
  );
  const invalidateKey = applicationId
    ? documentKeys.forEntity(ENTITY_TYPE, applicationId)
    : undefined;
  const deleteMutation = useDeleteDocument(invalidateKey, {
    entityType: ENTITY_TYPE,
  });
  const supportingDocs = (docs ?? [])
    .filter(isUploadedDocument)
    .filter(
      (doc) =>
        doc.documentType === "gis_boundary" ||
        isApplicationIsometricSourceDocumentType(doc.documentType),
    );

  const invalidateApplicationLists = () => {
    queryClient.invalidateQueries({ queryKey: applicationKeys.lists() });
  };

  const handleDelete = async () => {
    if (!deleteId) return;
    setErrorMessage(null);
    try {
      await deleteMutation.mutateAsync(deleteId);
      invalidateApplicationLists();
      toast.success("Supporting evidence deleted");
      setDeleteId(null);
    } catch (deleteError) {
      setErrorMessage(
        deleteError instanceof Error
          ? deleteError.message
          : "The supporting evidence was not deleted. Try again.",
      );
    }
  };

  const upload = applicationId ? (
    <FormFileUpload
      id={`application-${applicationId}-supporting-evidence-upload`}
      accept={SUPPORTING_EVIDENCE_ACCEPT}
      disabled={disabled}
      entityType={ENTITY_TYPE}
      entityId={applicationId}
      resolveDocumentType={resolveSupportingEvidenceDocumentType}
      onUploaded={() => {
        setErrorMessage(null);
        invalidateApplicationLists();
      }}
      onUploadError={(uploadError) => setErrorMessage(uploadError)}
    />
  ) : (
    <FormFileUpload
      id="application-create-supporting-evidence-upload"
      accept={SUPPORTING_EVIDENCE_ACCEPT}
      disabled={disabled}
      deferred
      deferredFiles={(deferredAttachments?.attachments ?? []).filter(
        (attachment) =>
          attachment.documentType === DOCUMENT_TYPE ||
          attachment.documentType ===
            APPLICATION_VISUAL_EVIDENCE_DOCUMENT_TYPE,
      )}
      onDeferredAdd={(files) => {
        for (const file of files) {
          deferredAttachments?.add(
            [file],
            resolveSupportingEvidenceDocumentType(file),
          );
        }
      }}
      onDeferredRemove={(key) => deferredAttachments?.remove(key)}
    />
  );

  return (
    <div className="flex flex-col gap-16">
      {(error || errorMessage) && (
        <ServerError
          message={
            errorMessage ??
            (error instanceof Error
              ? error.message
              : "The supporting evidence could not be loaded. Refresh the page and try again.")
          }
        />
      )}

      {isLoading && applicationId ? (
        <p className="body-small text-[var(--color-text-secondary)]">
          Loading supporting evidence...
        </p>
      ) : supportingDocs.length > 0 || readOnly ? (
        <ApplicationEvidenceDocumentList
          docs={supportingDocs}
          emptyMessage="No supporting evidence attached yet."
          disabled={disabled}
          deleteMutationPending={deleteMutation.isPending}
          onDelete={readOnly ? undefined : setDeleteId}
        />
      ) : null}

      {!readOnly && (
        <div className="flex flex-col gap-8">
          <div className="flex items-center gap-8">
            <FileIcon size={18} weight="bold" />
            <h4 className="body-medium font-medium">Images and PDFs</h4>
          </div>
          {upload}
        </div>
      )}

      {!readOnly && applicationId && deferredAttachments && (
        <FailedDeferredAttachments
          attachments={deferredAttachments.attachments}
          onRetry={async (key) => {
            const result = await deferredAttachments.retry(
              ENTITY_TYPE,
              [applicationId],
              key,
            );
            if (result.uploaded.length > 0) invalidateApplicationLists();
          }}
          onRemove={deferredAttachments.remove}
          disabled={disabled}
        />
      )}

      {!readOnly && (
        <DeleteConfirmDialog
          isOpen={!!deleteId}
          title="Delete Supporting Evidence"
          message="Are you sure you want to delete this supporting file?"
          onConfirm={handleDelete}
          onCancel={() => {
            setDeleteId(null);
            setErrorMessage(null);
          }}
          isPending={deleteMutation.isPending}
        />
      )}
    </div>
  );
}
