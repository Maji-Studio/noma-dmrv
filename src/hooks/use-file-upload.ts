"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  useConfirmUpload,
  useRequestUpload,
} from "@/hooks/use-documents";
import { resolveUploadContentType } from "@/lib/documents/content-type";
import type {
  ApplicationBoundaryLogbookEvidenceType,
  ApplicationVisualEvidenceRole,
} from "@/lib/certification/application-evidence";
import type { DeliveryEvidenceRole } from "@/lib/certification/delivery-evidence";
import type { DocumentType } from "@/schemas/documents";

interface EvidenceExif {
  capturedAt?: string;
  gpsLatitude?: number;
  gpsLongitude?: number;
}

/**
 * Bound a hung PUT so it cannot hang forever — an open request keeps the
 * caller's `isFlushing` guard latched and traps the user behind the side-sheet
 * close guard. `XMLHttpRequest.timeout` is a *total*-request deadline, not an
 * inactivity/stall timer (it does not reset on upload progress), so this must
 * stay generous: a 10 MB evidence file on a slow-but-healthy link may need
 * minutes, and cutting it off would look like a spurious failure. Ten minutes
 * comfortably covers our largest evidence uploads while still capping a truly
 * stuck flush.
 */
const UPLOAD_TIMEOUT_MS = 600_000;

export type UploadState =
  | { status: "idle" }
  | { status: "uploading"; progress: number }
  | { status: "uploaded"; documentId: string }
  | { status: "failed"; error: string };

export interface UploadParams {
  entityType: string;
  entityId: string;
  documentType: DocumentType;
  file: File;
  capturedAt?: string;
  gpsLatitude?: number;
  gpsLongitude?: number;
  description?: string;
  applicationEvidenceRole?: ApplicationVisualEvidenceRole;
  applicationLogbookEvidenceType?: ApplicationBoundaryLogbookEvidenceType;
  deliveryEvidenceRole?: DeliveryEvidenceRole;
  onProgress?: (progress: number) => void;
  signal?: AbortSignal;
}

export interface UseFileUploadResult {
  upload: (params: UploadParams) => Promise<{
    documentId: string;
    metadata: Record<string, unknown>;
  }>;
  state: UploadState;
  reset: () => void;
  cancel: () => void;
}

function safeHost(url: string): string {
  try {
    return new URL(url).host || "storage endpoint";
  } catch {
    return "storage endpoint";
  }
}

function putWithProgress(
  url: string,
  headers: Record<string, string>,
  file: File,
  onProgress?: (p: number) => void,
  signal?: AbortSignal
): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(new Error("Upload aborted"));
      return;
    }
    const xhr = new XMLHttpRequest();
    xhr.open("PUT", url, true);
    xhr.timeout = UPLOAD_TIMEOUT_MS;
    for (const [k, v] of Object.entries(headers)) {
      xhr.setRequestHeader(k, v);
    }
    if (xhr.upload && onProgress) {
      xhr.upload.onprogress = (e) => {
        if (e.lengthComputable) onProgress(e.loaded / e.total);
      };
    }
    xhr.onload = () => {
      if (xhr.status >= 200 && xhr.status < 300) resolve();
      else reject(new Error(`Upload failed with status ${xhr.status}`));
    };
    xhr.onerror = () =>
      reject(
        new Error(
          `The file could not be uploaded to ${safeHost(url)}. Check your connection and try again.`,
        ),
      );
    xhr.ontimeout = () =>
      reject(
        new Error(
          `Upload timed out after ${UPLOAD_TIMEOUT_MS / 1000}s reaching ${safeHost(url)}. Check your connection and retry.`,
        ),
      );
    xhr.onabort = () => reject(new Error("Upload aborted"));
    signal?.addEventListener("abort", () => xhr.abort(), { once: true });
    xhr.send(file);
  });
}

function toIsoString(value: unknown): string | undefined {
  if (value instanceof Date && !Number.isNaN(value.getTime())) {
    return value.toISOString();
  }
  if (typeof value !== "string" && typeof value !== "number") return undefined;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? undefined : date.toISOString();
}

