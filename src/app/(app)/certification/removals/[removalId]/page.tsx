/**
 * Per-removal sources management surface.
 *
 * Phase 3.5 added the operator action of mirroring noma documents into
 * Isometric Sources. This page hosts the SourcesPanel for a specific
 * Removal, reachable from the Removals hub via the "Sources" link on each
 * RemovalCard. Submission still happens on the hub or the credit-batch
 * side sheet.
 */
import Link from "next/link";
import { SourcesPanel } from "@/components/certification";

export default async function RemovalSourcesPage({
  params,
}: {
  params: Promise<{ removalId: string }>;
}) {
  const { removalId } = await params;
  return (
    <div className="container-max flex flex-col gap-32 py-32">
      <header className="flex flex-col gap-8">
        <Link
          href="/certification/removals"
          className="body-caption text-[var(--color-text-tertiary)] underline underline-offset-2 hover:text-[var(--color-text-secondary)]"
        >
          ← Removals
        </Link>
        <span className="title-chapter-title text-[var(--color-text-tertiary)]">
          Isometric Certify
        </span>
        <h1 className="title-heading-2">Sources for this Removal</h1>
        <p className="body-medium text-[var(--color-text-secondary)] max-w-[680px]">
          Mirror supporting documents from the chain-of-custody to Isometric
          as Sources. They attach to every Datapoint in this Removal at
          submit time.
        </p>
        <span className="body-caption font-mono text-[var(--color-text-tertiary)]">
          {removalId}
        </span>
      </header>

      <SourcesPanel removalId={removalId} />
    </div>
  );
}
