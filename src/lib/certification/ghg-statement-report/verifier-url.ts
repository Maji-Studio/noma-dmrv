import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import { env } from "@/config/env";

/**
 * Verifier report links are bearer capabilities. The token is a per-report
 * random value: only its SHA-256 digest is persisted on the report row, so a
 * link is revoked by rotating (or clearing) that row, and a leaked link says
 * nothing about any other report.
 *
 * The token is deliberately NOT derived from `reportId` + a global secret.
 * That made every link recomputable from one secret and revocable only by
 * rotating `BETTER_AUTH_SECRET`, which invalidates every session too.
 */
const TOKEN_BYTES = 32;
const TOKEN_HASH_PATTERN = /^[a-f0-9]{64}$/;
const INVALID_TOKEN_HASH = "0".repeat(64);
const LOCAL_HOSTS = new Set(["localhost", "127.0.0.1", "::1"]);

export function generateVerifierToken(): string {
  return randomBytes(TOKEN_BYTES).toString("base64url");
}

export function hashVerifierToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

export function buildVerifierReportUrl(
  reportId: string,
  token: string,
): string {
  const base = new URL(env.NEXT_PUBLIC_APP_URL);
  if (
    base.protocol !== "https:" &&
    env.NODE_ENV !== "test" &&
    !LOCAL_HOSTS.has(base.hostname)
  ) {
    throw new Error(
      "NEXT_PUBLIC_APP_URL must use HTTPS for verifier report links.",
    );
  }
  const url = new URL(
    `/api/ghg-statement-reports/${encodeURIComponent(reportId)}`,
    base,
  );
  url.searchParams.set("token", token);
  return url.toString();
}

/**
 * A token is bound to a report by the row it was stored on: the caller looks
 * the report up by id and passes that row's stored digest.
 */
export function verifyReportCapabilityToken(
  suppliedToken: string,
  storedTokenHash: string | null,
): boolean {
  return verifyReportCapabilityTokenAgainstHashes(suppliedToken, [
    storedTokenHash,
  ]);
}

export function verifyReportCapabilityTokenAgainstHashes(
  suppliedToken: string,
  storedTokenHashes: readonly (string | null)[],
): boolean {
  if (!suppliedToken) return false;
  const suppliedTokenHash = Buffer.from(
    hashVerifierToken(suppliedToken),
    "hex",
  );
  let matched = 0;
  for (const storedTokenHash of storedTokenHashes) {
    const comparableHash =
      storedTokenHash && TOKEN_HASH_PATTERN.test(storedTokenHash)
        ? storedTokenHash
        : INVALID_TOKEN_HASH;
    matched |= Number(
      timingSafeEqual(suppliedTokenHash, Buffer.from(comparableHash, "hex")),
    );
  }
  return matched === 1;
}

/** Returns a capability only when the URL is the canonical URL for this report. */
export function getVerifierTokenFromReportUrl(
  reportUrl: string | null,
  reportId: string,
): string | null {
  if (!reportUrl) return null;
  try {
    const candidate = new URL(reportUrl);
    const base = new URL(env.NEXT_PUBLIC_APP_URL);
    if (
      candidate.origin !== base.origin ||
      candidate.pathname !==
        `/api/ghg-statement-reports/${encodeURIComponent(reportId)}`
    ) {
      return null;
    }
    return candidate.searchParams.get("token");
  } catch {
    return null;
  }
}
