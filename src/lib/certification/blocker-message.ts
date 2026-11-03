/** Producer-authored facts keep read-only surfaces free of repair steps. */
export interface BlockerMessage {
  fact: string;
  instruction?: string;
  message: string;
}

export function blockerMessage(fact: string, instruction?: string): BlockerMessage {
  return { fact, instruction, message: instruction ? `${fact} ${instruction}` : fact };
}
