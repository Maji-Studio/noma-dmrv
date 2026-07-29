import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Styleguide",
  robots: "noindex",
};

/**
 * The five canonical state classes of the status ramp, in the order used by
 * `src/lib/status-state.ts`. Each has a solid, a `-bg` tint and a `-border`.
 */
const STATUS_RAMP = [
  { label: "Neutral", token: "st-off" },
  { label: "In progress", token: "st-run" },
  { label: "Success", token: "st-ok" },
  { label: "Warning", token: "st-wait" },
  { label: "Error", token: "st-bad" },
] as const;

/* ── tiny helpers ── */

function Section({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <section className="flex flex-col gap-24">
      <h2 className="title-chapter-title" style={{ color: "var(--color-text-secondary)" }}>
        {title}
      </h2>
      {children}
    </section>
  );
}

function Swatch({
  name,
  cssVar,
  dark,
}: {
  name: string;
  cssVar: string;
  dark?: boolean;
}) {
  return (
    <div className="flex flex-col gap-6">
      <div
        className="h-48 w-full border"
        style={{
          background: `var(${cssVar})`,
          borderColor: "var(--color-border-tertiary)",
        }}
      />
      <span className="body-caption" style={{ color: dark ? "var(--color-text-primary)" : undefined }}>
        {name}
      </span>
      <span className="body-caption" style={{ color: "var(--color-text-tertiary)" }}>
        {cssVar}
      </span>
    </div>
  );
}

function ColorRow({
  label,
  swatches,
}: {
  label: string;
  swatches: { name: string; cssVar: string }[];
}) {
  return (
    <div className="flex flex-col gap-12">
      <p className="body-small-bold">{label}</p>
      <div className="grid grid-cols-3 gap-12 sm:grid-cols-5 lg:grid-cols-7">
        {swatches.map((s) => (
          <Swatch key={s.cssVar} {...s} />
        ))}
      </div>
    </div>
  );
}

/* ── page ── */

