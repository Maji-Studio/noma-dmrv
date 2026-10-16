"use client";

/** PROTOTYPE (throwaway): Variant B, "Rail". Vertical tab rail with status on each entry. */
import { cn } from "@/lib/utils";
import { BatchHeader } from "./prototype-header";
import { useProto } from "./prototype-context";
import { DetailsPanel, KeyNumbers, OpenItemRow, Panel, GROUP_META } from "./prototype-parts";
import { SAMPLES_REQUIRED, TAB_LABELS, TABS, type TabKey } from "./prototype-model";
import { TabBody } from "./prototype-tabs";

type Tone = "bad" | "wait" | "ok" | "off";
const TONE: Record<Tone, string> = {
  bad: "border-[var(--st-bad)] bg-[var(--st-bad-bg)]",
  wait: "border-[var(--st-wait)] bg-[var(--st-wait-bg)]",
  ok: "border-[var(--st-ok)] bg-[var(--st-ok-bg)]",
  off: "border-[var(--st-off-border)] bg-[var(--st-off-bg)]",
};

export function VariantB() {
  const { tab, go, model } = useProto();
  const count = (key: TabKey, groups: ("blocking" | "check")[]) =>
    model.items.filter((item) => item.tab === key && groups.includes(item.group as "blocking" | "check")).length;

  const badge = (key: TabKey): { text: string; tone: Tone } | null => {
    switch (key) {
      case "overview": {
        const n = count("overview", ["blocking", "check"]);
        return n > 0 ? { text: `${n} open`, tone: "bad" } : { text: "Clear", tone: "ok" };
      }
      case "production": {
        const short = model.samples < SAMPLES_REQUIRED;
        return { text: `samples ${model.samples} of ${SAMPLES_REQUIRED}`, tone: short ? "bad" : count("production", ["check"]) > 0 ? "wait" : "ok" };
      }
      case "emissions": {
        const b = count("emissions", ["blocking"]);
        const c = count("emissions", ["check"]);
        if (b + c === 0) return { text: "All recorded", tone: "ok" };
        return { text: `${b + c} open`, tone: b > 0 ? "bad" : "wait" };
      }
      case "removals": {
        const sent = model.slices.filter((s) => s.removal && s.removal.status !== "draft").length;
        return model.removals.length > 0 ? { text: `${model.removals.length} Removal${model.removals.length === 1 ? "" : "s"}`, tone: "off" } : sent === 0 ? { text: "None yet", tone: "off" } : null;
      }
      default:
        return null;
    }
  };

  const next = model.blocking[0] ?? model.check[0] ?? null;

  return (
    <div className="flex flex-col gap-20">
      <BatchHeader />
      <div className="grid min-w-0 grid-cols-[minmax(0,1fr)] gap-20 lg:grid-cols-[232px_minmax(0,1fr)]">
        <nav aria-label="Credit batch sections" className="lg:sticky lg:top-24 lg:self-start">
          <div role="tablist" aria-orientation="vertical" className="flex gap-0 overflow-x-auto border border-[var(--clr-dark-purple-40)] bg-[var(--paper)] lg:flex-col lg:overflow-visible">
            {TABS.map((key) => {
              const b = badge(key);
              return (
                <button
                  key={key}
                  role="tab"
                  type="button"
                  aria-selected={tab === key}
                  onClick={() => go(key)}
                  className={cn(
                    "flex shrink-0 flex-col items-start gap-4 border-b border-[var(--color-border-tertiary)] border-l-4 px-16 py-12 text-left lg:shrink",
                    tab === key ? "border-l-[var(--color-interaction)] bg-[var(--sea)]" : "border-l-transparent hover:bg-[var(--sea)]",
                  )}
                >
                  <span className={cn("body-medium", tab === key && "font-medium")}>{TAB_LABELS[key]}</span>
                  {b && <span className={cn("border px-6 py-1 body-caption", TONE[b.tone])}>{b.text}</span>}
                </button>
              );
            })}
          </div>
        </nav>
        <div className="flex min-w-0 flex-col gap-20">
          {tab === "overview" ? (
            <>
              <KeyNumbers />
              <Panel title={next ? "Next up" : "Nothing to do"}>
                {next ? (
                  <ul>
                    <OpenItemRow item={next} />
                  </ul>
                ) : (
                  <p className="body-medium text-[var(--color-text-secondary)]">Nothing is open on this batch.</p>
                )}
                <p className="body-small text-[var(--color-text-secondary)]">
                  {(["blocking", "check", "waiting"] as const).map((g) => `${model[g].length} ${GROUP_META[g].title.toLowerCase()}`).join(", ")}. The rail shows where each one sits.
                </p>
              </Panel>
              <DetailsPanel />
            </>
          ) : (
            <TabBody tab={tab} />
          )}
        </div>
      </div>
    </div>
  );
}
VariantB.displayName = "VariantB";
