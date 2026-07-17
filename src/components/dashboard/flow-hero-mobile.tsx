/**
 * FlowHeroMobile — the <768px stacked fallback for the isometric scene: the
 * same stations and mass chips as vertically linked cards. Doubles as the
 * scene's text equivalent, so every figure the art carries is present here
 * as real text.
 */
"use client";

import Link from "next/link";
import type {
  DashboardMassFlowSegment,
  DashboardStation,
  DashboardStationKey,
} from "@/data-access/dashboard-overview";
import { formatTonnes } from "./flow-hero-scene";

/** Compact glyph per station, referencing the shared defs. */
const STATION_GLYPH: Record<
  DashboardStationKey,
  { viewBox: string; href: string; color: string }
> = {
  suppliers: { viewBox: "-4 -30 52 36", href: "#fh-heap", color: "var(--acc-prod-ink)" },
  feedstock: { viewBox: "-24 -48 48 56", href: "#fh-bin", color: "var(--acc-prod-ink)" },
  production: { viewBox: "-28 -64 62 70", href: "#fh-bag", color: "var(--acc-infra-ink)" },
  products: { viewBox: "-28 -64 62 70", href: "#fh-bag", color: "var(--acc-prod-ink)" },
  deliveries: { viewBox: "-26 -72 106 86", href: "#fh-truck", color: "var(--acc-dist-ink)" },
  applications: { viewBox: "-4 -30 52 36", href: "#fh-heap", color: "var(--acc-dist-ink)" },
};

/** Field plot with spread rows — the application station's mini glyph. */
function ApplicationGlyph() {
  return (
    <svg
      width={44}
      height={30}
      viewBox="928 272 234 122"
      fill="none"
      className="flex-none"
      style={{ color: "var(--acc-dist-ink)" }}
      aria-hidden
    >
      <path
        d="M1045,280 L1155,333 L1045,386 L935,333 Z"
        fill="var(--sea)"
        stroke="currentColor"
        strokeWidth="4"
      />
      <path d="M957,344 L1067,291 L1089,301 L979,354 Z" fill="var(--clr-dark-purple-30)" />
      <path d="M1001,365 L1111,312 L1133,322 L1023,375 Z" fill="var(--clr-dark-purple-30)" />
    </svg>
  );
}

/** The drum kiln reads better than a bag at chip size — inline mini glyph. */
function ProductionGlyph() {
  return (
    <svg
      width={44}
      height={38}
      viewBox="450 255 215 115"
      fill="none"
      className="flex-none"
      style={{ color: "var(--acc-infra-ink)" }}
      aria-hidden
    >
      <path d="M495,310 L580,268 M515,350 L600,307" stroke="currentColor" strokeWidth="4" />
      <ellipse
        cx="590"
        cy="288"
        rx="22"
        ry="11"
        transform="rotate(63 590 288)"
        fill="currentColor"
        fillOpacity=".1"
        stroke="currentColor"
        strokeWidth="4"
      />
    </svg>
  );
}

interface FlowHeroMobileProps {
  stations: DashboardStation[];
  massFlow: DashboardMassFlowSegment[];
}

export function FlowHeroMobile({ stations, massFlow }: FlowHeroMobileProps) {
  return (
    <div className="flex flex-col px-16 py-16 md:hidden" data-testid="flow-hero-mobile">
      {stations.map((station, index) => {
        const glyph = STATION_GLYPH[station.key];
        const segment = index < massFlow.length ? massFlow[index] : undefined;
        return (
          <div key={station.key} className="flex flex-col">
            <Link
              href={station.href}
              className="flex items-center gap-12 border-[1.5px] border-[var(--ink)] bg-[var(--paper)] px-12 py-10 transition-colors hover:bg-[var(--sea)]"
            >
              {station.key === "production" ? (
                <ProductionGlyph />
              ) : station.key === "applications" ? (
                <ApplicationGlyph />
              ) : (
                <svg
                  width={44}
                  height={36}
                  viewBox={glyph.viewBox}
                  fill="none"
                  className="flex-none"
                  style={{ color: glyph.color }}
                  aria-hidden
                >
                  <use href={glyph.href} />
                </svg>
              )}
              <span className="flex min-w-0 flex-1 flex-col gap-2">
                <span className="text-[13.5px] font-bold">{station.name}</span>
                <span className="font-[family-name:var(--font-mono)] text-[9px] uppercase tracking-[0.08em] text-[var(--clr-dark-purple-50)]">
                  {station.totalLabel}
                  {station.reasons.some((reason) => reason.tone === "run")
                    ? ` · ${station.reasons.find((reason) => reason.tone === "run")?.text}`
                    : ""}
                </span>
              </span>
              {station.attention > 0 && (
                <span className="rounded-full bg-[var(--st-wait)] px-7 py-3 font-[family-name:var(--font-mono)] text-[10px] leading-none text-white">
                  {station.attention}
                </span>
              )}
              <span
                className="font-[family-name:var(--font-mono)] text-[12px] text-[var(--clr-dark-purple-50)]"
                aria-hidden
              >
                →
              </span>
            </Link>
            {segment && (
              <div className="flex items-center gap-8 py-4 pl-32">
                <span
                  className="h-18 w-0 border-l-[1.5px] border-dashed border-[var(--clr-dark-purple-40)]"
                  aria-hidden
                />
                <span className="border border-[var(--clr-dark-purple-30)] bg-[var(--bg)] px-5 py-2 font-[family-name:var(--font-mono)] text-[9px]">
                  {formatTonnes(segment.tonnes)}
                </span>
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}