export default function StyleguidePage() {
  return (
    <div
      className="min-h-screen py-48 px-24 lg:px-64"
      style={{ background: "var(--color-background-white)" }}
    >
      <div className="mx-auto flex max-w-[1200px] flex-col gap-64">
        {/* Header */}
        <div className="flex flex-col gap-8">
          <h1 className="title-heading-1">Styleguide</h1>
          <p className="body-lead" style={{ color: "var(--color-text-secondary)" }}>
            All design tokens from globals.css
          </p>
        </div>

        {/* ═══ BRAND COLORS ═══ */}
        <Section title="Brand Colors">
          <ColorRow
            label="Dark Purple"
            swatches={[
              { name: "100", cssVar: "--clr-dark-purple" },
              { name: "80", cssVar: "--clr-dark-purple-80" },
              { name: "60", cssVar: "--clr-dark-purple-60" },
              { name: "40", cssVar: "--clr-dark-purple-40" },
              { name: "30", cssVar: "--clr-dark-purple-30" },
              { name: "20", cssVar: "--clr-dark-purple-20" },
              { name: "10", cssVar: "--clr-dark-purple-10" },
            ]}
          />
        </Section>

        {/* ═══ ACCENT COLORS ═══ */}
        <Section title="Accent Colors">
          <ColorRow
            label="Rose"
            swatches={[
              { name: "100", cssVar: "--clr-rose" },
              { name: "80", cssVar: "--clr-rose-80" },
              { name: "60", cssVar: "--clr-rose-60" },
              { name: "40", cssVar: "--clr-rose-40" },
              { name: "20", cssVar: "--clr-rose-20" },
              { name: "10", cssVar: "--clr-rose-10" },
            ]}
          />
          <ColorRow
            label="Orange"
            swatches={[
              { name: "100", cssVar: "--clr-orange" },
              { name: "80", cssVar: "--clr-orange-80" },
              { name: "60", cssVar: "--clr-orange-60" },
              { name: "40", cssVar: "--clr-orange-40" },
              { name: "20", cssVar: "--clr-orange-20" },
              { name: "10", cssVar: "--clr-orange-10" },
            ]}
          />
          <ColorRow
            label="Red"
            swatches={[
              { name: "100", cssVar: "--clr-red" },
              { name: "80", cssVar: "--clr-red-80" },
              { name: "60", cssVar: "--clr-red-60" },
              { name: "40", cssVar: "--clr-red-40" },
              { name: "20", cssVar: "--clr-red-20" },
              { name: "10", cssVar: "--clr-red-10" },
            ]}
          />
          <ColorRow
            label="Pink"
            swatches={[
              { name: "100", cssVar: "--clr-pink" },
              { name: "80", cssVar: "--clr-pink-80" },
              { name: "60", cssVar: "--clr-pink-60" },
              { name: "40", cssVar: "--clr-pink-40" },
              { name: "20", cssVar: "--clr-pink-20" },
              { name: "10", cssVar: "--clr-pink-10" },
            ]}
          />
          <ColorRow
            label="Purple"
            swatches={[
              { name: "100", cssVar: "--clr-purple" },
              { name: "80", cssVar: "--clr-purple-80" },
              { name: "60", cssVar: "--clr-purple-60" },
              { name: "40", cssVar: "--clr-purple-40" },
              { name: "20", cssVar: "--clr-purple-20" },
              { name: "10", cssVar: "--clr-purple-10" },
            ]}
          />
        </Section>

        {/* ═══ GRAYSCALE ═══ */}
        <Section title="Grayscale">
          <div className="grid grid-cols-3 gap-12 sm:grid-cols-5 lg:grid-cols-10">
            {[50, 100, 200, 300, 400, 500, 600, 700, 800, 900].map((n) => (
              <Swatch
                key={n}
                name={`${n}`}
                cssVar={`--color-gray-${n}`}
                dark={n >= 500}
              />
            ))}
          </div>
        </Section>

        {/* ═══ SIGNAL COLORS ═══ */}
        <Section title="Signal Colors">
          <div className="grid grid-cols-3 gap-12 sm:grid-cols-5">
            <Swatch name="Red" cssVar="--color-signal-red" />
            <Swatch name="Orange" cssVar="--color-signal-orange" />
            <Swatch name="Orange Light" cssVar="--color-signal-orange-light" />
          </div>
          <p className="body-caption" style={{ color: "var(--color-text-tertiary)" }}>
            The green signal tokens are retired. Use the status ramp below.
          </p>
        </Section>

        {/* ═══ STATUS RAMP ═══ */}
        <Section title="Status Ramp">
          <p className="body-caption" style={{ color: "var(--color-text-tertiary)" }}>
            Shared palette for status badges, dots, and state text. Use the
            solid color for icons, text, and rules; use the lighter colors for
            backgrounds and borders.
          </p>
          {STATUS_RAMP.map((state) => (
            <ColorRow
              key={state.label}
              label={state.label}
              swatches={[
                { name: "Solid", cssVar: `--${state.token}` },
                { name: "BG", cssVar: `--${state.token}-bg` },
                { name: "Border", cssVar: `--${state.token}-border` },
              ]}
            />
          ))}
        </Section>

        {/* ═══ STATUS COLORS ═══ */}
        <Section title="Status Colors">
          <div className="grid grid-cols-3 gap-12 sm:grid-cols-5">
            <Swatch name="Success" cssVar="--color-status-success" />
            <Swatch name="Success BG" cssVar="--color-status-success-bg" />
            <Swatch name="Success Border" cssVar="--color-status-success-border" />
          </div>
        </Section>

        {/* ═══ BLACK & WHITE OPACITY ═══ */}
        <Section title="Black & White Opacity">
          <ColorRow
            label="Black"
            swatches={[
              { name: "100", cssVar: "--color-black-100" },
              { name: "75", cssVar: "--color-black-75" },
              { name: "50", cssVar: "--color-black-50" },
              { name: "25", cssVar: "--color-black-25" },
              { name: "10", cssVar: "--color-black-10" },
            ]}
          />
          <div className="flex flex-col gap-12">
            <p className="body-small-bold">White</p>
            <div
              className="grid grid-cols-3 gap-12 p-16 sm:grid-cols-5"
              style={{ background: "var(--color-gray-800)" }}
            >
              {[
                { name: "100", cssVar: "--color-white-100" },
                { name: "75", cssVar: "--color-white-75" },
                { name: "50", cssVar: "--color-white-50" },
                { name: "25", cssVar: "--color-white-25" },
                { name: "10", cssVar: "--color-white-10" },
              ].map((s) => (
                <div key={s.cssVar} className="flex flex-col gap-6">
                  <div
                    className="h-48 w-full border"
                    style={{
                      background: `var(${s.cssVar})`,
                      borderColor: "var(--color-gray-600)",
                    }}
                  />
                  <span className="body-caption" style={{ color: "var(--color-white-75)" }}>
                    {s.name}
                  </span>
                  <span className="body-caption" style={{ color: "var(--color-gray-500)" }}>
                    {s.cssVar}
                  </span>
                </div>
              ))}
            </div>
          </div>
        </Section>

        {/* ═══ SEMANTIC TOKENS ═══ */}
        <Section title="Semantic Tokens">
          {/* Borders */}
          <div className="flex flex-col gap-12">
            <p className="body-small-bold">Borders</p>
            <div className="grid grid-cols-3 gap-12">
              {[
                { name: "Primary", cssVar: "--color-border-primary" },
                { name: "Secondary", cssVar: "--color-border-secondary" },
                { name: "Tertiary", cssVar: "--color-border-tertiary" },
              ].map((s) => (
                <div key={s.cssVar} className="flex flex-col gap-6">
                  <div
                    className="h-4 w-full"
                    style={{ background: `var(${s.cssVar})` }}
                  />
                  <span className="body-caption">{s.name}</span>
                  <span className="body-caption" style={{ color: "var(--color-text-tertiary)" }}>
                    {s.cssVar}
                  </span>
                </div>
              ))}
            </div>
          </div>

          {/* Text */}
          <div className="flex flex-col gap-12">
            <p className="body-small-bold">Text</p>
            <div className="flex flex-col gap-8">
              {[
                { name: "Primary", cssVar: "--color-text-primary" },
                { name: "Secondary", cssVar: "--color-text-secondary" },
                { name: "Tertiary", cssVar: "--color-text-tertiary" },
              ].map((s) => (
                <div key={s.cssVar} className="flex items-center gap-16">
                  <span className="body-medium" style={{ color: `var(${s.cssVar})` }}>
                    {s.name} text sample
                  </span>
                  <span className="body-caption" style={{ color: "var(--color-text-tertiary)" }}>
                    {s.cssVar}
                  </span>
                </div>
              ))}
            </div>
            <div
              className="flex flex-col gap-8 p-16"
              style={{ background: "var(--color-gray-800)" }}
            >
              {[
                { name: "White Primary", cssVar: "--color-text-white-primary" },
                { name: "White Secondary", cssVar: "--color-text-white-secondary" },
              ].map((s) => (
                <div key={s.cssVar} className="flex items-center gap-16">
                  <span className="body-medium" style={{ color: `var(${s.cssVar})` }}>
                    {s.name} text sample
                  </span>
                  <span className="body-caption" style={{ color: "var(--color-gray-500)" }}>
                    {s.cssVar}
                  </span>
                </div>
              ))}
            </div>
          </div>

          {/* Icons */}
          <div className="flex flex-col gap-12">
            <p className="body-small-bold">Icons</p>
            <div className="flex gap-24">
              {[
                { name: "Primary", cssVar: "--color-icon-primary" },
                { name: "Secondary", cssVar: "--color-icon-secondary" },
              ].map((s) => (
                <div key={s.cssVar} className="flex items-center gap-8">
                  <svg
                    width="20"
                    height="20"
                    viewBox="0 0 20 20"
                    fill="none"
                    style={{ color: `var(${s.cssVar})` }}
                  >
                    <circle cx="10" cy="10" r="8" stroke="currentColor" strokeWidth="2" />
                    <path d="M10 6v4l3 3" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
                  </svg>
                  <span className="body-caption">{s.name}</span>
                  <span className="body-caption" style={{ color: "var(--color-text-tertiary)" }}>
                    {s.cssVar}
                  </span>
                </div>
              ))}
            </div>
          </div>

          {/* Backgrounds */}
          <div className="flex flex-col gap-12">
            <p className="body-small-bold">Backgrounds</p>
            <div className="grid grid-cols-2 gap-12 sm:grid-cols-3 lg:grid-cols-6">
              {[
                { name: "White", cssVar: "--color-background-white" },
                { name: "Light", cssVar: "--color-background-light" },
                { name: "Medium", cssVar: "--color-background-medium" },
                { name: "Strong", cssVar: "--color-background-strong" },
                { name: "Dark Light", cssVar: "--color-background-dark-light" },
                { name: "Dark Strong", cssVar: "--color-background-dark-strong" },
              ].map((s) => (
                <Swatch key={s.cssVar} {...s} />
              ))}
            </div>
          </div>

          {/* Surfaces */}
          <div className="flex flex-col gap-12">
            <p className="body-small-bold">Surfaces</p>
            <div className="grid grid-cols-3 gap-12">
              {[
                { name: "Light", cssVar: "--color-surface-light" },
                { name: "Medium", cssVar: "--color-surface-medium" },
                { name: "Strong", cssVar: "--color-surface-strong" },
              ].map((s) => (
                <Swatch key={s.cssVar} {...s} />
              ))}
            </div>
          </div>

          {/* Interactive */}
          <div className="flex flex-col gap-12">
            <p className="body-small-bold">Interactive Backgrounds</p>
            <div className="grid grid-cols-2 gap-12 sm:grid-cols-4">
              {[
                { name: "Light", cssVar: "--color-background-interaction-light" },
                { name: "Medium", cssVar: "--color-background-interaction-medium" },
                { name: "Strong", cssVar: "--color-background-interaction-strong" },
                { name: "Dark Medium", cssVar: "--color-background-dark-interaction-medium" },
              ].map((s) => (
                <Swatch key={s.cssVar} {...s} />
              ))}
            </div>
          </div>

          {/* Interaction States */}
          <div className="flex flex-col gap-12">
            <p className="body-small-bold">Interaction States</p>
            <div className="grid grid-cols-2 gap-12 sm:grid-cols-4">
              {[
                { name: "Default", cssVar: "--color-interaction" },
                { name: "Hover", cssVar: "--color-interaction-hover" },
                { name: "Active", cssVar: "--color-interaction-active" },
                { name: "Secondary", cssVar: "--color-interaction-secondary" },
              ].map((s) => (
                <Swatch key={s.cssVar} {...s} />
              ))}
            </div>
          </div>

          {/* Accent */}
          <div className="flex flex-col gap-12">
            <p className="body-small-bold">Brand Accent</p>
            <div className="grid grid-cols-3 gap-12">
              {[
                { name: "Default", cssVar: "--color-accent" },
                { name: "Hover", cssVar: "--color-accent-hover" },
                { name: "Active", cssVar: "--color-accent-active" },
              ].map((s) => (
                <Swatch key={s.cssVar} {...s} />
              ))}
            </div>
          </div>
        </Section>

        {/* ═══ TYPOGRAPHY ═══ */}
        <Section title="Typography">
          {/* Font Families */}
          <div className="flex flex-col gap-16">
            <p className="body-small-bold">Font Families</p>
            <div className="flex flex-col gap-12">
              <div className="flex flex-col gap-4">
                <span className="body-medium" style={{ fontFamily: "var(--font-standard)" }}>
                  GT-Flexa (Standard) &mdash; The quick brown fox jumps over the lazy dog
                </span>
                <span className="body-caption" style={{ color: "var(--color-text-tertiary)" }}>
                  --font-standard
                </span>
              </div>
              <div className="flex flex-col gap-4">
                <span className="body-medium" style={{ fontFamily: "var(--font-mono)" }}>
                  GT-Flexa-Mono &mdash; The quick brown fox jumps over the lazy dog
                </span>
                <span className="body-caption" style={{ color: "var(--color-text-tertiary)" }}>
                  --font-mono
                </span>
              </div>
            </div>
          </div>

          {/* Font Weights */}
          <div className="flex flex-col gap-16">
            <p className="body-small-bold">Font Weights</p>
            <div className="flex flex-col gap-8">
              {[
                { name: "Thin", var: "--font-weight-thin", value: "100" },
                { name: "Light", var: "--font-weight-light", value: "300" },
                { name: "Default", var: "--font-weight-default", value: "400" },
                { name: "Medium", var: "--font-weight-medium", value: "500" },
                { name: "Semibold", var: "--font-weight-semibold", value: "600" },
                { name: "Bold", var: "--font-weight-bold", value: "700" },
              ].map((w) => (
                <div key={w.var} className="flex items-baseline gap-16">
                  <span
                    className="body-large w-256"
                    style={{ fontWeight: `var(${w.var})` as unknown as number }}
                  >
                    {w.name} ({w.value})
                  </span>
                  <span className="body-caption" style={{ color: "var(--color-text-tertiary)" }}>
                    {w.var}
                  </span>
                </div>
              ))}
            </div>
          </div>

          {/* Heading Styles */}
          <div className="flex flex-col gap-16">
            <p className="body-small-bold">Headings</p>
            <div className="flex flex-col gap-24">
              <div className="flex flex-col gap-4">
                <span className="title-heading-1">Heading 1 (48px Bold)</span>
                <span className="body-caption" style={{ color: "var(--color-text-tertiary)" }}>
                  .title-heading-1
                </span>
              </div>
              <div className="flex flex-col gap-4">
                <span className="title-heading-1-thin">Heading 1 Thin (48px Thin)</span>
                <span className="body-caption" style={{ color: "var(--color-text-tertiary)" }}>
                  .title-heading-1-thin
                </span>
              </div>
              <div className="flex flex-col gap-4">
                <span className="title-heading-2">Heading 2 (32px Bold)</span>
                <span className="body-caption" style={{ color: "var(--color-text-tertiary)" }}>
                  .title-heading-2
                </span>
              </div>
              <div className="flex flex-col gap-4">
                <span className="title-heading-2-thin">Heading 2 Thin (32px Thin)</span>
                <span className="body-caption" style={{ color: "var(--color-text-tertiary)" }}>
                  .title-heading-2-thin
                </span>
              </div>
              <div className="flex flex-col gap-4">
                <span className="title-heading-3">Heading 3 (24px Medium)</span>
                <span className="body-caption" style={{ color: "var(--color-text-tertiary)" }}>
                  .title-heading-3
                </span>
              </div>
              <div className="flex flex-col gap-4">
                <span className="title-heading-3-thin">Heading 3 Thin (24px Thin)</span>
                <span className="body-caption" style={{ color: "var(--color-text-tertiary)" }}>
                  .title-heading-3-thin
                </span>
              </div>
              <div className="flex flex-col gap-4">
                <span className="title-heading-4">Heading 4 (18px Medium)</span>
                <span className="body-caption" style={{ color: "var(--color-text-tertiary)" }}>
                  .title-heading-4
                </span>
              </div>
              <div className="flex flex-col gap-4">
                <span className="title-chapter-title">Chapter Title (14px Mono Uppercase)</span>
                <span className="body-caption" style={{ color: "var(--color-text-tertiary)" }}>
                  .title-chapter-title
                </span>
              </div>
            </div>
          </div>

          {/* Body Styles */}
          <div className="flex flex-col gap-16">
            <p className="body-small-bold">Body</p>
            <div className="flex flex-col gap-20">
              {[
                { cls: "body-lead", label: "Body Lead (20px Thin)", desc: ".body-lead" },
                { cls: "body-lead-bold", label: "Body Lead Bold (20px Bold)", desc: ".body-lead-bold" },
                { cls: "body-large", label: "Body Large (18px Light)", desc: ".body-large" },
                { cls: "body-large-bold", label: "Body Large Bold (18px Bold)", desc: ".body-large-bold" },
                { cls: "body-medium", label: "Body Medium (16px Light)", desc: ".body-medium" },
                { cls: "body-bold", label: "Body Bold (16px Bold)", desc: ".body-bold" },
                { cls: "body-small", label: "Body Small (14px Light)", desc: ".body-small" },
                { cls: "body-small-bold", label: "Body Small Bold (14px Bold)", desc: ".body-small-bold" },
                { cls: "body-caption", label: "Body Caption (12px Default)", desc: ".body-caption" },
                { cls: "body-caption-bold", label: "Body Caption Bold (12px Bold)", desc: ".body-caption-bold" },
                { cls: "body-quote", label: "Body Quote (24px Thin Italic)", desc: ".body-quote" },
              ].map((t) => (
                <div key={t.cls} className="flex flex-col gap-4">
                  <span className={t.cls}>{t.label}</span>
                  <span className="body-caption" style={{ color: "var(--color-text-tertiary)" }}>
                    {t.desc}
                  </span>
                </div>
              ))}
            </div>
          </div>

          {/* Label Styles */}
          <div className="flex flex-col gap-16">
            <p className="body-small-bold">Labels</p>
            <div className="flex flex-col gap-16">
              <div className="flex flex-col gap-4">
                <span className="label-button">Button Label (14px Mono Medium Uppercase)</span>
                <span className="body-caption" style={{ color: "var(--color-text-tertiary)" }}>
                  .label-button
                </span>
              </div>
              <div className="flex flex-col gap-4">
                <span className="label-input">Input Label (18px Light)</span>
                <span className="body-caption" style={{ color: "var(--color-text-tertiary)" }}>
                  .label-input
                </span>
              </div>
            </div>
          </div>

          {/* Type Scale */}
          <div className="flex flex-col gap-16">
            <p className="body-small-bold">Type Scale</p>
            <div className="flex flex-col gap-12">
              {[
                { name: "xxs", size: "12px", var: "--text-xxs" },
                { name: "xs", size: "14px", var: "--text-xs" },
                { name: "s", size: "16px", var: "--text-s" },
                { name: "m", size: "18px", var: "--text-m" },
                { name: "l", size: "20px", var: "--text-l" },
                { name: "xl", size: "24px", var: "--text-xl" },
                { name: "2xl", size: "32px", var: "--text-2xl" },
                { name: "3xl", size: "40px", var: "--text-3xl" },
                { name: "4xl", size: "48px", var: "--text-4xl" },
                { name: "5xl", size: "64px", var: "--text-5xl" },
              ].map((t) => (
                <div key={t.var} className="flex items-baseline gap-16">
                  <span
                    className="shrink-0"
                    style={{ fontSize: `var(${t.var})`, lineHeight: "120%" }}
                  >
                    Aa
                  </span>
                  <span className="body-caption" style={{ color: "var(--color-text-tertiary)" }}>
                    {t.var} &middot; {t.size}
                  </span>
                </div>
              ))}
            </div>
          </div>
        </Section>

        {/* ═══ SPACING ═══ */}
        <Section title="Spacing Scale">
          <p className="body-small" style={{ color: "var(--color-text-secondary)" }}>
            1 unit = 1px. Use Tailwind classes directly: <code className="label-button">gap-16</code>, <code className="label-button">p-24</code>, etc.
          </p>
          <div className="flex flex-col gap-8">
            {[0, 1, 2, 4, 6, 8, 10, 12, 16, 18, 20, 24, 28, 32, 36, 40, 48, 56, 64, 72, 80, 96, 128, 160, 192, 256, 320].map(
              (n) => (
                <div key={n} className="flex items-center gap-16">
                  <span
                    className="body-caption w-40 shrink-0 text-right"
                    style={{ color: "var(--color-text-tertiary)" }}
                  >
                    {n}
                  </span>
                  <div
                    className="h-12 shrink-0"
                    style={{
                      width: `${Math.min(n, 320)}px`,
                      background: "var(--clr-dark-purple-40)",
                    }}
                  />
                  <span className="body-caption" style={{ color: "var(--color-text-tertiary)" }}>
                    {n}px
                  </span>
                </div>
              ),
            )}
          </div>
        </Section>

        {/* ═══ BORDER RADIUS ═══ */}
        <Section title="Border Radius">
          <div className="flex flex-wrap gap-24">
            {[
              { name: "2", var: "--radius-2" },
              { name: "4", var: "--radius-4" },
              { name: "8", var: "--radius-8" },
              { name: "12", var: "--radius-12" },
              { name: "16", var: "--radius-16" },
              { name: "20", var: "--radius-20" },
              { name: "24", var: "--radius-24" },
              { name: "32", var: "--radius-32" },
              { name: "48", var: "--radius-48" },
              { name: "full", var: "--radius-full" },
            ].map((r) => (
              <div key={r.var} className="flex flex-col items-center gap-8">
                <div
                  className="h-64 w-64 border-2"
                  style={{
                    borderRadius: `var(${r.var})`,
                    borderColor: "var(--clr-dark-purple)",
                    background: "var(--color-background-medium)",
                  }}
                />
                <span className="body-caption">{r.name}</span>
                <span className="body-caption" style={{ color: "var(--color-text-tertiary)" }}>
                  {r.var}
                </span>
              </div>
            ))}
          </div>
        </Section>

        {/* ═══ RESPONSIVE UTILITIES ═══ */}
        <Section title="Responsive Gap Utilities">
          <p className="body-small" style={{ color: "var(--color-text-secondary)" }}>
            These scale up at 768px, 1024px, and 1536px breakpoints.
          </p>
          <div className="overflow-x-auto">
            <table className="w-full border-collapse">
              <thead>
                <tr
                  className="border-b"
                  style={{ borderColor: "var(--color-border-primary)" }}
                >
                  <th className="body-caption-bold py-8 pr-16 text-left">Class</th>
                  <th className="body-caption-bold py-8 px-16 text-right">Base</th>
                  <th className="body-caption-bold py-8 px-16 text-right">768px</th>
                  <th className="body-caption-bold py-8 px-16 text-right">1024px</th>
                  <th className="body-caption-bold py-8 pl-16 text-right">1536px</th>
                </tr>
              </thead>
              <tbody>
                {[
                  { cls: ".gap-xxs", vals: [8, 8, 8, 8] },
                  { cls: ".gap-xs", vals: [16, 20, 24, 32] },
                  { cls: ".gap-s", vals: [16, 24, 32, 40] },
                  { cls: ".gap-m", vals: [24, 32, 40, 48] },
                  { cls: ".gap-l", vals: [32, 48, 64, 80] },
                  { cls: ".gap-xl", vals: [48, 96, 128, 160] },
                  { cls: ".gap-2xl", vals: [64, 128, 192, 256] },
                  { cls: ".gap-sections", vals: [160, 192, 256, 320] },
                  { cls: ".gap-blocks", vals: [80, 128, 160, 240] },
                  { cls: ".gap-columns", vals: [24, 48, 80, 160] },
                ].map((row) => (
                  <tr
                    key={row.cls}
                    className="border-b"
                    style={{ borderColor: "var(--color-border-tertiary)" }}
                  >
                    <td className="body-caption py-8 pr-16" style={{ fontFamily: "var(--font-mono)" }}>
                      {row.cls}
                    </td>
                    {row.vals.map((v, i) => (
                      <td
                        key={i}
                        className="body-caption py-8 px-16 text-right"
                        style={{ color: "var(--color-text-secondary)" }}
                      >
                        {v}px
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Section>

        {/* ═══ ANIMATIONS ═══ */}
        <Section title="Animations">
          <div className="flex flex-col gap-16">
            <div className="flex flex-col gap-8">
              <p className="body-small-bold">Slide In Right</p>
              <span className="body-caption" style={{ color: "var(--color-text-tertiary)" }}>
                .animate-slide-in-right
              </span>
              <div
                className="animate-slide-in-right w-fit border px-16 py-8"
                style={{
                  borderColor: "var(--color-border-primary)",
                  background: "var(--color-background-medium)",
                }}
              >
                <span className="body-small">Slides in from the right</span>
              </div>
            </div>
            <div className="flex flex-col gap-8">
              <p className="body-small-bold">Skeleton Shimmer</p>
              <span className="body-caption" style={{ color: "var(--color-text-tertiary)" }}>
                .animate-skeleton
              </span>
              <div className="flex flex-col gap-8">
                <div className="animate-skeleton h-16 w-3/4" />
                <div className="animate-skeleton h-16 w-1/2" />
                <div className="animate-skeleton h-16 w-2/3" />
              </div>
            </div>
          </div>
        </Section>
      </div>
    </div>
  );
}
