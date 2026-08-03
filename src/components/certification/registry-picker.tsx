/**
 * RegistryPicker — which registry this organization certifies with.
 *
 * Isometric is the one live integration and is always the selection; Puro.earth
 * and CSI are typographic "coming soon" placeholders. Pure UI — no provider
 * enum changes, no external logo assets, nothing to submit. It exists so the
 * choice is visible rather than implied: an operator pasting keys should be able
 * to see *whose* keys they are.
 *
 * Lives here rather than in onboarding because certification owns the registry
 * concept; the onboarding wizard and the certifier settings pane both render it.
 */
"use client";

import { CheckCircleIcon } from "@phosphor-icons/react/dist/ssr";

interface RegistryOption {
  name: string;
  /** Typographic wordmark styling, kept distinct per registry. */
  wordmarkClassName: string;
  tagline: string;
  available: boolean;
}

const REGISTRY_OPTIONS: readonly RegistryOption[] = [
  {
    name: "Isometric",
    wordmarkClassName: "tracking-[0.02em]",
    tagline: "Carbon removal registry",
    available: true,
  },
  {
    name: "Puro.earth",
    wordmarkClassName: "lowercase tracking-[0.04em]",
    tagline: "Coming soon",
    available: false,
  },
  {
    name: "CSI",
    wordmarkClassName: "uppercase tracking-[0.12em]",
    tagline: "Coming soon",
    available: false,
  },
];

export function RegistryPicker() {
  return (
    <ul className="grid grid-cols-1 gap-12 sm:grid-cols-3">
      {REGISTRY_OPTIONS.map((option) => (
        <li key={option.name}>
          <div
            aria-disabled={!option.available}
            className={[
              "flex h-full flex-col justify-between gap-16 border p-16 transition-colors",
              option.available
                ? "border-[var(--clr-pink)] bg-[var(--clr-pink-5)]"
                : "border-[var(--color-border-secondary)] bg-[var(--color-background-white)] opacity-60",
            ].join(" ")}
          >
            <div className="flex items-start justify-between gap-8">
              <span
                className={`title-heading-3 text-[var(--color-text-primary)] ${option.wordmarkClassName}`}
              >
                {option.name}
              </span>
              {option.available && (
                <CheckCircleIcon
                  size={20}
                  weight="fill"
                  className="shrink-0 text-[var(--clr-pink)]"
                  aria-hidden
                />
              )}
            </div>
            <span
              className={[
                "body-caption",
                option.available
                  ? "text-[var(--acc-dist-ink)]"
                  : "text-[var(--color-text-tertiary)]",
              ].join(" ")}
            >
              {option.available ? "Selected" : option.tagline}
            </span>
          </div>
        </li>
      ))}
    </ul>
  );
}
