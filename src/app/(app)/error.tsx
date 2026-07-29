"use client";

// Segment-level error boundary for every authenticated app route.
// Next.js mounts this when a child Server or Client Component throws
// during rendering and the error escapes any inner error.tsx. Without
// it, a single unhandled promise rejection turns the whole route into
// the default Next error UI (a blank screen in production).
import { useEffect } from "react";
import { Button } from "@/components/ui/button";

export default function AppErrorBoundary({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    // Send to whatever error reporter the app wires up; for now the dev
    // console is the only sink (see audit finding H9 — structured logger
    // is a separate follow-up). Log the digest so server-side traces can
    // be correlated by Vercel.
    // Avoid logging error.message — it may carry PII (operator emails,
    // form values) per CLAUDE.md. digest + name are safe correlators.
    console.error("[app/error-boundary]", { digest: error.digest, name: error.name });
  }, [error]);

  return (
    <div className="flex min-h-screen items-center justify-center p-24">
      <div className="max-w-md border border-[var(--color-border-secondary)] bg-[var(--color-background-white)] p-24">
        <p className="title-chapter-title text-[var(--color-text-secondary)]">
          Page unavailable
        </p>
        <h1 className="title-heading-2 mt-8">This page could not be displayed.</h1>
        <p className="body-medium mt-16 text-[var(--color-text-secondary)]">
          Try again. If the page still does not load, share the reference below
          with the support team.
        </p>
        {error.digest && (
          <p className="body-small mt-12 font-mono text-[var(--color-text-tertiary)]">
            Reference: {error.digest}
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
