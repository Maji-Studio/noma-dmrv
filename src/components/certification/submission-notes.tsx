"use client";

import { NoteIcon } from "@phosphor-icons/react/dist/ssr";
import { InfoHint } from "@/components/ui/tooltip";
import type { SubmissionWarningNote } from "./submission-warning-notes";

interface SubmissionNotesProps {
  notes: SubmissionWarningNote[];
}

/**
 * A quiet review surface for non-blocking submission notes. The thin orange
 * marks borrow from an auditor's margin annotations without presenting the
 * notes as errors.
 */
export function SubmissionNotes({ notes }: SubmissionNotesProps) {
  if (notes.length === 0) return null;

  return (
    <section
      aria-labelledby="submission-notes-heading"
      className="border border-[var(--color-border-secondary)] bg-[var(--color-background-white)]"
    >
      <div className="flex flex-wrap items-center justify-between gap-8 border-b border-[var(--color-border-tertiary)] bg-[var(--color-surface-light)] px-12 py-10">
        <div className="flex items-center gap-8">
          <span className="flex size-28 items-center justify-center border border-[var(--st-wait-border)] bg-[var(--st-wait-bg)] text-[var(--color-signal-orange-strong)]">
            <NoteIcon size={15} weight="bold" aria-hidden />
          </span>
          <div className="flex items-baseline gap-6">
            <h3
              id="submission-notes-heading"
              className="body-small font-medium text-[var(--color-text-primary)]"
            >
              Notes
            </h3>
            <span className="body-caption text-[var(--color-text-tertiary)]">
              {notes.length}
            </span>
          </div>
        </div>
        <span className="body-caption text-[var(--color-text-tertiary)]">
          Does not block submission
        </span>
      </div>

      <ul className="divide-y divide-[var(--color-border-tertiary)]">
        {notes.map((note) => (
          <li
            key={note.key}
            className="grid grid-cols-[2px_minmax(0,1fr)_auto] items-start gap-10 px-12 py-10"
          >
            <span
              aria-hidden
              className="mt-3 h-16 w-2 bg-[var(--color-signal-orange)]"
            />
            <span className="body-small text-[var(--color-text-secondary)]">
              Advisory: {note.summary}
            </span>
            {note.detail && (
              <InfoHint
                label={`Details for: ${note.summary}`}
                side="left"
                size={16}
                className="mt-1"
              >
                {note.detail}
              </InfoHint>
            )}
          </li>
        ))}
      </ul>
    </section>
  );
}
