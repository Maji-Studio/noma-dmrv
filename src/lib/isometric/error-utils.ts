import { sanitizeErrorMessage } from "@/lib/log";
import { IsometricApiError } from "./client";

const MAX_ERROR_TEXT_LENGTH = 500;
const MAX_SUMMARY_LENGTH = 240;
const MAX_ARRAY_ITEMS = 20;
const MAX_DEPTH = 6;
const REDACTED = "[REDACTED]";

const REDACT_KEYS = new Set([
  "accesstoken",
  "authorization",
  "clientsecret",
  "email",
  "name",
  "password",
  "secret",
  "token",
  "xclientsecret",
]);

function isRedactedKey(key: string): boolean {
  return REDACT_KEYS.has(key.toLowerCase().replace(/[-_\s]/g, ""));
}

function truncate(value: string, maxLength: number): string {
  return value.length > maxLength ? `${value.slice(0, maxLength)}...` : value;
}

export function sanitizeIsometricErrorBody(
  body: unknown,
  depth = 0,
): unknown {
  if (body == null) return body;
  if (typeof body === "string") {
    return truncate(sanitizeErrorMessage(body, MAX_ERROR_TEXT_LENGTH), MAX_ERROR_TEXT_LENGTH);
  }
  if (typeof body !== "object") return body;
  if (depth >= MAX_DEPTH) return "[MaxDepth]";

  if (Array.isArray(body)) {
    return body
      .slice(0, MAX_ARRAY_ITEMS)
      .map((item) => sanitizeIsometricErrorBody(item, depth + 1));
  }

  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(body as Record<string, unknown>)) {
    out[key] = isRedactedKey(key)
      ? REDACTED
      : sanitizeIsometricErrorBody(value, depth + 1);
  }
  return out;
}

function bodyReason(body: unknown): string | null {
  const sanitized = sanitizeIsometricErrorBody(body);
  if (typeof sanitized === "string") return sanitized;
  if (!sanitized || typeof sanitized !== "object") return null;

  const record = sanitized as Record<string, unknown>;
  for (const key of ["message", "detail", "error", "reason"]) {
    const value = record[key];
    if (typeof value === "string" && value.trim()) return value;
  }

  const errors = record.errors;
  if (Array.isArray(errors) && errors.length > 0) {
    const first = errors[0];
    if (typeof first === "string") return first;
    if (first && typeof first === "object") {
      for (const key of ["message", "detail", "error", "reason"]) {
        const value = (first as Record<string, unknown>)[key];
        if (typeof value === "string" && value.trim()) return value;
      }
    }
  }

  return null;
}

export function describeIsometricApiError(
  error: IsometricApiError,
  fallback = "The provider rejected the request.",
): string {
  const reason = bodyReason(error.body);
  if (reason) {
    return truncate(
      `Provider rejected the request${error.status ? ` (${error.status})` : ""}: ${reason}`,
      MAX_SUMMARY_LENGTH,
    );
  }
  if (error.status) {
    return `Provider rejected the request (${error.status}).`;
  }
  return fallback;
}
