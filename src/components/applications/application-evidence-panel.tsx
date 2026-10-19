"use client";

import { useState } from "react";
import {
  MapTrifoldIcon,
  PlusIcon,
  TrashIcon,
} from "@phosphor-icons/react/dist/ssr";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui";
import { Notice } from "@/components/ui/notice";
import { useIsRecordCertificationLocked } from "@/hooks/use-record-certification-lock";
import { RECORD_FILES_LOCKED_MESSAGE } from "@/lib/certification/lineage-lock-message";
import type { UseDeferredAttachmentsResult } from "@/hooks/use-deferred-attachments";
import type {
  ApplicationEvidenceMethod,
} from "@/schemas/applications";
import { APPLICATION_EVIDENCE_METHOD_DESCRIPTIONS } from "@/schemas/applications";
import type { DocumentType } from "@/schemas/documents";
import type { GisBoundary } from "@/schemas/gis-boundary";
import { GisReferenceDialog } from "./gis-reference-dialog";
import { GisReferenceSummary } from "./gis-reference-summary";
import { FormError } from "@/components/forms/form-error";
import { RequiredMarker } from "@/components/forms/required-marker";
import { ChoiceCardGroup } from "@/components/forms/choice-card-group";
import { EVIDENCE_METHOD_ART } from "./evidence-method-art";

const GIS_BOUNDARY_DOC_TYPE: DocumentType = "gis_boundary";

const METHOD_OPTIONS = [
  {
    value: "location",
    title: "Customer location",
    art: EVIDENCE_METHOD_ART.location,
    description: APPLICATION_EVIDENCE_METHOD_DESCRIPTIONS.location,
  },
  {
    value: "boundary",
    title: "GIS reference",
    art: EVIDENCE_METHOD_ART.boundary,
    description: APPLICATION_EVIDENCE_METHOD_DESCRIPTIONS.boundary,
  },
  {
    value: "visual",
    title: "Visual evidence",
    art: EVIDENCE_METHOD_ART.visual,
    description: APPLICATION_EVIDENCE_METHOD_DESCRIPTIONS.visual,
    disabled: true,
    badge: "Available later",
  },
] as const;

interface ApplicationEvidencePanelProps {
  /** A saved application; once its lineage is submitted the panel is read-only. */
  applicationId?: string;
  /** Set where a sibling panel already shows the lock notice, so a sheet shows it once. */
  hideLockNotice?: boolean;
  error?: string;
  mode: ApplicationEvidenceMethod;
  boundary: GisBoundary | null;
  disabled?: boolean;
  deferredAttachments?: UseDeferredAttachmentsResult;
  readOnly?: boolean;
  onModeChange?: (mode: ApplicationEvidenceMethod) => void;
  onBoundaryChange?: (boundary: GisBoundary | null) => void;
}

const GIS_LABEL_ID = "gisBoundary-label";
const GIS_ERROR_ID = "gisBoundary-error";

