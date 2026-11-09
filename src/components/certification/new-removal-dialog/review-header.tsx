/**
 * The header of Review & submit (D1a): the title and where the Removal goes,
 * nothing else. "Step N of M" shows only when the operator came through Select
 * batches. The heading takes focus when the dialog opens on this step.
 */
"use client";

import Link from "next/link";
import type { RemovalCertifyContext } from "@/fn/certification/certify-context";
import { isometricRegistry } from "@/lib/isometric/links";
import { DestinationTag, REVIEW_TITLE_ID } from "./review-parts";

export function ReviewHeader({
  ctx,
  stepCount,
}: {
  ctx: RemovalCertifyContext | null;
  stepCount: { current: number; total: number } | null;
}) {
  const environment = ctx?.isProduction ? "production" : "sandbox";
  const externalProjectId = ctx?.mapping?.externalProjectId ?? null;
  const projectLabel = ctx?.project?.name ?? externalProjectId;
  const project =
    projectLabel && externalProjectId ? (
      <Link
        href={isometricRegistry.certifyProject({ environment, externalProjectId })}
        target="_blank"
        rel="noopener noreferrer"
        aria-label={`${projectLabel}, open the project in Isometric`}
        className="underline underline-offset-4"
      >
        {projectLabel}
      </Link>
    ) : (
      projectLabel
    );
  return (
    <div className="flex flex-col gap-2 px-20 pt-20">
      {stepCount && (
        <span className="body-caption text-[var(--color-text-tertiary)]">
          Step {stepCount.current} of {stepCount.total}
        </span>
      )}
      <h2
        id={REVIEW_TITLE_ID}
        tabIndex={-1}
        className="title-heading-3 text-[var(--color-text-primary)] focus:outline-none"
      >
        Review &amp; submit
      </h2>
      {ctx && <DestinationTag isProduction={ctx.isProduction} project={project} />}
    </div>
  );
}
