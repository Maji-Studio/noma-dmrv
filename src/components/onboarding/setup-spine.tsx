/**
 * SetupSpine — the getting-started guide's signature element.
 *
 * The Setup steps are drawn as the traceability spine itself: a vertical chain
 * of links from Facility to Credit batch, echoing the app's chain-of-custody
 * identity. Completed links fill in (pink node + solid rail); the single next
 * step is the one bold moment (ring node, tinted row, primary CTA); everything
 * downstream stays quiet. When the last link fills, the whole guide clears.
 *
 * The chain is a genuine sequence — a credit batch depends on a production run
 * depends on feedstock — so numbered links encode real order, not decoration.
 */
"use client";

import { CheckIcon } from "@phosphor-icons/react/dist/ssr";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui";
import type { SetupStep } from "./use-setup-steps";

type LinkState = "done" | "active" | "upcoming";

function linkState(step: SetupStep, index: number, activeIndex: number): LinkState {
  if (step.done) return "done";
  if (index === activeIndex) return "active";
  return "upcoming";
}

function SpineNode({ state, n }: { state: LinkState; n: number }) {
  return (
    <span
      aria-hidden
      className={[
        "flex h-32 w-32 shrink-0 items-center justify-center rounded-none border label-button transition-colors",
        state === "done" &&
          "border-[var(--clr-pink)] bg-[var(--clr-pink)] text-white",
        state === "active" &&
          "border-2 border-[var(--clr-pink)] text-[var(--clr-pink)]",
        state === "upcoming" &&
          "border-[var(--color-border-secondary)] text-[var(--color-text-tertiary)]",
      ]
        .filter(Boolean)
        .join(" ")}
    >
      {state === "done" ? <CheckIcon size={16} weight="bold" /> : n}
    </span>
  );
}

interface SetupSpineProps {
  steps: SetupStep[];
  activeIndex: number;
  /** Facility step, when no facility exists, reopens the wizard instead of routing. */
  onStartFacility: () => void;
}

export function SetupSpine({
  steps,
  activeIndex,
  onStartFacility,
}: SetupSpineProps) {
  const router = useRouter();

  return (
    <ol className="flex flex-col">
      {steps.map((step, index) => {
        const state = linkState(step, index, activeIndex);
        const isLast = index === steps.length - 1;
        const startsFacilityWizard = step.id === "facility";

        return (
          <li key={step.id} className="flex gap-16">
            {/* Marker column: node + the rail that links it to the next step. */}
            <div className="flex flex-col items-center">
              <SpineNode state={state} n={index + 1} />
              {!isLast && (
                <span
                  aria-hidden
                  className={[
                    "my-4 w-2 flex-1",
                    state === "done"
                      ? "bg-[var(--clr-pink)]"
                      : "bg-[var(--color-border-secondary)]",
                  ].join(" ")}
                />
              )}
            </div>

            {/* Content column. The active step is the single tinted, bold row. */}
            <div
              className={[
                "min-w-0 flex-1 pb-24",
                state === "active"
                  ? "-mx-12 mb-4 border border-[var(--clr-pink-30)] bg-[var(--clr-pink-5)] px-12 pt-12"
                  : "",
              ].join(" ")}
            >
              <div className="flex flex-wrap items-start justify-between gap-12">
                <div className="flex min-w-0 flex-col gap-2">
                  <span
                    className={[
                      "body-medium font-medium",
                      state === "upcoming"
                        ? "text-[var(--color-text-tertiary)]"
                        : "text-[var(--color-text-primary)]",
                    ].join(" ")}
                  >
                    {step.label}
                  </span>
                  <span className="body-caption text-[var(--color-text-tertiary)]">
                    {step.description}
                  </span>
                </div>

                {state === "done" && (
                  <span className="label-micro shrink-0 text-[var(--st-ok)]">
                    Done
                  </span>
                )}

                {state === "active" &&
                  (startsFacilityWizard ? (
                    <Button
                      variant="primary"
                      size="small"
                      onClick={onStartFacility}
                    >
                      {step.ctaLabel}
                    </Button>
                  ) : (
                    <Button
                      variant="primary"
                      size="small"
                      onClick={() => router.push(step.href)}
                    >
                      {step.ctaLabel}
                    </Button>
                  ))}

                {state === "upcoming" && (
                  <Link
                    href={step.href}
                    className="body-small shrink-0 text-[var(--color-text-tertiary)] underline underline-offset-2 transition-colors hover:text-[var(--color-text-secondary)]"
                  >
                    {step.ctaLabel}
                  </Link>
                )}
              </div>
            </div>
          </li>
        );
      })}
    </ol>
  );
}
