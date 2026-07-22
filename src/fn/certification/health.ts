"use server";

import { env } from "@/config/env";
import { getCertifierCredentialsStatus } from "@/data-access/certifier-credentials";
import { requireAdminAction } from "@/lib/auth/server";
import type { ActionResult } from "@/types/actions";
import { withAction } from "../with-action";

export interface AllowlistStatus {
  /** "default" = safe built-in families; "custom" = an env override replaced them. */
  mode: "default" | "custom";
  /** Number of explicitly-configured host suffixes (0 when using defaults). */
  count: number;
}

/**
 * Read-only Isometric integration status for the Settings → Health panel.
 * Returns ONLY non-secret booleans / enums / counts — never token or secret
 * values (CLAUDE.md: never expose secrets). Admin-gated.
 */
export interface CertificationHealth {
  environment: "sandbox" | "production";
  /** Both Isometric credentials present — never the values themselves. */
  credentialsConfigured: boolean;
  uploadAllowlist: AllowlistStatus;
  redirectAllowlist: AllowlistStatus;
}

function describeAllowlist(raw: string | undefined): AllowlistStatus {
  if (!raw) return { mode: "default", count: 0 };
  const count = raw
    .split(",")
    .map((entry) => entry.trim())
    .filter((entry) => entry.length > 0).length;
  return { mode: "custom", count };
}

export async function loadCertificationHealth(): Promise<
  ActionResult<CertificationHealth>
> {
  return withAction(async (orgCtx) => {
    await requireAdminAction();
    const credentials = await getCertifierCredentialsStatus(
      orgCtx,
      orgCtx.organizationId,
      "isometric",
    );
    return {
      environment: env.ISOMETRIC_ENVIRONMENT,
      credentialsConfigured: credentials.configured,
      uploadAllowlist: describeAllowlist(env.ISOMETRIC_UPLOAD_HOST_ALLOWLIST),
      redirectAllowlist: describeAllowlist(env.ISOMETRIC_STORAGE_REDIRECT_HOSTS),
    };
  });
}
