"use client";

// Segment-level error boundary for the certification surface
// (/certification, /certification/removals, /certification/removals/[id],
// /certification/ghg-statements). Next.js mounts the nearest error.tsx
// when a child throws; without this, a crash in a submission flow or a
// failed Isometric/data-access read escapes to the app-level boundary in
// `(app)/error.tsx`, which discards the certification context and the
// route the operator was on. Catching it here keeps the (app) layout +
// sidebar mounted so recovery lands the operator back on the same surface.
import { useEffect } from "react";
import { Button } from "@/components/ui/button";

export default function CertificationErrorBoundary({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    // Mirror the app boundary's logging contract: digest + name only, never
    // error.message — certification flows carry operator PII and Isometric
    // payloads that must not reach logs (CLAUDE.md). digest correlates with
    // the server-side trace.
    console.error("[certification/error-boundary]", {
      digest: error.digest,
      name: error.name,
    });
  }, [error]);

  return (
    <div className="flex min-h-[60vh] items-center justify-center p-24">
      <div className="max-w-md border border-[var(--color-border-secondary)] bg-[var(--color-background-white)] p-24">
        <p className="title-chapter-title text-[var(--color-text-secondary)]">
          Certification error
        </p>
        <h1 className="title-heading-2 mt-8">
          This certification step hit an unexpected error.
        </h1>
        <p className="body-medium mt-16 text-[var(--color-text-secondary)]">
          Try again, or navigate away and come back — submissions are
          idempotent, so retrying resumes safely rather than double-posting.
          If it keeps happening, share the digest below with the team.
        </p>
        {error.digest && (
          <p className="body-small mt-12 font-mono text-[var(--color-text-tertiary)]">
            digest: {error.digest}
          </p>
        )}
        <div className="mt-24 flex gap-12">
          <Button onClick={() => reset()} variant="primary">
            Try again
          </Button>
        </div>
      </div>
    </div>
  );
}
