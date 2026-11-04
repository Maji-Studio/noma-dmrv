/**
 * A producer's blocker: its fact, its repair step, and the joined message the
 * submit gates and editable surfaces show. Producers author the two parts so
 * read-only surfaces can state the fact without parsing the message.
 * `BlockerCopy` (removal-template-blockers.ts) is the optional split a health
 * check or open item carries; this is where such facts come from.
 */
export interface BlockerMessage {
  fact: string;
  instruction?: string;
  message: string;
}

export function blockerMessage(fact: string, instruction?: string): BlockerMessage {
  return { fact, instruction, message: instruction ? `${fact} ${instruction}` : fact };
}
