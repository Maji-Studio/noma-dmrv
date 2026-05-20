"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  useConfirmUpload,
  useRequestUpload,
} from "@/hooks/use-documents";
import type { DocumentType } from "@/schemas/documents";

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
  description?: string;
  onProgress?: (progress: number) => void;
  signal?: AbortSignal;
}

export interface UseFileUploadResult {
  upload: (params: UploadParams) => Promise<{ documentId: string }>;
  state: UploadState;
  reset: () => void;
  cancel: () => void;
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
    xhr.onerror = () => reject(new Error("Upload network error"));
    xhr.onabort = () => reject(new Error("Upload aborted"));
    signal?.addEventListener("abort", () => xhr.abort(), { once: true });
    xhr.send(file);
  });
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
    async ({ entityType, entityId, documentType, file, capturedAt, description, onProgress, signal }) => {
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
        const presign = await requestMutation.mutateAsync({
          entityType,
          entityId,
          documentType,
          fileName: file.name,
          contentType: file.type || "application/octet-stream",
          sizeBytes: file.size,
          capturedAt,
          description,
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
        return { documentId: presign.documentId };
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
