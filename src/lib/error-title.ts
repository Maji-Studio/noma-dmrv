/**
 * Split a server message into the bold title and the detail of an error box.
 * Sentences end at ". " followed by an uppercase letter or a digit, so a date
 * ("Sep 22, 2026") and a code ("AP-26-001.") stay inside their sentence.
 */

export interface ErrorTitleParts {
  title: string;
  /** The rest of the message, or null when one sentence says it all. */
  detail: string | null;
}

const SENTENCE_BREAK = /(?<=\.)\s+(?=[A-Z0-9])/;
/** "Feedstock was not saved." / "Deliveries were not saved." */
const NOT_SAVED_LEAD = /\b(?:was|were) not saved\.$/;

export function splitErrorMessage(message: string): ErrorTitleParts {
  const sentences = message.trim().split(SENTENCE_BREAK);
  const [first, ...rest] = sentences;
  if (rest.length === 0) return { title: first, detail: null };
  if (NOT_SAVED_LEAD.test(first)) {
    const [second, ...after] = rest;
    return { title: `Not saved. ${second}`, detail: after.length > 0 ? after.join(" ") : null };
  }
  return { title: first, detail: rest.join(" ") };
}
