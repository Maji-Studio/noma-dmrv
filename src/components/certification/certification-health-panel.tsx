/**
 * CertificationHealthPanel
 * Read-only Isometric integration status for Settings → Environment & health.
 * Surfaces the otherwise-invisible env config — environment, whether
 * credentials are present, and the upload/redirect host-allowlist posture —
 * WITHOUT ever rendering a token or secret value (the loader returns only
 * booleans / enums / counts; see fn/certification/health.ts). Admin-gated by
 * the parent; the loader is admin-gated server-side as a backstop.
 */
"use client";

import { CheckCircleIcon, XCircleIcon } from "@phosphor-icons/react/dist/ssr";
import type { AllowlistStatus } from "@/fn/certification";
import { useCertificationHealth } from "@/hooks/use-certification";
import { Field } from "./panel-layout";

function AllowlistValue({ status }: { status: AllowlistStatus }) {
  if (status.mode === "default") {
    return <span className="body-small">Default safe families</span>;
  }
  return (
    <span className="body-small">
      Custom · {status.count} host{status.count === 1 ? "" : "s"}
    </span>
  );
}

export function CertificationHealthPanel() {
  const { data, isLoading, error } = useCertificationHealth();

  if (isLoading) {
    return (
      <p className="body-small text-[var(--color-text-tertiary)]">
        Loading integration status…
      </p>
    );
  }

  if (error || !data) {
    return (
      <p className="body-small text-[var(--color-signal-red)]" role="alert">
        Couldn&apos;t load integration status
        {error instanceof Error ? `: ${error.message}` : "."}
      </p>
    );
  }

  const isProduction = data.environment === "production";

  return (
    <div className="grid grid-cols-1 gap-y-16 sm:grid-cols-2 sm:gap-x-16">
      <Field label="Environment">
        <span className="body-small">
          {isProduction ? "Production" : "Sandbox"}
        </span>
      </Field>
      <Field label="Credentials">
        {data.credentialsConfigured ? (
          <span className="body-small inline-flex items-center gap-6 text-[var(--st-ok)]">
            <CheckCircleIcon size={16} weight="fill" aria-hidden />
            Configured
          </span>
        ) : (
          <span className="body-small inline-flex items-center gap-6 text-[var(--color-signal-red)]">
            <XCircleIcon size={16} weight="fill" aria-hidden />
            Not configured
          </span>
        )}
      </Field>
      <Field label="Upload host allowlist">
        <AllowlistValue status={data.uploadAllowlist} />
      </Field>
      <Field label="Document redirect allowlist">
        <AllowlistValue status={data.redirectAllowlist} />
      </Field>
    </div>
  );
}
