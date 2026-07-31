"use client";

import { FileCsvIcon } from "@phosphor-icons/react/dist/ssr";
import {
  FormField,
  FormSection,
  resolveCertFieldStatus,
} from "@/components/forms";
import { useDocumentsForEntity } from "@/hooks/use-documents";
import type { UseDeferredAttachmentsResult } from "@/hooks/use-deferred-attachments";
import { isCertifyFormField } from "@/lib/certification/certify-field-registry";
import {
  isUploadedReadingsDocument,
  ProductionReadingsDocuments,
} from "./production-readings-documents";

interface ProductionReadingsFieldProps {
  productionRunId?: string;
  deferredAttachments?: UseDeferredAttachmentsResult;
  disabled?: boolean;
}

/**
 * Form wrapper for the persisted readings-file evidence requirement. The chip
 * stays neutral until an existing run's saved documents have loaded.
 */
export function ProductionReadingsField({
  productionRunId,
  deferredAttachments,
  disabled = false,
}: ProductionReadingsFieldProps) {
  const { data: documents, isLoading } = useDocumentsForEntity(
    "production_run",
    productionRunId,
  );
  const hasReadingsFile = (documents ?? []).some(isUploadedReadingsDocument);
  const hasLoadedSavedRun =
    productionRunId === undefined || isLoading ? undefined : true;

  return (
    <FormSection
      title="Readings file"
      icon={<FileCsvIcon size={14} weight="bold" />}
    >
      <FormField
        id="readingsCsv"
        label="Readings CSV file"
        helperText="noma stores the original CSV unchanged and does not inspect its contents."
        certifyRequired={isCertifyFormField("productionRun", "readingsCsv")}
        certifyStatus={resolveCertFieldStatus(
          hasLoadedSavedRun,
          hasReadingsFile,
        )}
      >
        <ProductionReadingsDocuments
          productionRunId={productionRunId}
          deferredAttachments={deferredAttachments}
          disabled={disabled}
        />
      </FormField>
    </FormSection>
  );
}
