"use client";

import { NoteIcon } from "@phosphor-icons/react/dist/ssr";
import { InfoHint } from "@/components/ui/tooltip";
import type { SubmissionWarningNote } from "./submission-warning-notes";

interface SubmissionNotesProps {
  notes: SubmissionWarningNote[];
}

/**
 * A quiet review surface for submission notes. Readiness is communicated by
 * the shared workflow status, so this module only presents the note itself.
 */
export function SubmissionNotes({ notes }: SubmissionNotesProps) {
  if (notes.length === 0) return null;

  return (
    <section
      aria-labelledby="submission-notes-heading"
      className="border border-[var(--color-border-secondary)] bg-[var(--color-background-white)]"
    >
      <div className="flex items-center gap-8 border-b border-[var(--color-border-tertiary)] px-12 py-10">
        <span className="flex size-28 items-center justify-center text-[var(--color-signal-orange-strong)]">
          <NoteIcon size={16} weight="bold" aria-hidden />
        </span>
        <div className="flex items-center gap-8">
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
              {note.summary}
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
