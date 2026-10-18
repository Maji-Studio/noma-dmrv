import type { ReactNode } from "react";
import { Notice } from "@/components/ui";
import { OAUTH_RESTART_MESSAGE } from "@/lib/auth/oauth-client";
import { oauthAppNameStart } from "./oauth-labels";

/** The sign-in card shell, shared by the organization picker and the consent screen. */
export function OAuthCard({ title, intro, children }: { title: string; intro?: ReactNode; children: ReactNode }) {
  return (
    <div className="w-full max-w-[400px] mx-auto px-16 sm:px-0">
      <div className="mb-24 text-center flex flex-col gap-12">
        <h1 className="title-heading-3">{title}</h1>
        {intro && <p className="body-medium text-[var(--color-text-secondary)]">{intro}</p>}
      </div>
      <div className="bg-[var(--color-background-white)] rounded-none border border-[var(--color-border-primary)] p-32 shadow-sm flex flex-col gap-24">
        {children}
      </div>
    </div>
  );
}

/** What the person is about to connect: the app's name and the host it identifies as. */
export function OAuthAppIdentity({ name, host, redirectHost }: { name: string | null; host: string | null; redirectHost?: string | null }) {
  return (
    <dl className="flex flex-col gap-4 border-b border-[var(--color-border-tertiary)] pb-16">
      <div><dt className="sr-only">App</dt><dd className="body-medium font-medium break-words">{oauthAppNameStart(name)}</dd></div>
      {host && <div><dt className="sr-only">App host</dt><dd className="body-small text-[var(--color-text-secondary)] break-all">{host}</dd></div>}
      {redirectHost && (
        <div className="body-small text-[var(--color-text-secondary)]">
          <dt className="inline">Returns to </dt><dd className="inline break-all">{redirectHost}</dd>
        </div>
      )}
    </dl>
  );
}

export function OAuthRestartNotice() {
  return <Notice tone="error">{OAUTH_RESTART_MESSAGE}</Notice>;
}
