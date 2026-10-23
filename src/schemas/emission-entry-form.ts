/**
 * Client-side form schemas for the Emissions page: the manual entry drawer and
 * the line comment editor. They mirror what the server actions validate
 * (`createEmissionEntrySchema`, `setEmissionLineCommentSchema`) and add no
 * stricter rule. Kept free of node-only imports because the browser loads it,
 * which `emission-entries.ts` (certification rules) is not.
 */
import { z } from "zod";

const NOTE_NUMBER_FORMAT = new Intl.NumberFormat("en-US");

/** The server's note and comment limit (MAX_ENTRY_TEXT_LENGTH in `emission-entries.ts`). */
export const MAX_NOTE_LENGTH = 4000;
export const NOTE_TOO_LONG_MESSAGE = `Use ${NOTE_NUMBER_FORMAT.format(MAX_NOTE_LENGTH)} characters or fewer.`;
export const DECIMAL_MESSAGE = "Enter a non-negative decimal value.";
export const DATE_BEFORE_START_MESSAGE = "Entry date cannot be before the credit batch start date.";
export const DATE_IN_FUTURE_MESSAGE = "Entry date cannot be in the future at this facility.";
export const DATE_INVALID_MESSAGE = "Enter a valid entry date.";
export const COMMENT_EMPTY_MESSAGE = "Enter a comment.";

/** Same pattern as the server's `ENTRY_DECIMAL_PATTERN`. */
const DECIMAL_PATTERN = /^\d+(?:\.\d+)?$/;
const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

export function isDecimal(raw: string): boolean {
  return DECIMAL_PATTERN.test(raw.trim());
}

export function validateEntryDate(date: string, today: string, startDate: string): string | null {
  if (!DATE_PATTERN.test(date)) return DATE_INVALID_MESSAGE;
  if (date < startDate) return DATE_BEFORE_START_MESSAGE;
  if (date > today) return DATE_IN_FUTURE_MESSAGE;
  return null;
}

/** RHF name of the entry form's nth value field (template keys may hold dots and colons). */
export function entryFieldName(index: number): string {
  return `value${index}`;
}

export interface EmissionEntryFormOptions {
  fieldCount: number;
  /** A `single` line has no date: its one entry counts for the whole credit batch. */
  dated: boolean;
  today: string;
  startDate: string;
}

const text = z.string().optional().default("");

/** The manual entry drawer: one decimal text per value field, the date, an optional note. */
export function emissionEntryFormSchema({ fieldCount, dated, today, startDate }: EmissionEntryFormOptions) {
  const values = Object.fromEntries(
    Array.from({ length: fieldCount }, (_, index) => [
      entryFieldName(index),
      text.refine(isDecimal, DECIMAL_MESSAGE),
    ]),
  );
  return z.object({
    ...values,
    date: text.superRefine((date, context) => {
      const message = dated ? validateEntryDate(date, today, startDate) : null;
      if (message) context.addIssue({ code: "custom", message });
    }),
    note: text.refine((note) => note.trim().length <= MAX_NOTE_LENGTH, NOTE_TOO_LONG_MESSAGE),
  });
}
export type EmissionEntryFormValues = Record<string, string | undefined>;

/** The line comment editor: the words, trimmed on save. */
export const emissionLineCommentFormSchema = z.object({
  body: z
    .string()
    .trim()
    .min(1, COMMENT_EMPTY_MESSAGE)
    .refine((body) => body.length <= MAX_NOTE_LENGTH, NOTE_TOO_LONG_MESSAGE),
});
export type EmissionLineCommentFormData = z.output<typeof emissionLineCommentFormSchema>;
export type EmissionLineCommentFormInput = z.input<typeof emissionLineCommentFormSchema>;
