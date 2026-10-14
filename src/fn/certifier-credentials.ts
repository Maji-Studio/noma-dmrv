"use server";

import { env } from "@/config/env";
import {
  getCertifierCredentialsStatus,
  verifyIsometricCredentialsForOrganization,
  upsertCertifierCredentials,
  type CertifierCredentialsStatus,
} from "@/data-access/certifier-credentials";
import { logActionError } from "@/fn/action-errors";
import { withAction } from "@/fn/with-action";
import type { OrgContext } from "@/lib/auth/server";
import {
  certifierVerificationFailureMessage,
  certifierVerificationSuccessMessage,
} from "@/lib/certification/certifier-credentials-verification";
import { SafeError } from "@/lib/errors";
import { IsometricApiError } from "@/lib/isometric";
import {
  orgCertifierCredentialsTargetSchema,
  setOrgCertifierCredentialsSchema,
} from "@/schemas/organizations";
import type { ActionResult } from "@/types/actions";

const LOG_MESSAGE = "certifier credentials action failed";

const PROVIDER = "isometric" as const;

function organizationIdForLog(input: unknown): string | undefined {
  const result = orgCertifierCredentialsTargetSchema.safeParse(input);
  return result.success ? result.data.organizationId : undefined;
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
  return withAction(
    async (ctx) => {
      const values = setOrgCertifierCredentialsSchema.parse(input);
      if (!env.CREDENTIALS_ENCRYPTION_KEY) {
        throw new SafeError(
          "Credential encryption is not configured. Ask a Platform Admin to configure it.",
        );
      }
      await upsertCertifierCredentials(ctx, { ...values, provider: PROVIDER });

      // Verify AFTER the write, deliberately. The keys are stored either way,
      // so a registry outage never costs the operator their typing; the
      // verification only reports whether the stored keys work right now.
      const [status, verification] = await Promise.all([
        getCertifierCredentialsStatus(ctx, values.organizationId, PROVIDER),
        verifyCertifierCredentials(ctx, values.organizationId),
      ]);
      return { status, verification };
    },
    {
      fallbackMessage: "Failed to save Isometric credentials.",
      log: {
        message: LOG_MESSAGE,
        context: {
          op: "certifier-credentials:set",
          ...(organizationId ? { organizationId } : {}),
        },
      },
    },
  );
}

/**
 * Ask Isometric to list the organization's projects with the stored keys. It is
 * the cheapest authenticated read in the API and the one the project picker
 * needs next, so a pass here means the next step will work.
 */
async function verifyCertifierCredentials(
  ctx: OrgContext,
  organizationId: string,
): Promise<CertifierCredentialsVerification> {
  try {
    const projectCount = await verifyIsometricCredentialsForOrganization(
      ctx,
      organizationId,
    );
    return {
      ok: true,
      projectCount,
      message: certifierVerificationSuccessMessage(projectCount),
    };
  } catch (error) {
    logActionError(error, {
      message: "isometric credential verification failed",
      context: { organizationId },
    });
    return {
      ok: false,
      message: certifierVerificationFailureMessage(
        error instanceof IsometricApiError ? error : null,
      ),
    };
  }
}

export async function getOrgCertifierCredentialsStatusFn(
  input: unknown,
): Promise<ActionResult<CertifierCredentialsStatus>> {
  const organizationId = organizationIdForLog(input);
  return withAction(
    async (ctx) => {
      const values = orgCertifierCredentialsTargetSchema.parse(input);
      return getCertifierCredentialsStatus(ctx, values.organizationId, PROVIDER);
    },
    {
      fallbackMessage: "Failed to load Isometric credential status.",
      log: {
        message: LOG_MESSAGE,
        context: {
          op: "certifier-credentials:status",
          ...(organizationId ? { organizationId } : {}),
        },
      },
    },
  );
}

// A remove action used to sit here, behind a "Remove" button above the
// credentials form. The form now keeps both fields on screen and replaces a key
// by typing over its mask, so nothing calls it. `deleteCertifierCredentials`
// remains in data-access for test teardown.
