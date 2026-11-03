/**
 * The advisory note on Review & submit when one file is the Source for evidence
 * of different kinds (#1531). It never blocks: the operator decides whether
 * the file supports each use, and Submit stays as it was.
 */
"use client";

import { useCandidateDocumentsForRemoval } from "@/hooks/use-certification-sources";
import type { RemovalCertifyContext } from "@/fn/certification/certify-context";
import type { SharedSourceFile } from "@/lib/certification/shared-source-files";
import { NewTabLink } from "./link-label";
import { sharedSourceFiles } from "./shared-source-files-model";

const NOTE_DETAIL = "A verifier who opens the Source for any of these kinds finds the same file. Check that it supports each one.";

type NoticeCtx = Pick<RemovalCertifyContext, "memberBatches" | "emissionLinesByBatchId" | "carriedEntries">;

/** The shared files for this Removal; empty until the candidate documents load. */
export function useSharedSourceFiles(removalId: string, facilityId: string, ctx: NoticeCtx): SharedSourceFile[] {
  const query = useCandidateDocumentsForRemoval(removalId);
  if (!query.data) return [];
  return sharedSourceFiles({
    candidates: query.data.candidates,
    facilityId,
    batches: ctx.memberBatches,
    linesByBatchId: ctx.emissionLinesByBatchId,
    carriedEntries: ctx.carriedEntries,
  });
}

/** Rows for the "Submission notes" Notice: each file with its kinds, then the explanation once. */
export function SharedSourceFileNotes({ files }: { files: readonly SharedSourceFile[] }) {
  if (files.length === 0) return null;
  return (
    <div className="flex flex-col gap-8">
      {files.map((file) => (
        <div key={file.fileKey} className="flex flex-col gap-4">
          <div>
            <span className="break-all font-medium text-[var(--color-text-primary)]">{file.fileName}</span> is the file for {file.kinds.length}{" "}
            different kinds of evidence.
          </div>
          <ul role="list" className="flex flex-col gap-4">
            {file.kinds.map((kind) => (
              <li key={kind.key} className="flex flex-wrap items-center gap-x-8">
                <span className="text-[var(--color-text-primary)]">{kind.label}:</span>
                {kind.records.map((record) =>
                  record.href ? (
                    <NewTabLink key={`${record.label}:${record.href}`} href={record.href} mono tall>
                      {record.label}
                    </NewTabLink>
                  ) : (
                    <span key={record.label} className="font-mono">{record.label}</span>
                  ),
                )}
              </li>
            ))}
          </ul>
        </div>
      ))}
      <div>{NOTE_DETAIL}</div>
    </div>
  );
}
