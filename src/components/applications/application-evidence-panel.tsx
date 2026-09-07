"use client";

import { useState } from "react";
import {
  MapTrifoldIcon,
  PlusIcon,
  TrashIcon,
} from "@phosphor-icons/react/dist/ssr";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui";
import type { UseDeferredAttachmentsResult } from "@/hooks/use-deferred-attachments";
import type {
  ApplicationEvidenceMethod,
} from "@/schemas/applications";
import type { DocumentType } from "@/schemas/documents";
import type { GisBoundary } from "@/schemas/gis-boundary";
import { GisReferenceDialog } from "./gis-reference-dialog";
import { GisReferenceSummary } from "./gis-reference-summary";
import { RadioCardGroup } from "./radio-card-group";

const GIS_BOUNDARY_DOC_TYPE: DocumentType = "gis_boundary";

const METHOD_OPTIONS = [
  {
    key: "location",
    title: "Customer location",
    description:
      "Use the application GPS coordinates from the delivery's customer location.",
  },
  {
    key: "boundary",
    title: "GIS reference",
    description: "The field boundary as a GeoJSON file, drawn on a map.",
  },
  {
    key: "visual",
    title: "Visual evidence",
    description: "Geotagged photos of each application stage.",
    disabled: true,
    badge: "Available later",
  },
] as const;

interface ApplicationEvidencePanelProps {
  mode: ApplicationEvidenceMethod;
  boundary: GisBoundary | null;
  disabled?: boolean;
  deferredAttachments?: UseDeferredAttachmentsResult;
  readOnly?: boolean;
  onModeChange?: (mode: ApplicationEvidenceMethod) => void;
  onBoundaryChange?: (boundary: GisBoundary | null) => void;
}

function GisReferenceField({
  boundary,
  disabled,
  readOnly,
  onEdit,
  onRemove,
}: {
  boundary: GisBoundary | null;
  disabled: boolean;
  readOnly: boolean;
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
        description="Choose Edit to add the field boundary."
        padding="sm"
      />
    );
  }

  return (
    <Button
      width="full"
      disabled={disabled}
      onClick={onEdit}
      className="h-auto justify-start gap-12 whitespace-normal bg-[var(--paper)] px-16 py-16 text-left normal-case tracking-normal"
    >
      <span className="flex size-40 shrink-0 items-center justify-center border border-[var(--color-border-secondary)] text-[var(--color-text-secondary)]">
        <MapTrifoldIcon size={20} weight="bold" />
      </span>
      <span className="flex min-w-0 flex-1 flex-col gap-2">
        <span className="body-medium font-medium text-[var(--color-text-primary)]">
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
  mode,
  boundary,
  disabled = false,
  deferredAttachments,
  readOnly = false,
  onModeChange,
  onBoundaryChange,
}: ApplicationEvidencePanelProps) {
  const [dialogOpen, setDialogOpen] = useState(false);

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
      {!readOnly && (
        <RadioCardGroup
          label="Evidence method"
          value={mode}
          options={METHOD_OPTIONS}
          disabled={disabled}
          onChange={(key) =>
            onModeChange?.(key as ApplicationEvidenceMethod)
          }
        />
      )}

      {mode === "boundary" && (
        <GisReferenceField
          boundary={boundary}
          disabled={disabled}
          readOnly={readOnly}
          onEdit={() => setDialogOpen(true)}
          onRemove={removeBoundary}
        />
      )}

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
