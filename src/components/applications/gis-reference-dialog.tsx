"use client";

import { useState } from "react";
import {
  CheckCircleIcon,
  UploadSimpleIcon,
  WarningCircleIcon,
} from "@phosphor-icons/react/dist/ssr";
import { Button } from "@/components/ui/button";
import { Modal } from "@/components/ui/modal";
import { GEOJSON_MAX_INPUT_BYTES } from "@/config/geo";
import { useNormalizeGisBoundary } from "@/hooks/use-gis-boundary";
import { cn } from "@/lib/utils";
import type { GisBoundary } from "@/schemas/gis-boundary";
import { RadioCardGroup } from "./radio-card-group";

const DIALOG_TITLE_ID = "gis-reference-dialog-title";
const FILE_INPUT_ID = "gis-reference-file";
const PASTE_HEIGHT = "h-160";
const MONO = "[font-family:var(--font-mono)]";
const GEOJSON_ACCEPT =
  ".geojson,.json,application/geo+json,application/json,text/plain";
const BYTES_PER_KILOBYTE = 1024;
const MAX_SIZE_KB = GEOJSON_MAX_INPUT_BYTES / BYTES_PER_KILOBYTE;

type AddMode = "upload" | "manual";

const MODE_OPTIONS = [
  {
    key: "upload",
    title: "Upload a file",
    description: "A .geojson file exported from your GIS tool.",
  },
  {
    key: "manual",
    title: "Insert manually",
    description: "Paste the GeoJSON text straight in.",
  },
] as const;

interface ParsedUpload {
  boundary: GisBoundary;
  file: File;
}

export function GisReferenceDialog({
  isOpen,
  onClose,
  current,
  onSave,
}: {
  isOpen: boolean;
  onClose: () => void;
  current: GisBoundary | null;
  onSave: (boundary: GisBoundary, originalFile: File | null) => void;
}) {
  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      ariaLabelledBy={DIALOG_TITLE_ID}
      width="md"
      dismissOnClickOutside={false}
    >
      <DialogBody current={current} onClose={onClose} onSave={onSave} />
    </Modal>
  );
}

