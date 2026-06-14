"use client";

import { useState } from "react";
import { File, Trash, ArrowSquareOut, Warning } from "@phosphor-icons/react/dist/ssr";
import { FormField, FormSelect, ServerError } from "@/components/forms";
import { FormFileUpload } from "@/components/forms/form-file-upload";
import { DeleteConfirmDialog } from "@/components/ui/delete-confirm-dialog";
import { Button } from "@/components/ui/button";
import { useToast } from "@/components/ui/toast";
import { formatFileSize } from "@/lib/format-utils";
import {
  documentKeys,
  useDeleteDocument,
  useDocumentsForEntity,
} from "@/hooks/use-documents";
import {
  useImportProductionRunReadings,
  usePreviewProductionRunReadingsImport,
} from "@/hooks/use-production-run-reading-imports";
import type { DocumentEntityType, DocumentType } from "@/schemas/documents";
import type { ReactorDayCsvMappingInput } from "@/schemas/production-run-reading-imports";
import type { ProductionRunReadingsImportPreview } from "@/fn/production-run-reading-imports";

interface ProductionReadingsDocumentsProps {
  productionRunId: string;
  /** View mode hides the upload control and delete actions. */
  readOnly?: boolean;
}

const READINGS_DOC_TYPE: DocumentType = "sensor_data";
const ENTITY_TYPE: DocumentEntityType = "production_run";
const READINGS_ACCEPT = ".csv";
const READINGS_MAX_MB = 25;
const EMPTY_SELECT_VALUE = "";

function WarningBanner({ messages }: { messages: string[] }) {
  if (messages.length === 0) return null;

  return (
    <div className="flex items-start gap-8 border border-[var(--color-signal-orange)] bg-[var(--color-signal-orange)]/10 p-12 text-[var(--color-signal-orange-strong)]">
      <Warning size={16} weight="fill" className="mt-2 shrink-0" />
      <div className="space-y-4 body-small" role="alert" aria-live="polite">
        {messages.map((message) => (
          <p key={message}>{message}</p>
        ))}
      </div>
    </div>
  );
}

/**
 * Readings CSV upload + file list for a production run, persisted as
 * `sensor_data` documents through the real presigned storage flow
 * (local-fs in dev, S3-compatible when configured). Mirrors
 * `SampleDocumentsPanel`; readings are operational evidence, so there is no
 * buyer-facing visibility toggle here.
 */
