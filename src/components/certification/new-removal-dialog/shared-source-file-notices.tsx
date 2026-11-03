/**
 * The advisory note on Review & submit when one file is the Source for evidence
 * of different kinds (#1531). It never blocks: the operator decides whether
 * the file supports each use, and Submit stays as it was.
 */
"use client";

import { Notice } from "@/components/ui/notice";
import { useCandidateDocumentsForRemoval } from "@/hooks/use-certification-sources";
import type { RemovalCertifyContext } from "@/fn/certification/certify-context";
import type { SharedSourceFile } from "@/lib/certification/shared-source-files";
import { NewTabLink } from "./link-label";
import { sharedSourceFiles } from "./shared-source-files-model";

const NOTE_DETAIL = "A verifier who opens the Source for any kind below finds this same file. Check that it supports each one.";

interface SharedSourceFileNoticesProps {
  removalId: string;
  facilityId: string;
  ctx: Pick<RemovalCertifyContext, "memberBatches" | "emissionLinesByBatchId">;
}

export function SharedSourceFileNotices({ removalId, facilityId, ctx }: SharedSourceFileNoticesProps) {
  const query = useCandidateDocumentsForRemoval(removalId);
  if (!query.data) return null;
  const files = sharedSourceFiles({
    candidates: query.data.candidates,
    facilityId,
    batches: ctx.memberBatches,
    linesByBatchId: ctx.emissionLinesByBatchId,
  });
  return <SharedSourceFileNoticeList files={files} />;
}

export function SharedSourceFileNoticeList({ files }: { files: readonly SharedSourceFile[] }) {
  if (files.length === 0) return null;
  return (
    <div className="flex flex-col gap-16">
      {files.map((file) => (
        <Notice
          key={file.fileKey}
          tone="warning"
          title={
            <>
              <span className="break-all">{file.fileName}</span> is the file for {file.kinds.length} different kinds of evidence.
            </>
          }
        >
          <div className="flex flex-col gap-8">
            <div>{NOTE_DETAIL}</div>
            <ul role="list" className="flex flex-col gap-4">
              {file.kinds.map((kind) => (
                <li key={kind.key} className="flex flex-wrap items-center gap-x-8">
                  <span className="text-[var(--color-text-primary)]">{kind.label}:</span>
                  {kind.records.map((record) =>
                    record.href ? (
                      <NewTabLink key={`${record.label}:${record.href}`} href={record.href} tall>
                        {record.label}
                      </NewTabLink>
                    ) : (
                      <span key={record.label}>{record.label}</span>
                    ),
                  )}
                </li>
              ))}
            </ul>
          </div>
        </Notice>
      ))}
    </div>
  );
}
