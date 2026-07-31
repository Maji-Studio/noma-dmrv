import type {
  SubmissionProgressRequest,
  SubmissionProgressStreamEvent,
  SubmissionProgressUpdate,
} from "./submission-progress";

const SUBMISSION_PROGRESS_ENDPOINT = "/api/certification/submissions";
const DEFAULT_READ_TIMEOUT_MS = 60_000;

const STALLED_SUBMISSION_MESSAGE =
  "The progress connection stopped responding. The registry submission may still be running. Close this dialog and refresh the page before trying again.";

export class SubmissionStreamStalledError extends Error {
  constructor() {
    super(STALLED_SUBMISSION_MESSAGE);
    this.name = "SubmissionStreamStalledError";
  }
}

export function isSubmissionStreamStalledError(
  error: unknown,
): error is SubmissionStreamStalledError {
  return error instanceof SubmissionStreamStalledError;
}

interface SubmissionStreamOptions {
  signal?: AbortSignal;
  readTimeoutMs?: number;
}

async function readWithTimeout(
  reader: ReadableStreamDefaultReader<Uint8Array>,
  controller: AbortController,
  timeoutMs: number,
): Promise<ReadableStreamReadResult<Uint8Array>> {
  let timeoutId: ReturnType<typeof setTimeout> | undefined;
  const read = reader.read();
  const timeout = new Promise<never>((_resolve, reject) => {
    timeoutId = setTimeout(() => {
      const error = new SubmissionStreamStalledError();
      reject(error);
      controller.abort(error);
      void reader.cancel(error).catch(() => undefined);
    }, timeoutMs);
  });

  try {
    return await Promise.race([read, timeout]);
  } finally {
    if (timeoutId !== undefined) clearTimeout(timeoutId);
  }
}

export async function streamCertificationSubmission<T>(
  request: SubmissionProgressRequest,
  onProgress: (update: SubmissionProgressUpdate) => void,
  options: SubmissionStreamOptions = {},
): Promise<T> {
  const controller = new AbortController();
  const abortFromCaller = () => controller.abort(options.signal?.reason);
  if (options.signal?.aborted) abortFromCaller();
  else options.signal?.addEventListener("abort", abortFromCaller, { once: true });

  try {
    const response = await fetch(SUBMISSION_PROGRESS_ENDPOINT, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(request),
      signal: controller.signal,
    });
    if (!response.ok || !response.body) {
      throw new Error("The submission could not be started. Try again.");
    }

    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";
    let result: T | undefined;

    while (true) {
      const { done, value } = await readWithTimeout(
        reader,
        controller,
        options.readTimeoutMs ?? DEFAULT_READ_TIMEOUT_MS,
      );
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
  } finally {
    options.signal?.removeEventListener("abort", abortFromCaller);
  }
}
