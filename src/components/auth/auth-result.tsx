/**
 * AuthResult — the one outcome screen for auth pages: check your email, email
 * verified, verification failed, invitation not usable, password reset done.
 *
 * One shape (status glyph, sentence-case title, one message, actions) so the
 * outcomes read as the same product instead of per-page variants. The glyph is
 * a real icon at a fixed size, the message and actions are spaced on a single
 * 16px rhythm, and secondary navigation always sits last as a link.
 */
import type { ReactNode } from "react";
import Link from "next/link";
import {
  CheckCircleIcon,
  CircleNotchIcon,
  EnvelopeSimpleIcon,
  WarningCircleIcon,
} from "@phosphor-icons/react/dist/ssr";
import { buttonVariants } from "@/components/ui/button";
import { cn } from "@/lib/utils";

export type AuthResultTone = "pending" | "info" | "success" | "error";

const GLYPH_SIZE = 32;

const TONE_STYLES: Record<
  AuthResultTone,
  { tint: string; icon: ReactNode }
> = {
  pending: {
    tint: "bg-[var(--st-off-bg)] text-[var(--color-text-secondary)]",
    icon: <CircleNotchIcon size={GLYPH_SIZE} className="animate-spin" />,
  },
  info: {
    tint: "bg-[var(--st-run-bg)] text-[var(--st-run)]",
    icon: <EnvelopeSimpleIcon size={GLYPH_SIZE} />,
  },
  success: {
    tint: "bg-[var(--st-ok-bg)] text-[var(--st-ok)]",
    icon: <CheckCircleIcon size={GLYPH_SIZE} />,
  },
  error: {
    tint: "bg-[var(--st-bad-bg)] text-[var(--st-bad)]",
    icon: <WarningCircleIcon size={GLYPH_SIZE} />,
  },
};

interface AuthResultProps {
  tone: AuthResultTone;
  title: string;
  /** The single message under the title. */
  children?: ReactNode;
  /** Buttons and notices, stacked at full width. */
  actions?: ReactNode;
  /** Secondary navigation, always the last element (use `AuthLink`). */
  footer?: ReactNode;
  /** Render without the page-level card when a card already surrounds it. */
  framed?: boolean;
}

export function AuthResult({
  tone,
  title,
  children,
  actions,
  footer,
  framed = true,
}: AuthResultProps) {
  const { tint, icon } = TONE_STYLES[tone];

  return (
    <div
      className={cn(
        "flex flex-col items-center gap-16 text-center",
        framed &&
          "w-full max-w-[400px] mx-auto border border-[var(--color-border-primary)] bg-[var(--color-background-white)] p-32",
      )}
    >
      <span
        aria-hidden
        className={cn("flex h-64 w-64 items-center justify-center rounded-full", tint)}
      >
        {icon}
      </span>
      {/* Unframed results sit under a page that already owns the h1. */}
      {framed ? (
        <h1 className="title-heading-2">{title}</h1>
      ) : (
        <h2 className="title-heading-2">{title}</h2>
      )}
      {children && (
        <div
          role={tone === "error" ? "alert" : "status"}
          className="body-medium text-[var(--color-text-secondary)]"
        >
          {children}
        </div>
      )}
      {actions && <div className="flex w-full flex-col gap-16">{actions}</div>}
      {footer}
    </div>
  );
}

/** Full-width primary link styled as the app's primary button. */
export function AuthPrimaryLink({
  href,
  children,
}: {
  href: string;
  children: ReactNode;
}) {
  return (
    <Link
      href={href}
      className={buttonVariants({ variant: "primary", width: "full" })}
    >
      {children}
    </Link>
  );
}

/** Quiet secondary navigation under the actions. */
export function AuthLink({
  href,
  children,
}: {
  href: string;
  children: ReactNode;
}) {
  return (
    <Link
      href={href}
      className="body-small text-[var(--color-text-tertiary)] hover:text-[var(--clr-dark-purple)]"
    >
      {children}
    </Link>
  );
}
