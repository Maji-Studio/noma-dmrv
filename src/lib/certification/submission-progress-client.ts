import {
  GHG_STATEMENT_PROGRESS_STEPS,
  REMOVAL_PROGRESS_STEPS,
  SUBMISSION_STREAM_READ_TIMEOUT_MS,
  type SubmissionProgressRequest,
  type SubmissionProgressStreamEvent,
  type SubmissionProgressUpdate,
} from "./submission-progress";
/*
 * Keep this timeout comfortably above the server ping cadence. A timeout is a
 * recoverable connection failure, not proof that submission work stopped.
 */
const DEFAULT_READ_TIMEOUT_MS = SUBMISSION_STREAM_READ_TIMEOUT_MS;

const SUBMISSION_PROGRESS_ENDPOINT = "/api/certification/submissions";

const STALLED_SUBMISSION_MESSAGE =
  "The progress connection stopped responding. The registry submission may still be running. Close this dialog and refresh the page before trying again.";
const UNREADABLE_SUBMISSION_STREAM_MESSAGE =
  "The progress connection returned an unreadable response. Close this dialog and refresh the page before trying again.";
const SUBMISSION_ADMISSION_FALLBACK =
  "The submission could not be started. Try again.";
const UNCONFIRMED_SUBMISSION_MESSAGES: Record<
  SubmissionProgressRequest["kind"],
  string
> = {
  removal:
    "The Removal submission could not be confirmed. Close this dialog and refresh the page before trying again.",
  ghg_statement:
    "The GHG Statement submission could not be confirmed. Close this dialog and refresh the page before trying again.",
};
const SUBMISSION_PROGRESS_STATES: ReadonlySet<string> = new Set([
  "active",
  "complete",
  "reused",
  "skipped",
]);
const SUBMISSION_PROGRESS_STEPS: ReadonlySet<string> = new Set([
  ...REMOVAL_PROGRESS_STEPS,
  ...GHG_STATEMENT_PROGRESS_STEPS,
]);
const GHG_STATEMENT_RESULT_STATUSES: ReadonlySet<string> = new Set([
  "DRAFT",
  "AWAITING_VERIFICATION",
  "VERIFIED",
  "CREDITS_ISSUED",
  "FAILED_VERIFICATION",
]);

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

async function getAdmissionError(response: Response): Promise<string> {
  try {
    const body: unknown = await response.json();
    if (
      typeof body === "object" &&
      body !== null &&
      "error" in body &&
      typeof body.error === "string" &&
      body.error.trim()
    ) {
      return body.error;
    }
  } catch {
    // The generic fallback below is safe for non-JSON or malformed responses.
  }
  return SUBMISSION_ADMISSION_FALLBACK;
}

function unreadableSubmissionStreamError(): Error {
  return new Error(UNREADABLE_SUBMISSION_STREAM_MESSAGE);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isOptionalFiniteNumber(
  value: Record<string, unknown>,
  key: "completed" | "total",
): boolean {
  return (
    !(key in value) ||
    (typeof value[key] === "number" && Number.isFinite(value[key]))
  );
}

function isProgressUpdate(value: unknown): value is SubmissionProgressUpdate {
  return (
    isRecord(value) &&
    typeof value.step === "string" &&
    SUBMISSION_PROGRESS_STEPS.has(value.step) &&
    typeof value.state === "string" &&
    SUBMISSION_PROGRESS_STATES.has(value.state) &&
    isOptionalFiniteNumber(value, "completed") &&
    isOptionalFiniteNumber(value, "total")
  );
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && Boolean(value.trim());
}

function isRemovalResult(value: unknown): boolean {
  return (
    isRecord(value) &&
    isNonEmptyString(value.removalId) &&
    isNonEmptyString(value.externalId) &&
    typeof value.version === "number" &&
    Number.isFinite(value.version)
  );
}

function isGhgStatementResult(value: unknown): boolean {
  return (
    isRecord(value) &&
    isNonEmptyString(value.externalId) &&
    typeof value.remoteStatus === "string" &&
    GHG_STATEMENT_RESULT_STATUSES.has(value.remoteStatus)
  );
}

function parseStreamEvent<T>(
  line: string,
  requestKind: SubmissionProgressRequest["kind"],
): SubmissionProgressStreamEvent<T> {
  let value: unknown;
  try {
    value = JSON.parse(line) as unknown;
  } catch {
    throw unreadableSubmissionStreamError();
  }

  if (!isRecord(value) || typeof value.type !== "string") {
    throw unreadableSubmissionStreamError();
  }

  switch (value.type) {
    case "ping":
      return { type: "ping" };
    case "progress":
      if (!isProgressUpdate(value.update)) {
        throw unreadableSubmissionStreamError();
      }
      return { type: "progress", update: value.update };
    case "result":
      if (
        !("result" in value) ||
        (requestKind === "removal"
          ? !isRemovalResult(value.result)
          : !isGhgStatementResult(value.result))
      ) {
        throw unreadableSubmissionStreamError();
      }
      return { type: "result", result: value.result as T };
    case "error":
      if (typeof value.error !== "string" || !value.error.trim()) {
        throw unreadableSubmissionStreamError();
      }
      return { type: "error", error: value.error };
    default:
      throw unreadableSubmissionStreamError();
  }
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
    if (!response.ok) {
      throw new Error(await getAdmissionError(response));
    }
    if (!response.body) {
      throw new Error(SUBMISSION_ADMISSION_FALLBACK);
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
        const event = parseStreamEvent<T>(line, request.kind);
        if (event.type === "ping") continue;
        if (event.type === "progress") onProgress(event.update);
        if (event.type === "result") result = event.result;
        if (event.type === "error") throw new Error(event.error);
      }
      if (done) break;
    }

    if (result === undefined) {
      throw new Error(UNCONFIRMED_SUBMISSION_MESSAGES[request.kind]);
    }
    return result;
  } finally {
    options.signal?.removeEventListener("abort", abortFromCaller);
  }
}
