import type { ActionFailure } from "@/fn/action-errors";
import type { ApiContextDenial } from "@/lib/auth/api-context";
import type { DomainErrorCode } from "@/lib/domain-errors";
import { IDEMPOTENCY_RETRY_AFTER_SECONDS } from "@/config/operations";

export const ACTION_STATUS = {
  validation_failed: 422, not_found: 404, stale_version: 412,
  conflict: 409, certification_locked: 409, insufficient_stock: 409,
  forbidden: 403, reference_not_found: 422, reference_ambiguous: 422,
  deadline_exceeded: 500, outcome_unknown: 500, idempotency_in_progress: 409,
  idempotency_key_reused: 422, key_already_used: 409, replay_unavailable: 409,
} satisfies Record<DomainErrorCode, number>;

const TITLES: Record<number, string> = {
  400: "Bad request", 401: "Unauthorized", 403: "Forbidden", 404: "Not found",
  409: "Conflict", 412: "Precondition failed", 413: "Payload too large",
  415: "Unsupported media type", 422: "Validation failed", 428: "Precondition required",
  429: "Too many requests", 500: "Internal server error", 503: "Service unavailable",
};
export function apiResponseHeaders(requestId: string): Headers {
  return new Headers({ "Cache-Control": "private, no-store", "X-Request-Id": requestId });
}

type ProblemOptions = {
  status: number; code: string; detail: string; instance: string; requestId: string;
  retryable?: boolean;
  errors?: { pointer: string; code: string; detail: string; meta?: Record<string, unknown> }[];
  conflict?: ActionFailure["conflict"]; blockers?: ActionFailure["blockers"];
  retryAfterSeconds?: number;
};
export function problemResponse(options: ProblemOptions): Response {
  const { status, code, instance, requestId } = options;
  const internal = status >= 500;
  const headers = apiResponseHeaders(requestId);
  headers.set("Content-Type", "application/problem+json");
  if (status === 401) headers.set("WWW-Authenticate", "Bearer");
  if (options.retryAfterSeconds !== undefined) headers.set("Retry-After", String(options.retryAfterSeconds));
  return Response.json({
    type: `urn:noma:problem:${code}`, title: TITLES[status] ?? "Request failed", status,
    detail: internal ? "The request could not be completed." : options.detail,
    instance, code, retryable: options.retryable ?? false,
    errors: internal ? [] : options.errors ?? [],
    ...(!internal && options.conflict ? { conflict: options.conflict } : {}),
    ...(!internal && options.blockers ? { blockers: options.blockers } : {}),
  }, { status, headers });
}

export function apiDenialResponse(denial: ApiContextDenial, instance: string, requestId: string) {
  const status = denial === "api_access_disabled" || denial === "missing_scope" || denial === "insufficient_role" ? 403 : 401;
  return problemResponse({ status, code: denial, detail: "The credential cannot authorize this request.", instance, requestId });
}

export function actionFailureResponse(failure: ActionFailure, instance: string, requestId: string) {
  const code = failure.code ?? "internal_error";
  return problemResponse({
    status: failure.code ? ACTION_STATUS[failure.code] : 500,
    code, detail: failure.error, instance, requestId,
    retryable: ["deadline_exceeded", "outcome_unknown", "idempotency_in_progress"].includes(code),
    ...(code === "idempotency_in_progress" ? { retryAfterSeconds: IDEMPOTENCY_RETRY_AFTER_SECONDS } : {}),
    errors: failure.issues?.map((issue) => ({
      pointer: issue.path.length ? `/${issue.path.map((part) => String(part).replaceAll("~", "~0").replaceAll("/", "~1")).join("/")}` : "",
      code: issue.code, detail: issue.message, ...(issue.meta ? { meta: issue.meta } : {}),
    })),
    conflict: failure.conflict, blockers: failure.blockers,
  });
}