function DialogBody({
  current,
  onClose,
  onSave,
}: {
  current: GisBoundary | null;
  onClose: () => void;
  onSave: (boundary: GisBoundary, originalFile: File | null) => void;
}) {
  const [mode, setMode] = useState<AddMode>(
    current?.source === "paste" ? "manual" : "upload",
  );
  const [text, setText] = useState("");
  const [parsedUpload, setParsedUpload] = useState<ParsedUpload | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [isDragOver, setIsDragOver] = useState(false);
  const normalizeMutation = useNormalizeGisBoundary();

  const normalizeFile = async (file: File) => {
    setParsedUpload(null);
    setErrorMessage(null);
    if (file.size > GEOJSON_MAX_INPUT_BYTES) {
      setErrorMessage(`Choose a GeoJSON file up to ${MAX_SIZE_KB} KB.`);
      return;
    }

    try {
      const result = await normalizeMutation.mutateAsync({
        text: await file.text(),
        source: "upload",
        fileName: file.name,
      });
      if (!result.success) {
        setErrorMessage(result.error);
        return;
      }
      setParsedUpload({ boundary: result.data, file });
    } catch (error) {
      setErrorMessage(
        error instanceof Error
          ? error.message
          : "The boundary could not be checked. Try again.",
      );
    }
  };

  const insertText = async () => {
    setErrorMessage(null);
    try {
      const result = await normalizeMutation.mutateAsync({
        text,
        source: "paste",
      });
      if (!result.success) {
        setErrorMessage(result.error);
        return;
      }
      onSave(result.data, null);
      onClose();
    } catch (error) {
      setErrorMessage(
        error instanceof Error
          ? error.message
          : "The boundary could not be checked. Try again.",
      );
    }
  };

  const saveFile = () => {
    if (!parsedUpload) return;
    onSave(parsedUpload.boundary, parsedUpload.file);
    onClose();
  };

  return (
    <div className="flex flex-col gap-16">
      <div className="flex flex-col gap-4 pr-32">
        <h2
          id={DIALOG_TITLE_ID}
          className="body-large font-medium text-[var(--color-text-primary)]"
        >
          Add GIS reference
        </h2>
        <p className="body-small text-[var(--color-text-secondary)]">
          The boundary of the field this biochar was applied to, in WGS 84
          coordinates.
        </p>
      </div>

      <RadioCardGroup
        label="How to add the boundary"
        value={mode}
        options={MODE_OPTIONS}
        disabled={normalizeMutation.isPending}
        onChange={(key) => {
          setMode(key as AddMode);
          setErrorMessage(null);
        }}
      />

      {mode === "upload" ? (
        <div className="flex flex-col gap-8">
          <label
            htmlFor={FILE_INPUT_ID}
            onDragEnter={(event) => {
              event.preventDefault();
              setIsDragOver(true);
            }}
            onDragOver={(event) => event.preventDefault()}
            onDragLeave={(event) => {
              if (!event.currentTarget.contains(event.relatedTarget as Node)) {
                setIsDragOver(false);
              }
            }}
            onDrop={(event) => {
              event.preventDefault();
              setIsDragOver(false);
              const file = event.dataTransfer.files[0];
              if (file) void normalizeFile(file);
            }}
            className={cn(
              "flex w-full cursor-pointer flex-col items-center gap-6 border border-dashed border-[var(--color-border-primary)] bg-[var(--paper)] px-16 py-32 text-center transition-colors duration-300 hover:border-[var(--ink)]",
              isDragOver &&
                "border-[var(--color-interaction)] bg-[var(--color-background-interaction-light)]",
            )}
          >
            <UploadSimpleIcon
              size={20}
              weight="bold"
              className="text-[var(--color-text-tertiary)]"
            />
            <span className="body-small font-medium text-[var(--color-text-primary)]">
              Drop a .geojson file here, or click to browse
            </span>
            <span className="body-caption text-[var(--color-text-tertiary)]">
              One file, up to {MAX_SIZE_KB} KB.
            </span>
          </label>
          <input
            id={FILE_INPUT_ID}
            type="file"
            accept={GEOJSON_ACCEPT}
            className="sr-only"
            disabled={normalizeMutation.isPending}
            onChange={(event) => {
              const file = event.target.files?.[0];
              if (file) void normalizeFile(file);
              event.target.value = "";
            }}
          />

          {parsedUpload && (
            <p className="flex items-center gap-6 body-caption text-[var(--color-text-secondary)]">
              <CheckCircleIcon
                size={14}
                weight="fill"
                className="shrink-0 text-[var(--st-ok)]"
              />
              <span className="min-w-0 flex-1 truncate">
                {parsedUpload.file.name} (
                {countLabel(parsedUpload.boundary.stats.features, "area", "areas")}
                )
              </span>
            </p>
          )}
        </div>
      ) : (
        <textarea
          id="gis-reference-text"
          value={text}
          spellCheck={false}
          aria-label="GeoJSON text"
          placeholder={'{"type": "FeatureCollection", "features": [ ... ]}'}
          disabled={normalizeMutation.isPending}
          onChange={(event) => {
            setText(event.target.value);
            setErrorMessage(null);
          }}
          className={cn(
            "w-full resize-none border border-[var(--color-border-secondary)] bg-[var(--paper)] p-8 body-caption text-[var(--color-text-primary)] placeholder:text-[var(--color-text-tertiary)] focus:border-[var(--color-interaction)] focus:outline-none",
            MONO,
            PASTE_HEIGHT,
          )}
        />
      )}

      {errorMessage && <DialogError message={errorMessage} />}

      <div className="flex items-center justify-end gap-8 border-t border-[var(--color-border-tertiary)] pt-16">
        <Button
          variant="weak"
          disabled={normalizeMutation.isPending}
          onClick={onClose}
        >
          Cancel
        </Button>
        {mode === "upload" ? (
          <Button
            variant="primary"
            disabled={!parsedUpload}
            busy={normalizeMutation.isPending}
            onClick={saveFile}
          >
            Save
          </Button>
        ) : (
          <Button
            variant="primary"
            disabled={text.trim().length === 0}
            busy={normalizeMutation.isPending}
            onClick={() => void insertText()}
          >
            Insert
          </Button>
        )}
      </div>
    </div>
  );
}

function DialogError({ message }: { message: string }) {
  return (
    <p
      role="alert"
      className="flex items-start gap-6 border border-[var(--st-bad-border)] bg-[var(--st-bad-bg)] px-12 py-10 body-small text-[var(--color-text-primary)]"
    >
      <WarningCircleIcon
        size={16}
        weight="bold"
        className="mt-1 shrink-0 text-[var(--st-bad)]"
      />
      {message}
    </p>
  );
}

function countLabel(
  count: number,
  singular: string,
  plural: string,
): string {
  return `${count} ${count === 1 ? singular : plural}`;
}
