const DEFAULT_ZOD_ACTION_ERROR = "Check the highlighted fields.";

function asSentence(message: string): string {
  return /[.!?]$/.test(message) ? message : `${message}.`;
}

export function formatValidationIssues(
  issues: readonly { message: string }[],
  context?: string,
): string {
  const messages = [
    ...new Set(
      issues
        .map((issue) => issue.message.trim())
        .filter((message) => message.length > 0),
    ),
  ].map(asSentence);
  const issueText = messages.join(" ") || DEFAULT_ZOD_ACTION_ERROR;

  if (!context) return issueText;
  return `${context.trim().replace(/[:.\s]+$/, "")}: ${issueText}`;
}