function numberFrom(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

async function extractEvidenceExif(
  file: File,
  documentType: DocumentType,
): Promise<EvidenceExif> {
  if (documentType !== "photo" && documentType !== "video") {
    return {};
  }

  try {
    const exifr = await import("exifr");
    const parsed = (await exifr.parse(file, {
      gps: true,
      tiff: true,
      exif: true,
      xmp: true,
    })) as Record<string, unknown> | undefined;
    if (!parsed) return {};

    return {
      capturedAt:
        toIsoString(parsed.DateTimeOriginal) ??
        toIsoString(parsed.CreateDate) ??
        toIsoString(parsed.ModifyDate) ??
        toIsoString(parsed.DateCreated),
      gpsLatitude:
        numberFrom(parsed.latitude) ?? numberFrom(parsed.GPSLatitude),
      gpsLongitude:
        numberFrom(parsed.longitude) ?? numberFrom(parsed.GPSLongitude),
    };
  } catch {
    return {};
  }
}

export function useFileUpload(): UseFileUploadResult {
  const [state, setState] = useState<UploadState>({ status: "idle" });
  const requestMutation = useRequestUpload();
  const confirmMutation = useConfirmUpload();
  const abortRef = useRef<AbortController | null>(null);
  const mountedRef = useRef(true);

  useEffect(() => {
    return () => {
      mountedRef.current = false;
      abortRef.current?.abort();
    };
  }, []);

  const safeSetState = useCallback((next: UploadState) => {
    if (mountedRef.current) setState(next);
  }, []);

  const upload = useCallback<UseFileUploadResult["upload"]>(
    async ({
      entityType,
      entityId,
      documentType,
      file,
      capturedAt,
      gpsLatitude,
      gpsLongitude,
      description,
      applicationEvidenceRole,
      applicationLogbookEvidenceType,
      deliveryEvidenceRole,
      onProgress,
      signal,
    }) => {
      abortRef.current?.abort();
      const controller = new AbortController();
      abortRef.current = controller;
      if (signal) {
        if (signal.aborted) controller.abort();
        else signal.addEventListener("abort", () => controller.abort(), { once: true });
      }

      const isActive = () => abortRef.current === controller;
      safeSetState({ status: "uploading", progress: 0 });
      try {
        const parsedExif = await extractEvidenceExif(file, documentType);
        const presign = await requestMutation.mutateAsync({
          entityType,
          entityId,
          documentType,
          fileName: file.name,
          contentType: resolveUploadContentType({
            fileName: file.name,
            contentType: file.type,
          }),
          sizeBytes: file.size,
          capturedAt: capturedAt ?? parsedExif.capturedAt,
          gpsLatitude: gpsLatitude ?? parsedExif.gpsLatitude,
          gpsLongitude: gpsLongitude ?? parsedExif.gpsLongitude,
          description,
          applicationEvidenceRole,
          applicationLogbookEvidenceType,
          deliveryEvidenceRole,
        });
        if (controller.signal.aborted) throw new Error("Upload aborted");

        await putWithProgress(
          presign.uploadUrl,
          presign.headers,
          file,
          (p) => {
            if (!isActive()) return;
            safeSetState({ status: "uploading", progress: p });
            onProgress?.(p);
          },
          controller.signal
        );

        await confirmMutation.mutateAsync(presign.documentId);
        if (isActive()) {
          safeSetState({ status: "uploaded", documentId: presign.documentId });
        }
        return {
          documentId: presign.documentId,
          metadata: presign.metadata,
        };
      } catch (err) {
        if (isActive()) {
          const message = err instanceof Error ? err.message : "Upload failed";
          safeSetState({ status: "failed", error: message });
        }
        throw err;
      }
    },
    [requestMutation, confirmMutation, safeSetState]
  );

  const reset = useCallback(() => safeSetState({ status: "idle" }), [safeSetState]);
  const cancel = useCallback(() => abortRef.current?.abort(), []);

  return { upload, state, reset, cancel };
}
