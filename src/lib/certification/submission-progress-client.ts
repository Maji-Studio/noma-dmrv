import type {
  SubmissionProgressRequest,
  SubmissionProgressStreamEvent,
  SubmissionProgressUpdate,
} from "./submission-progress";

const SUBMISSION_PROGRESS_ENDPOINT = "/api/certification/submissions";

export async function streamCertificationSubmission<T>(
  request: SubmissionProgressRequest,
  onProgress: (update: SubmissionProgressUpdate) => void,
): Promise<T> {
  const response = await fetch(SUBMISSION_PROGRESS_ENDPOINT, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(request),
  });
  if (!response.ok || !response.body) {
    throw new Error("The submission could not be started. Try again.");
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let result: T | undefined;

  while (true) {
    const { done, value } = await reader.read();
    buffer += decoder.decode(value, { stream: !done });
    const lines = buffer.split("\n");
    buffer = done ? "" : (lines.pop() ?? "");

    for (const line of lines) {
      if (!line.trim()) continue;
      const event = JSON.parse(line) as SubmissionProgressStreamEvent<T>;
      if (event.type === "progress") onProgress(event.update);
      if (event.type === "result") result = event.result;
      if (event.type === "error") throw new Error(event.error);
    }
    if (done) break;
  }

  if (result === undefined) {
    throw new Error("The submission ended without a result. Try again.");
  }
  return result;
}