export function ProductionReadingsDocuments({
  productionRunId,
  readOnly = false,
}: ProductionReadingsDocumentsProps) {
  const toast = useToast();
  const { data: docs, isLoading, error } = useDocumentsForEntity(
    ENTITY_TYPE,
    productionRunId,
  );
  const invalidateKey = documentKeys.forEntity(ENTITY_TYPE, productionRunId);
  const deleteMutation = useDeleteDocument(invalidateKey);
  const previewImport = usePreviewProductionRunReadingsImport();
  const importReadings = useImportProductionRunReadings();

  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [pendingPreview, setPendingPreview] =
    useState<ProductionRunReadingsImportPreview | null>(null);
  const [selectedMapping, setSelectedMapping] =
    useState<ReactorDayCsvMappingInput>({
      temperature: "",
      pressure: "",
      gasFlow: null,
    });

  const runImport = async (
    documentId: string,
    mapping?: ReactorDayCsvMappingInput,
  ) => {
    const result = await importReadings.mutateAsync({ documentId, mapping });
    setPendingPreview(null);
    setUploadError(null);
    const skippedRowsSuffix =
      result.skippedRows > 0 ? `, ${result.skippedRows} skipped` : "";
    toast.success(
      `Imported ${result.insertedRows} readings (${result.droppedRows} outside run window${skippedRowsSuffix})`,
    );
    if (result.warnings.length > 0) {
      toast.warning(result.warnings.join(" "));
    }
  };

  const handleUploaded = (documentId: string) => {
    setUploadError(null);
    void (async () => {
      try {
        const preview = await previewImport.mutateAsync(documentId);
        if (preview.requiresMapping) {
          setPendingPreview(preview);
          setSelectedMapping({
            temperature: preview.suggestedMapping.temperature,
            pressure: preview.suggestedMapping.pressure,
            gasFlow: preview.suggestedMapping.gasFlow ?? null,
          });
          toast.info("Confirm channel alignment to import readings.");
          return;
        }
        await runImport(documentId);
      } catch (err) {
        setUploadError(
          err instanceof Error ? err.message : "Failed to import readings",
        );
      }
    })();
  };

  const handleConfirmMapping = () => {
    if (!pendingPreview) return;
    setUploadError(null);
    void (async () => {
      try {
        await runImport(pendingPreview.documentId, selectedMapping);
      } catch (err) {
        setUploadError(
          err instanceof Error ? err.message : "Failed to import readings",
        );
      }
    })();
  };

  const handleDeleteConfirm = async () => {
    if (!deletingId) return;
    setDeleteError(null);
    try {
      await deleteMutation.mutateAsync(deletingId);
      toast.success("Readings file deleted");
      setDeletingId(null);
    } catch (err) {
      setDeleteError(
        err instanceof Error ? err.message : "Failed to delete file",
      );
    }
  };

  const uploadedDocs = (docs ?? []).filter(
    (d) =>
      d.documentType === READINGS_DOC_TYPE &&
      (d.uploadStatus === "uploaded" || d.fileUrl),
  );
  const isImporting = previewImport.isPending || importReadings.isPending;
  const headerOptions =
    pendingPreview?.headers.map((header) => ({
      value: header,
      label: header,
    })) ?? [];
  const gasFlowOptions = [
    { value: EMPTY_SELECT_VALUE, label: "No gas flow column" },
    ...headerOptions,
  ];

  return (
    <section className="flex flex-col gap-12">
      <header className="flex items-center justify-between">
        <span className="body-caption text-[var(--color-text-tertiary)]">
          {uploadedDocs.length} {uploadedDocs.length === 1 ? "file" : "files"}
        </span>
      </header>

      {error && (
        <ServerError
          message={
            error instanceof Error ? error.message : "Failed to load files"
          }
        />
      )}
      {uploadError && <ServerError message={uploadError} />}

      {isLoading ? (
        <p className="body-small text-[var(--color-text-secondary)]">
          Loading files…
        </p>
      ) : uploadedDocs.length === 0 ? (
        <p className="body-small text-[var(--color-text-secondary)]">
          No readings files uploaded yet.
        </p>
      ) : (
        <ul className="flex flex-col gap-8">
          {uploadedDocs.map((doc) => (
            <li
              key={doc.id}
              className="flex items-center gap-8 border border-[var(--color-border-tertiary)] px-12 py-8"
            >
              <File
                size={16}
                weight="bold"
                className="shrink-0 text-[var(--color-text-tertiary)]"
              />
              <div className="flex min-w-0 flex-1 flex-col">
                <span className="body-small truncate text-[var(--color-text-primary)]">
                  {doc.fileName}
                </span>
                <span className="body-caption text-[var(--color-text-tertiary)]">
                  Readings CSV · {formatFileSize(doc.fileSizeBytes)}
                </span>
              </div>
              <a
                href={`/api/documents/${doc.id}`}
                target="_blank"
                rel="noopener noreferrer"
                className="shrink-0 p-4 text-[var(--color-text-tertiary)] hover:text-[var(--color-interaction)] transition-colors duration-300"
                aria-label={`Open ${doc.fileName}`}
              >
                <ArrowSquareOut size={16} weight="bold" />
              </a>
              {!readOnly && (
                <Button
                  variant="destructive"
                  size="icon"
                  onClick={() => setDeletingId(doc.id)}
                  disabled={deleteMutation.isPending}
                  className="shrink-0"
                  aria-label={`Delete ${doc.fileName}`}
                >
                  <Trash size={16} weight="bold" />
                </Button>
              )}
            </li>
          ))}
        </ul>
      )}

      {!readOnly && (
        <>
          {pendingPreview && (
            <div className="space-y-12 border border-[var(--color-border-primary)] bg-[var(--color-background-light)] p-16">
              <div className="space-y-4">
                <p className="body-small font-medium text-[var(--color-text-primary)]">
                  Confirm channel alignment for {pendingPreview.fileName}
                </p>
                <p className="body-caption text-[var(--color-text-tertiary)]">
                  File reactor {pendingPreview.fileReactorCode} · Selected run{" "}
                  reactor {pendingPreview.runReactorCode} ·{" "}
                  Reactor-day {pendingPreview.fileDate} · Run date{" "}
                  {pendingPreview.runDate}
                </p>
              </div>

              <WarningBanner messages={pendingPreview.warnings} />

              <div className="grid gap-12 md:grid-cols-3">
                <FormField id="temperatureColumn" label="Temperature column">
                  <FormSelect
                    id="temperatureColumn"
                    options={headerOptions}
                    value={selectedMapping.temperature}
                    onChange={(event) =>
                      setSelectedMapping((current) => ({
                        ...current,
                        temperature: event.target.value,
                      }))
                    }
                    disabled={isImporting}
                  />
                </FormField>
                <FormField id="pressureColumn" label="Pressure column">
                  <FormSelect
                    id="pressureColumn"
                    options={headerOptions}
                    value={selectedMapping.pressure}
                    onChange={(event) =>
                      setSelectedMapping((current) => ({
                        ...current,
                        pressure: event.target.value,
                      }))
                    }
                    disabled={isImporting}
                  />
                </FormField>
                <FormField id="gasFlowColumn" label="Gas flow column">
                  <FormSelect
                    id="gasFlowColumn"
                    options={gasFlowOptions}
                    value={selectedMapping.gasFlow ?? EMPTY_SELECT_VALUE}
                    onChange={(event) =>
                      setSelectedMapping((current) => ({
                        ...current,
                        gasFlow: event.target.value || null,
                      }))
                    }
                    disabled={isImporting}
                  />
                </FormField>
              </div>

              <div className="flex justify-end gap-8">
                <Button
                  type="button"
                  variant="noOutline"
                  onClick={() => setPendingPreview(null)}
                  disabled={isImporting}
                >
                  Cancel
                </Button>
                <Button
                  type="button"
                  variant="primary"
                  onClick={handleConfirmMapping}
                  disabled={
                    isImporting ||
                    !selectedMapping.temperature ||
                    !selectedMapping.pressure
                  }
                >
                  Import Readings
                </Button>
              </div>
            </div>
          )}

          <FormFileUpload
            id={`production-run-${productionRunId}-readings-upload`}
            accept={READINGS_ACCEPT}
            multiple
            maxSizeMb={READINGS_MAX_MB}
            disabled={isImporting}
            entityType={ENTITY_TYPE}
            entityId={productionRunId}
            documentType={READINGS_DOC_TYPE}
            onUploaded={handleUploaded}
            onUploadError={(err) => setUploadError(err)}
          />
        </>
      )}

      {deleteError && <ServerError message={deleteError} />}
      <DeleteConfirmDialog
        isOpen={!!deletingId}
        title="Delete Readings File"
        message="Are you sure you want to delete this readings file? The file will be removed from storage."
        onConfirm={handleDeleteConfirm}
        onCancel={() => {
          setDeletingId(null);
          setDeleteError(null);
        }}
        isPending={deleteMutation.isPending}
      />
    </section>
  );
}