function GisReferenceField({
  boundary,
  disabled,
  readOnly,
  locked,
  onEdit,
  onRemove,
}: {
  boundary: GisBoundary | null;
  disabled: boolean;
  readOnly: boolean;
  /** Edit cannot add a boundary to a submitted application, so do not suggest it. */
  locked: boolean;
  onEdit: () => void;
  onRemove: () => void;
}) {
  if (boundary) {
    return (
      <GisReferenceSummary
        boundary={boundary}
        actions={
          !readOnly ? (
            <div className="flex items-center gap-8">
              <Button
                size="small"
                variant="weak"
                disabled={disabled}
                onClick={onEdit}
                aria-describedby={GIS_ERROR_ID}
              >
                Replace
              </Button>
              <Button
                size="small"
                variant="destructive"
                disabled={disabled}
                onClick={onRemove}
              >
                <TrashIcon size={14} weight="bold" />
                Remove
              </Button>
            </div>
          ) : undefined
        }
      />
    );
  }

  if (readOnly) {
    return (
      <EmptyState
        icon={<MapTrifoldIcon size={32} weight="bold" />}
        title="No GIS reference"
        description={locked ? undefined : "Choose Edit to add the field boundary."}
        padding="sm"
      />
    );
  }

  return (
    <Button
      width="full"
      disabled={disabled}
      onClick={onEdit}
      aria-describedby={GIS_ERROR_ID}
      className="h-auto justify-start gap-12 whitespace-normal bg-[var(--paper)] px-16 py-16 text-left normal-case tracking-normal"
    >
      <span className="flex size-40 shrink-0 items-center justify-center border border-[var(--color-border-secondary)] text-[var(--color-text-secondary)]">
        <MapTrifoldIcon size={20} weight="bold" />
      </span>
      <span className="flex min-w-0 flex-1 flex-col gap-2">
        <span className="body-small font-medium text-[var(--color-text-primary)]">
          Add GIS reference
        </span>
        <span className="body-small text-[var(--color-text-tertiary)]">
          Upload a .geojson file or paste the text. The boundary appears on a
          map here.
        </span>
      </span>
      <PlusIcon
        size={16}
        weight="bold"
        aria-hidden
        className="shrink-0 text-[var(--color-text-tertiary)]"
      />
    </Button>
  );
}

export function ApplicationEvidencePanel({
  applicationId,
  hideLockNotice = false,
  error,
  mode,
  boundary,
  disabled = false,
  deferredAttachments,
  readOnly: readOnlyProp = false,
  onModeChange,
  onBoundaryChange,
}: ApplicationEvidencePanelProps) {
  const [dialogOpen, setDialogOpen] = useState(false);
  const locked = useIsRecordCertificationLocked("application", applicationId);
  const readOnly = readOnlyProp || locked;

  const clearHeldBoundaryFile = () => {
    for (const attachment of deferredAttachments?.attachments ?? []) {
      if (
        attachment.documentType === GIS_BOUNDARY_DOC_TYPE &&
        attachment.status !== "uploaded"
      ) {
        deferredAttachments?.remove(attachment.key);
      }
    }
  };

  const saveBoundary = (
    nextBoundary: GisBoundary,
    originalFile: File | null,
  ) => {
    clearHeldBoundaryFile();
    if (originalFile) {
      deferredAttachments?.add([originalFile], GIS_BOUNDARY_DOC_TYPE);
    }
    onBoundaryChange?.(nextBoundary);
  };

  const removeBoundary = () => {
    clearHeldBoundaryFile();
    onBoundaryChange?.(null);
  };

  return (
    <div className="flex flex-col gap-16">
      {locked && !hideLockNotice && (
        <Notice tone="info">{RECORD_FILES_LOCKED_MESSAGE}</Notice>
      )}
      {!readOnly && (
        <ChoiceCardGroup
          legend="Evidence method"
          value={mode}
          options={METHOD_OPTIONS}
          disabled={disabled}
          onValueChange={(next) =>
            onModeChange?.(next as ApplicationEvidenceMethod)
          }
        />
      )}

      {mode === "boundary" && (
        <div
          role={readOnly ? undefined : "group"}
          aria-labelledby={readOnly ? undefined : GIS_LABEL_ID}
          className="flex flex-col gap-8"
        >
          {!readOnly && (
            <span
              id={GIS_LABEL_ID}
              className="body-small font-medium text-[var(--color-text-secondary)]"
            >
              GIS reference
              <RequiredMarker />
            </span>
          )}
          <GisReferenceField
            boundary={boundary}
            disabled={disabled}
            readOnly={readOnly}
            locked={locked}
            onEdit={() => setDialogOpen(true)}
            onRemove={removeBoundary}
          />
        </div>
      )}

      <FormError id={GIS_ERROR_ID} message={error} />

      {!readOnly && (
        <GisReferenceDialog
          isOpen={dialogOpen}
          onClose={() => setDialogOpen(false)}
          current={boundary}
          onSave={saveBoundary}
        />
      )}
    </div>
  );
}
