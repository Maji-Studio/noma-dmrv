"use client";

import { useState } from "react";
import { ArrowClockwiseIcon, TrashIcon } from "@phosphor-icons/react/dist/ssr";
import { Button } from "@/components/ui/button";
import type { DeferredAttachment } from "@/hooks/use-deferred-attachments";

interface FailedDeferredAttachmentsProps {
  attachments: DeferredAttachment[];
  onRetry: (key?: string) => Promise<unknown>;
  onRemove: (key: string) => void;
  disabled?: boolean;
}

export function FailedDeferredAttachments({
  attachments,
  onRetry,
  onRemove,
  disabled = false,
}: FailedDeferredAttachmentsProps) {
  const [retryingKey, setRetryingKey] = useState<string | null>(null);
  const failed = attachments.filter((attachment) => attachment.status === "failed");

  if (failed.length === 0) return null;

  const retry = async (key?: string) => {
    setRetryingKey(key ?? "all");
    try {
      await onRetry(key);
    } finally {
      setRetryingKey(null);
    }
  };

  return (
    <div className="flex flex-col gap-10 border border-[var(--color-status-error)] p-12">
      <div className="flex flex-wrap items-center justify-between gap-8">
        <p className="body-small font-medium text-[var(--color-status-error)]">
          {failed.length} {failed.length === 1 ? "attachment" : "attachments"} failed to upload
        </p>
        <Button
          type="button"
          variant="weak"
          size="small"
          onClick={() => void retry()}
          disabled={disabled || retryingKey !== null}
        >
          <ArrowClockwiseIcon size={14} weight="bold" />
          Retry uploads
        </Button>
      </div>
      <ul className="flex flex-col gap-8">
        {failed.map((attachment) => (
          <li
            key={attachment.key}
            className="flex flex-wrap items-center gap-8 border border-[var(--color-border-tertiary)] px-12 py-8"
          >
            <div className="min-w-0 flex-1">
              <p className="body-small truncate text-[var(--color-text-primary)]">
                {attachment.file.name}
              </p>
              <p className="body-caption text-[var(--color-status-error)]">
                {attachment.error ?? "Upload failed"}
              </p>
            </div>
            <Button
              type="button"
              variant="noOutline"
              size="small"
              onClick={() => void retry(attachment.key)}
              disabled={disabled || retryingKey !== null}
            >
              <ArrowClockwiseIcon size={14} weight="bold" />
              Retry
            </Button>
            <Button
              type="button"
              variant="destructive"
              size="icon"
              onClick={() => onRemove(attachment.key)}
              disabled={disabled || retryingKey !== null}
              aria-label={`Remove ${attachment.file.name}`}
            >
              <TrashIcon size={14} weight="bold" />
            </Button>
          </li>
        ))}
      </ul>
    </div>
  );
}
