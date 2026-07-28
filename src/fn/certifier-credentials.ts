"use server";

import { z } from "zod";
import { env } from "@/config/env";
import {
  getCertifierCredentialsStatus,
  upsertCertifierCredentials,
  type CertifierCredentialsStatus,
} from "@/data-access/certifier-credentials";
import { logActionError } from "@/fn/action-errors";
import { requireOrgContext } from "@/lib/auth/server";
import { SafeError, toActionError } from "@/lib/errors";
import {
  getIsometricClientForOrg,
  IsometricApiError,
  listProjects,
} from "@/lib/isometric";
import {
  orgCertifierCredentialsTargetSchema,
  setOrgCertifierCredentialsSchema,
} from "@/schemas/organizations";
import type { ActionResult } from "@/types/actions";

const PROVIDER = "isometric" as const;

function organizationIdForLog(input: unknown): string | undefined {
  const result = orgCertifierCredentialsTargetSchema.safeParse(input);
  return result.success ? result.data.organizationId : undefined;
}

async function toCredentialsResult<T>(
  organizationId: string | undefined,
  operation: () => Promise<T>,
  fallbackMessage: string,
): Promise<ActionResult<T>> {
  try {
    return { success: true, data: await operation() };
  } catch (error) {
    if (error instanceof z.ZodError) {
      return {
        success: false,
        error: error.issues.map((issue) => issue.message).join(", "),
      };
    }
    logActionError(error, {
      message: "certifier credentials action failed",
      context: organizationId ? { organizationId } : undefined,
    });
    return { success: false, error: toActionError(error, fallbackMessage) };
  }
}

/**
 * The outcome of the read Isometric is asked to perform with the keys that were
 * just stored. Saving is the connection test — there is no separate Connect
 * step, because a key that cannot list projects is not saved-and-fine, it is
 * broken, and the operator is standing right there able to fix it.
 */
export interface CertifierCredentialsVerification {
  ok: boolean;
  /** Operator-facing, already safe to render verbatim. */
  message: string;
  /** Present on success — what the keys could actually see. */
  projectCount?: number;
}

export interface SetCertifierCredentialsResult {
  status: CertifierCredentialsStatus;
  verification: CertifierCredentialsVerification;
}

export async function setOrgCertifierCredentialsFn(
  input: unknown,
): Promise<ActionResult<SetCertifierCredentialsResult>> {
  const organizationId = organizationIdForLog(input);
  return toCredentialsResult(
    organizationId,
    async () => {
      const ctx = await requireOrgContext();
      const values = setOrgCertifierCredentialsSchema.parse(input);
      if (!env.CREDENTIALS_ENCRYPTION_KEY) {
        throw new SafeError("Credential encryption key is not configured");
      }
      await upsertCertifierCredentials(ctx, { ...values, provider: PROVIDER });

      // Verify AFTER the write, deliberately. The keys are stored either way,
      // so a registry outage never costs the operator their typing; the
      // verification only reports whether the stored keys work right now.
      const [status, verification] = await Promise.all([
        getCertifierCredentialsStatus(ctx, values.organizationId, PROVIDER),
        verifyCertifierCredentials(values.organizationId),
      ]);
      return { status, verification };
    },
    "Failed to save Isometric credentials.",
  );
}

/**
 * Ask Isometric to list the organization's projects with the stored keys. It is
 * the cheapest authenticated read in the API and the one the project picker
 * needs next, so a pass here means the next step will work.
 */
async function verifyCertifierCredentials(
  organizationId: string,
): Promise<CertifierCredentialsVerification> {
  try {
    const client = await getIsometricClientForOrg(organizationId);
    const projects = await listProjects(client);
    return {
      ok: true,
      projectCount: projects.length,
      message:
        projects.length === 0
          ? "Connected to Isometric. This account has no projects yet, so there is nothing to link the facility to."
          : `Connected to Isometric. ${projects.length} project${
              projects.length === 1 ? "" : "s"
            } available to link.`,
    };
  } catch (error) {
    logActionError(error, {
      message: "isometric credential verification failed",
      context: { organizationId },
    });
    return { ok: false, message: verificationFailureMessage(error) };
  }
}

function verificationFailureMessage(error: unknown): string {
  if (!(error instanceof IsometricApiError)) {
    return "Keys saved, but the connection check could not run. Reload the page to try again.";
  }
  if (error.code === "not_configured") {
    return "Keys saved, but this deployment is not configured to reach Isometric. Ask a Platform Admin to check Diagnostics.";
  }
  if (error.code === "network") {
    return "Keys saved, but Isometric could not be reached. It may be a network problem rather than the keys.";
  }
  if (error.status === 401 || error.status === 403) {
    return "Keys saved, but Isometric rejected them. Check the access token and client secret, then save again.";
  }
  return `Keys saved, but Isometric returned an error (${
    error.status ?? "unknown"
  }). Check the keys, then save again.`;
}

export async function getOrgCertifierCredentialsStatusFn(
  input: unknown,
): Promise<ActionResult<CertifierCredentialsStatus>> {
  const organizationId = organizationIdForLog(input);
  return toCredentialsResult(
    organizationId,
    async () => {
      const ctx = await requireOrgContext();
      const values = orgCertifierCredentialsTargetSchema.parse(input);
      return getCertifierCredentialsStatus(ctx, values.organizationId, PROVIDER);
    },
    "Failed to load Isometric credential status.",
  );
}

// A remove action used to sit here, behind a "Remove" button above the
// credentials form. The form now keeps both fields on screen and replaces a key
// by typing over its mask, so nothing calls it. `deleteCertifierCredentials`
// remains in data-access for test teardown.
