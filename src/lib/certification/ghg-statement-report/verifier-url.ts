import {
  createHash,
  createHmac,
  timingSafeEqual,
} from "node:crypto";
import { env } from "@/config/env";

const TOKEN_CONTEXT = "noma:ghg-statement-report:v1:";
const LOCAL_HOSTS = new Set(["localhost", "127.0.0.1", "::1"]);

function capabilityToken(reportId: string): string {
  return createHmac("sha256", env.BETTER_AUTH_SECRET)
    .update(`${TOKEN_CONTEXT}${reportId}`)
    .digest("base64url");
}

export function capabilityTokenHashForReport(reportId: string): string {
  return createHash("sha256").update(capabilityToken(reportId)).digest("hex");
}

export function buildVerifierReportUrl(reportId: string): string {
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
  url.searchParams.set("token", capabilityToken(reportId));
  return url.toString();
}

export function verifyReportCapabilityToken(
  reportId: string,
  suppliedToken: string,
  storedTokenHash: string,
): boolean {
  if (!suppliedToken || !/^[a-f0-9]{64}$/.test(storedTokenHash)) return false;
  const expectedToken = capabilityToken(reportId);
  const supplied = Buffer.from(suppliedToken);
  const expected = Buffer.from(expectedToken);
  if (supplied.length !== expected.length) return false;
  if (!timingSafeEqual(supplied, expected)) return false;
  const suppliedHash = createHash("sha256")
    .update(suppliedToken)
    .digest("hex");
  return timingSafeEqual(
    Buffer.from(suppliedHash, "hex"),
    Buffer.from(storedTokenHash, "hex"),
  );
}
