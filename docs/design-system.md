# Maji Noema Design System

This design system combines Maji Studio's brand identity with Manukai's systematic token structure, creating a cohesive visual language for the Maji Noema application.

## Table of Contents

1. [Quick Reference](#quick-reference)
2. [Color System](#color-system)
3. [Typography](#typography)
4. [Spacing](#spacing)
5. [Border Radius](#border-radius)
6. [Layout](#layout)
7. [Usage Guidelines](#usage-guidelines)

---

## Quick Reference

### Spacing & Sizing

- **2px:** `gap-2`, `mb-2` (Tightest spacing, e.g. label to input)
- **4px:** `gap-4`, `p-4`, `mb-4` (Tight spacing)
- **8px:** `gap-8`, `p-8`, `mb-8` (Small spacing)
- **16px:** `gap-16`, `p-16`, `mb-16` (Standard spacing)
- **24px:** `gap-24`, `p-24`, `mb-24` (Medium spacing)
- **32px:** `gap-32`, `p-32`, `mb-32` (Large spacing)

### Typography

- **12px:** `.body-caption` (Captions)
- **14px:** `.body-small`, `.label-button` (Secondary text, Buttons)
- **16px:** `.body-medium` (Default body text)
- **18px:** `.body-large`, `.label-input` (Large body, Input labels)
- **20px:** `.body-lead` (Lead text)
- **24px:** `.title-heading-3` (Subsection titles)
- **32px:** `.title-heading-2` (Section titles)

### Common Patterns

- **Card Padding:** `p-32` (32px) standard for auth cards
- **Form Spacing:** `space-y-24` (24px) between form groups
- **Label Spacing:** `mb-8` (8px) label to input
- **Header Spacing:** `mb-32` (32px) header to content

---

## Color System

### Brand Colors

The Maji brand is built on a dark purple foundation, representing depth, wisdom, and transformation.

```css
--clr-dark-purple: rgba(15, 2, 26, 1);
--clr-dark-purple-100: rgba(15, 2, 26, 1);
--clr-dark-purple-80: rgba(15, 2, 26, 0.8);
--clr-dark-purple-60: rgba(15, 2, 26, 0.6);
--clr-dark-purple-40: rgba(15, 2, 26, 0.4);
--clr-dark-purple-30: rgba(15, 2, 26, 0.3);
--clr-dark-purple-20: rgba(15, 2, 26, 0.2);
--clr-dark-purple-10: rgba(15, 2, 26, 0.1);
--clr-dark-purple-1: rgba(15, 2, 26, 0.01);
```

### Accent Colors

Expressive accent colors for brand moments, data visualization, and emotional cues.

```css
--clr-rose: rgba(255, 178, 210, 1);      /* Soft, nurturing */
--clr-rose-80: rgba(255, 178, 210, 0.8);
--clr-rose-60: rgba(255, 178, 210, 0.6);
--clr-rose-40: rgba(255, 178, 210, 0.4);
--clr-rose-20: rgba(255, 178, 210, 0.2);
--clr-rose-10: rgba(255, 178, 210, 0.1);

--clr-orange: rgba(255, 131, 89, 1);     /* Energetic, warm */
--clr-orange-80: rgba(255, 131, 89, 0.8);
--clr-orange-60: rgba(255, 131, 89, 0.6);
--clr-orange-40: rgba(255, 131, 89, 0.4);
--clr-orange-20: rgba(255, 131, 89, 0.2);
--clr-orange-10: rgba(255, 131, 89, 0.1);

--clr-red: rgba(229, 69, 82, 1);         /* Alert, passion */
--clr-red-80: rgba(229, 69, 82, 0.8);
--clr-red-60: rgba(229, 69, 82, 0.6);
--clr-red-40: rgba(229, 69, 82, 0.4);
--clr-red-20: rgba(229, 69, 82, 0.2);
--clr-red-10: rgba(229, 69, 82, 0.1);

--clr-pink: rgba(166, 33, 110, 1);       /* Bold, creative */
--clr-pink-80: rgba(166, 33, 110, 0.8);
--clr-pink-60: rgba(166, 33, 110, 0.6);
--clr-pink-40: rgba(166, 33, 110, 0.4);
--clr-pink-20: rgba(166, 33, 110, 0.2);
--clr-pink-10: rgba(166, 33, 110, 0.1);

--clr-purple: rgba(72, 11, 115, 1);      /* Deep, mystical */
--clr-purple-80: rgba(72, 11, 115, 0.8);
--clr-purple-60: rgba(72, 11, 115, 0.6);
--clr-purple-40: rgba(72, 11, 115, 0.4);
--clr-purple-20: rgba(72, 11, 115, 0.2);
--clr-purple-10: rgba(72, 11, 115, 0.1);
```

**Accent Color Opacity Variants:**
All accent colors include opacity variants (100, 80, 60, 40, 20, 10) for flexible background usage in badges, overlays, and subtle UI elements.

**Usage:**
- Rose: Supportive messaging, wellness features
- Orange: Calls-to-action, highlights, energy
- Red: Errors, warnings, critical actions
- Pink: Creative tools, expression features
- Purple: Premium features, brand accents

### Grayscale Palette

Neutral colors for UI structure and hierarchy.

```css
--color-gray-50: #fafafaff;   /* Lightest background */
--color-gray-100: #f5f5f5ff;  /* Light background */
--color-gray-200: #ebececff;  /* Surface light */
--color-gray-300: #e1e2e2ff;  /* Border light */
--color-gray-400: #d7d8d9ff;  /* Border medium */
--color-gray-500: #878c8cff;  /* Text tertiary */
--color-gray-600: #5f6565ff;  /* Text secondary */
--color-gray-700: #373e3fff;  /* Background dark */
--color-gray-800: #232d2dff;  /* Text primary */
--color-gray-900: #161919ff;  /* Icon primary */
```

### Signal Colors

System feedback and status indicators.

```css
--color-signal-red: #e50b0bff;            /* Errors, destructive */
--color-signal-orange: #f59723ff;         /* Warnings, pending */
--color-signal-orange-strong: #f59723ff;  /* Strong warning */
--color-signal-orange-light: #f5972326;   /* Warning background */
```

### Black & White Opacity Variants

```css
--color-black-100: #000000ff;   /* Solid black */
--color-black-75: #000000bf;    /* 75% opacity */
--color-black-50: #00000080;    /* 50% opacity */
--color-black-25: #00000040;    /* 25% opacity */
--color-black-10: #0000001a;    /* 10% opacity */

--color-white-100: #ffffffff;   /* Solid white */
--color-white-75: #ffffffbf;    /* 75% opacity */
--color-white-50: #ffffff80;    /* 50% opacity */
--color-white-25: #ffffff40;    /* 25% opacity */
--color-white-10: #ffffff1a;    /* 10% opacity */
```

### Semantic Color Tokens

These tokens define the functional use of colors across the UI.

#### Borders

```css
--color-border-primary: var(--color-gray-400);    /* Primary borders */
--color-border-secondary: var(--color-gray-300);  /* Subtle borders */
--color-border-tertiary: var(--color-gray-200);   /* Minimal borders */
```

#### Text

```css
--color-text-primary: var(--color-gray-800);      /* Primary text */
--color-text-secondary: var(--color-gray-600);    /* Secondary text */
--color-text-tertiary: var(--color-gray-500);     /* Tertiary text */
--color-text-white-primary: var(--color-white-100);     /* On dark backgrounds */
--color-text-white-secondary: var(--color-gray-300);    /* Secondary on dark */
```

#### Icons

```css
--color-icon-primary: var(--color-gray-900);      /* Primary icons */
--color-icon-secondary: var(--color-gray-600);    /* Secondary icons */
```

#### Backgrounds

```css
--color-background-white: var(--color-white-100);        /* Pure white */
--color-background-light: var(--color-gray-50);          /* Page background */
--color-background-medium: var(--color-gray-100);        /* Card background */
--color-background-strong: var(--color-gray-200);        /* Elevated surface */
--color-background-dark-light: var(--color-gray-700);    /* Dark surface light */
--color-background-dark-strong: var(--color-gray-800);   /* Dark surface strong */
```

#### Surfaces

```css
--color-surface-light: var(--color-gray-200);     /* Light surface */
--color-surface-medium: var(--color-gray-400);    /* Medium surface */
--color-surface-strong: var(--color-gray-500);    /* Strong surface */
```

#### Interactive Backgrounds

Uses brand purple with opacity for subtle hover and selection states.

```css
--color-background-interaction-light: var(--clr-dark-purple-10);   /* Subtle hover */
--color-background-interaction-medium: var(--clr-dark-purple-20);  /* Hover medium */
--color-background-interaction-strong: var(--clr-dark-purple-30);  /* Active/selected */
--color-text-interaction-primary: var(--clr-dark-purple);          /* Text on interaction */
--color-background-dark-interaction-medium: var(--clr-dark-purple-80); /* Dark interaction */
```

#### Interaction States

Primary interactions use filled brand purple. Secondary interactions use outline only (gray borders).

```css
--color-interaction: var(--clr-dark-purple);          /* Primary action (filled) */
--color-interaction-hover: var(--clr-dark-purple-80); /* Hover state */
--color-interaction-active: var(--clr-purple);        /* Active/pressed */
--color-interaction-secondary: var(--color-gray-400); /* Secondary (outline only) */
```

#### Brand Accent

```css
--color-accent: var(--clr-dark-purple);           /* Primary brand accent */
--color-accent-hover: var(--clr-dark-purple-80);  /* Brand hover */
--color-accent-active: var(--clr-purple);         /* Brand active */
```

#### Badge Colors

Semantic tokens for knowledge item type badges and other categorical indicators.

```css
--color-badge-insight-bg: var(--clr-rose-20);          /* Insight badge background */
--color-badge-insight-text: var(--clr-pink);           /* Insight badge text */
--color-badge-decision-bg: var(--clr-purple-10);       /* Decision badge background */
--color-badge-decision-text: var(--clr-purple);        /* Decision badge text */
--color-badge-constraint-bg: var(--clr-orange-20);     /* Constraint badge background */
--color-badge-constraint-text: var(--clr-red);         /* Constraint badge text */
--color-badge-pattern-bg: var(--clr-dark-purple-10);   /* Pattern badge background */
--color-badge-pattern-text: var(--clr-dark-purple);    /* Pattern badge text */
```

**Usage:**
Use these semantic tokens for `KnowledgeTypeBadge` and similar categorical UI elements. Never reference raw accent colors directly in components.

---

## Typography

### Font Families

```css
--font-standard: 'GT-Flexa', -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
--font-mono: 'GT-Flexa-Mono', 'Monaco', 'Consolas', 'Liberation Mono', 'Menlo', 'Courier New', monospace;
```

**Note:** Custom GT-Flexa fonts are included in this template. The fonts provide a distinctive brand identity with excellent legibility across all weights.

### Font Weights

```css
--font-weight-thin: 100;       /* Thin - for large display */
--font-weight-light: 300;      /* Light - for body text */
--font-weight-default: 400;    /* Regular - default body */
--font-weight-medium: 500;     /* Medium - for emphasis */
--font-weight-semibold: 600;   /* Semibold - for headings */
--font-weight-bold: 700;       /* Bold - for strong emphasis */
```

### Type Scale

```css
--text-xxs: 0.75rem;    /* 12px */
--text-xs: 0.875rem;    /* 14px */
--text-s: 1rem;         /* 16px */
--text-m: 1.125rem;     /* 18px */
--text-l: 1.25rem;      /* 20px */
--text-xl: 1.5rem;      /* 24px */
--text-2xl: 2rem;       /* 32px */
--text-3xl: 2.5rem;     /* 40px */
--text-4xl: 3rem;       /* 48px */
--text-5xl: 4rem;       /* 64px */
--text-6xl: 6rem;       /* 96px */
```

### Heading Styles

#### H1 - Display Heading
```css
--text-h1: var(--text-4xl);              /* 48px base */
--text-h1--font-weight: var(--font-weight-bold);
--text-h1--line-height: 120%;
--text-h1--letter-spacing: 0%;
```

**Variants:**
- `.title-heading-1`: Bold variant for primary page titles
- `.title-heading-1-thin`: Thin variant for elegant display
- Responsive: `text-4xl md:text-4xl lg:text-5xl 2xl:text-6xl`

#### H2 - Section Heading
```css
--text-h2: var(--text-2xl);              /* 32px base */
--text-h2--font-weight: var(--font-weight-bold);
--text-h2--line-height: 120%;
--text-h2--letter-spacing: 0%;
```

**Variants:**
- `.title-heading-2`: Bold variant for section titles
- `.title-heading-2-thin`: Thin variant for secondary display
- Responsive: `text-2xl md:text-2xl lg:text-4xl 2xl:text-5xl`

#### H3 - Subsection Heading
```css
--text-h3: var(--text-xl);               /* 24px base */
--text-h3--font-weight: var(--font-weight-medium);
--text-h3--line-height: 120%;
--text-h3--letter-spacing: 0%;
```

**Variants:**
- `.title-heading-3`: Bold variant
- `.title-heading-3-thin`: Thin variant
- Responsive: `text-xl md:text-xl lg:text-2xl 2xl:text-4xl`

#### H4 - Component Heading
```css
--text-h4: var(--text-m);                /* 18px base */
--text-h4--font-weight: var(--font-weight-medium);
--text-h4--line-height: 120%;
--text-h4--letter-spacing: 0%;
```

#### Chapter Title
```css
.title-chapter-title {
  font-family: var(--font-mono);
  font-weight: var(--font-weight-medium);
  font-size: var(--text-xs);
  line-height: 120%;
  letter-spacing: 0.125%;
  text-transform: uppercase;
}
```
Responsive: `text-xs md:text-xs lg:text-s 2xl:text-s`

### Body Styles

#### Lead Text
```css
--text-body-lead: var(--text-l);         /* 20px */
--text-body-lead--font-weight: var(--font-weight-thin);
--text-body-lead--line-height: 150%;
--text-body-lead--letter-spacing: 0%;
```

**Variants:**
- `.body-lead`: Thin weight for elegant introductions
- `.body-lead-bold`: Bold weight for emphasis
- Responsive: `text-xl md:text-xl lg:text-3xl 2xl:text-3xl`

#### Large Body
```css
--text-body-large: var(--text-m);        /* 18px */
--text-body-large--font-weight: var(--font-weight-light);
--text-body-large--line-height: 150%;
--text-body-large--letter-spacing: 0%;
```

**Variants:**
- `.body-large`: Light weight
- `.body-large-bold`: Bold weight
- Responsive: `text-l md:text-l lg:text-xl 2xl:text-2xl`

#### Medium Body (Default)
```css
--text-body-medium: var(--text-s);       /* 16px */
--text-body-medium--font-weight: var(--font-weight-light);
--text-body-medium--line-height: 150%;
--text-body-medium--letter-spacing: 0%;
```

**Variants:**
- Default `<p>` and body text
- `.body-bold`: Bold weight for emphasis
- Responsive: `text-m md:text-m lg:text-l 2xl:text-l`

#### Small Body
```css
--text-body-small: var(--text-xs);       /* 14px */
--text-body-small--font-weight: var(--font-weight-light);
--text-body-small--line-height: 150%;
--text-body-small--letter-spacing: 0%;
```

**Variants:**
- `.body-small`: Light weight for secondary info
- `.body-small-bold`: Bold weight
- Responsive: `text-xs md:text-xs lg:text-s 2xl:text-s`

#### Caption
```css
--text-body-caption: var(--text-xxs);    /* 12px */
--text-body-caption--font-weight: var(--font-weight-default);
--text-body-caption--line-height: 150%;
--text-body-caption--letter-spacing: 0%;
```

**Variants:**
- Default line-height: 150%
- `.body-caption-fit`: Tight line-height (100%)
- Bold variants available for both

#### Quote
```css
.body-quote {
  font-family: var(--font-standard);
  font-weight: var(--font-weight-thin);
  font-size: var(--text-xl);
  line-height: 150%;
  letter-spacing: 0%;
  font-style: italic;
}
```
Responsive: `text-xl md:text-xl lg:text-2xl 2xl:text-3xl`

### Label Styles

#### Button Label
```css
--text-label-button: var(--text-xs);     /* 14px */
--text-label-button--font-weight: var(--font-weight-medium);
--text-label-button--line-height: 100%;
--text-label-button--letter-spacing: 2%;
```

Class: `.label-button`
- Uses monospace font
- Uppercase transform
- Tight line-height
- Responsive: `text-xs md:text-xs lg:text-s 2xl:text-s`

#### Input Label
```css
--text-label-input: var(--text-m);       /* 18px */
--text-label-input--font-weight: var(--font-weight-light);
--text-label-input--line-height: 140%;
--text-label-input--letter-spacing: 0%;
```

Class: `.label-input`
- Responsive: `text-base md:text-base lg:text-l 2xl:text-l`

---

## Spacing

### Spacing Scale

The application uses a 1px spacing scale for Tailwind classes, meaning `1` unit = `1px`.

**Tailwind Class Mapping:**
- `mb-1` = 1px
- `mb-4` = 4px
- `mb-8` = 8px
- `mb-16` = 16px
- `mb-24` = 24px
- `mb-32` = 32px
- `mb-48` = 48px
- `mb-64` = 64px

### Fixed Spacing Tokens

```css
--spacing-0: 0px;
--spacing-1: 1px;
--spacing-2: 2px;
--spacing-4: 4px;
--spacing-6: 6px;
--spacing-8: 8px;
--spacing-10: 10px;
--spacing-12: 12px;
--spacing-16: 16px;
--spacing-18: 18px;
--spacing-20: 20px;
--spacing-24: 24px;
--spacing-28: 28px;
--spacing-32: 32px;
--spacing-36: 36px;
--spacing-40: 40px;
--spacing-48: 48px;
--spacing-56: 56px;
--spacing-64: 64px;
--spacing-72: 72px;
--spacing-80: 80px;
--spacing-96: 96px;
--spacing-128: 128px;
--spacing-160: 160px;
--spacing-192: 192px;
--spacing-256: 256px;
--spacing-320: 320px;
```

### Responsive Spacing Utilities

#### Gap Utilities

```css
.gap-xs    /* 16-32px */   gap: 16px md:20px lg:24px 2xl:32px
.gap-s     /* 16-40px */   gap: 16px md:24px lg:32px 2xl:40px
.gap-m     /* 24-48px */   gap: 24px md:32px lg:40px 2xl:48px
.gap-l     /* 32-80px */   gap: 32px md:48px lg:64px 2xl:80px
.gap-xl    /* 48-160px */  gap: 48px md:96px lg:128px 2xl:160px
.gap-2xl   /* 64-256px */  gap: 64px md:128px lg:192px 2xl:256px

/* Semantic gaps */
.gap-sections  /* 160-320px */ gap: 160px md:192px lg:256px 2xl:320px
.gap-blocks    /* 80-240px */  gap: 80px md:128px lg:160px 2xl:240px
.gap-columns   /* 24-160px */  gap: 24px md:48px lg:80px 2xl:160px
```

#### Margin Bottom Utilities

```css
.mb-xs     /* 16-32px */  margin-bottom: 16px md:20px lg:24px 2xl:32px
.mb-s      /* 16-40px */  margin-bottom: 16px md:24px lg:32px 2xl:40px
.mb-m      /* 24-48px */  margin-bottom: 24px md:32px lg:40px 2xl:48px
.mb-l      /* 32-80px */  margin-bottom: 32px md:48px lg:64px 2xl:80px
.mb-xl     /* 48-160px */ margin-bottom: 48px md:96px lg:128px 2xl:160px
```

#### Padding Utilities

```css
.pt-xs     /* 16-32px */  padding-top: 16px md:20px lg:24px 2xl:32px
.pt-s      /* 16-40px */  padding-top: 16px md:24px lg:32px 2xl:40px
.pt-m      /* 24-48px */  padding-top: 24px md:32px lg:40px 2xl:48px
.pt-l      /* 32-80px */  padding-top: 32px md:48px lg:64px 2xl:80px
.pt-xl     /* 48-160px */ padding-top: 48px md:96px lg:128px 2xl:160px
.pt-2xl    /* 64-256px */ padding-top: 64px md:128px lg:192px 2xl:256px

.pb-xs     /* 16-32px */  padding-bottom: 16px md:20px lg:24px 2xl:32px
.pb-s      /* 16-40px */  padding-bottom: 16px md:24px lg:32px 2xl:40px
.pb-m      /* 24-48px */  padding-bottom: 24px md:32px lg:40px 2xl:48px
.pb-l      /* 32-80px */  padding-bottom: 32px md:48px lg:64px 2xl:80px
.pb-xl     /* 48-160px */ padding-bottom: 48px md:96px lg:128px 2xl:160px
.pb-2xl    /* 64-256px */ padding-bottom: 64px md:128px lg:192px 2xl:256px
```

---

## Border Radius

The design system prefers a **square, brutalist aesthetic** with minimal border radius for most UI elements.

```css
--radius-2: 2px;
--radius-4: 4px;
--radius-8: 8px;
--radius-12: 12px;
--radius-16: 16px;
--radius-20: 20px;
--radius-24: 24px;
--radius-32: 32px;
--radius-48: 48px;
--radius-full: 9999px;
```

**Usage Guidelines:**
- **Default:** Use `rounded-none` (Tailwind) or `0px` for most components to maintain the brutalist look.
- **Exceptions:** The following components may use subtle rounding for improved visual hierarchy:
  - **Cards:** May use `--radius-8` or `--radius-12` to create visual separation from page background
  - **Circular elements:** Avatar images and profile pictures may use `--radius-full` when specifically designed as circular
- **Do NOT use:** `rounded-md`, `rounded-lg` on standard buttons, inputs, or containers.
- When in doubt, prefer square corners over rounded.

---

## Layout

### Breakpoints

```css
--breakpoint-xl: 1280px;      /* Desktop */
--breakpoint-desktop: 100rem; /* Large desktop (1600px) */
```

**Tailwind Breakpoints:**
- `sm`: 640px
- `md`: 768px
- `lg`: 1024px
- `xl`: 1280px
- `2xl`: 1536px

### Container

```css
.container-max {
  margin: 0 auto;
  width: 100%;
  max-width: 120rem; /* 1920px */
  padding-left: 24px;   /* sm:32px md:48px lg:64px xl:96px */
  padding-right: 24px;
}
```

**Responsive Padding:**
- Mobile: 24px
- sm: 32px
- md: 48px
- lg: 64px
- xl: 96px

---

## Usage Guidelines

### Forms and Validation

Forms use TanStack Form with Zod validation. Schemas live in `src/schemas/` and are shared by client forms and server actions.

**Key locations:**
```plaintext
src/schemas/
src/components/forms/
```

**Pattern (short):**
```typescript
const form = useForm({
  defaultValues: { email: "" },
  validators: { onSubmit: createUserSchema },
  onSubmit: async ({ value }) => { /* submit */ },
});
```

Field-level validation is preferred for immediate feedback:
```tsx
<form.Field name="email" validators={{ onBlur: createUserSchema.shape.email }}>
  {(field) => <FormInput field={field} label="Email" />}
</form.Field>
```

**Why this approach:**
- Consistent validation rules across client and server
- Cleaner component logic (no manual field state)
- Centralized schemas for reuse

### Color Usage Best Practices

1. **Text Hierarchy**
   - Primary text: Use `--color-text-primary` for main content
   - Secondary text: Use `--color-text-secondary` for supporting info
   - Tertiary text: Use `--color-text-tertiary` for metadata

2. **Brand Identity**
   - Use dark purple (`--color-accent`) as the primary interaction color
   - Reserve accent colors (rose, orange, pink) for specific emotional contexts
   - Primary actions: filled with brand purple
   - Secondary actions: outline only with gray borders

3. **Interactive Elements**
   - **Primary (filled):** `--color-interaction` (dark purple)
   - **Primary hover:** `--color-interaction-hover` (dark purple 80%)
   - **Primary active:** `--color-interaction-active` (deep purple)
   - **Secondary (outline):** `--color-interaction-secondary` (gray border only)
   - **Disabled:** 40% opacity of base color

4. **Feedback**
   - Success: Use `--clr-dark-purple` or a checkmark icon
   - Error: `--color-signal-red`
   - Warning: `--color-signal-orange`
   - Info: Light purple or gray backgrounds

### Typography Best Practices

1. **Hierarchy**
   - Use one H1 per page for primary title
   - H2 for major sections
   - H3 for subsections
   - H4 for component headers

2. **Weight Selection**
   - Thin (100): Large display text only
   - Light (300): Body copy, comfortable reading
   - Regular (400): Default body, captions
   - Medium (500): Emphasis, H3/H4 headings
   - Semibold (600): Available from GT-Flexa font
   - Bold (700): H1/H2, strong emphasis

3. **Responsive Typography**
   - Let type scale up naturally across breakpoints
   - Test readability at all sizes
   - Maintain consistent line-height ratios

### Spacing Best Practices

1. **Vertical Rhythm**
   - Use consistent spacing scales
   - Increase spacing at larger breakpoints proportionally
   - Create clear visual groupings

2. **Component Spacing**
   - `gap-xs/s`: Internal component spacing
   - `gap-m/l`: Between related components
   - `gap-xl/2xl`: Between distinct sections

3. **Whitespace**
   - Don't fear empty space
   - Use sections gaps for breathing room
   - Increase spacing around focal points

### Accessibility

1. **Color Contrast**
   - Ensure text meets WCAG AA standards (4.5:1 for body, 3:1 for large text)
   - Test accent colors on backgrounds
   - Provide additional non-color indicators

2. **Typography**
   - Minimum body text size: 16px
   - Maximum line length: 75ch
   - Maintain 1.5x line-height for body text

3. **Interactive Elements**
   - Minimum touch target: 44x44px
   - Clear focus indicators
   - Sufficient contrast for all states

---

## Component Library

### Base UI (Preferred)

When creating new UI components, we use [Base UI](https://base-ui.com) by MUI as our preferred component library. Base UI provides unstyled, accessible React components that we can style according to our design system.

**Resources:**
- Documentation: https://base-ui.com/react/components/accordion
- GitHub: https://github.com/mui/base-ui

**Why Base UI:**
- Unstyled components that work with our custom design tokens
- Accessibility built-in (ARIA attributes, keyboard navigation)
- Flexible styling - no theming system to override
- Production-ready, well-maintained by MUI team

**Usage Guidelines:**
1. **Check Base UI first:** When you need to create a new component (accordion, dialog, select, etc.), check if Base UI provides it
2. **Style with our design system:** Apply our design tokens and patterns to Base UI components
3. **Use alternatives when needed:** If Base UI doesn't have the component you need, look for other headless/unstyled alternatives
4. **Avoid shadcn:** Do not use shadcn or its theming system - we maintain our own design system

**Example - Using Base UI Accordion:**
```tsx
import * as Accordion from '@base-ui-components/react/accordion';

export function MyAccordion() {
  return (
    <Accordion.Root>
      <Accordion.Item className="border-[var(--color-border-primary)]">
        <Accordion.Header>
          <Accordion.Trigger className="label-button p-[var(--spacing-16)]">
            Section Title
          </Accordion.Trigger>
        </Accordion.Header>
        <Accordion.Panel className="p-[var(--spacing-16)] gap-[var(--spacing-12)]">
          <p className="body-large">Panel content...</p>
        </Accordion.Panel>
      </Accordion.Item>
    </Accordion.Root>
  );
}
```

### Phosphor Icons

We use [Phosphor Icons](https://phosphoricons.com/) for all icons in the application. Phosphor provides a flexible, consistent icon family with multiple weights.

**Resources:**
- Website: https://phosphoricons.com/
- React Library: https://github.com/phosphor-icons/react
- Documentation: https://phosphoricons.com/docs

**Installation:**
```bash
pnpm add @phosphor-icons/react
```

**IMPORTANT - Correct Import Path:**

⚠️ **Always use `/dist/ssr` import path** to avoid deprecation warnings:

```tsx
// ✅ CORRECT - SSR-compatible, works in both client and server components
import { Trash, Pencil, Plus } from "@phosphor-icons/react/dist/ssr";

// ❌ WRONG - Deprecated, will show TypeScript warnings
import { Trash, Pencil, Plus } from "@phosphor-icons/react";
```

**Usage Guidelines:**

1. **Icon Sizes:** Use consistent sizes across the application (see [Icon Sizing Pattern](#icon-sizing-pattern))
   - Small icons (in buttons): 20px
   - Medium icons (standalone): 24px
   - Large icons (in cards): 32px

2. **Icon Weights:** Phosphor icons support multiple weights
   - `regular` (default) - Standard icons for most use cases
   - `bold` - Emphasized icons in buttons or primary actions
   - `fill` - Filled icons for active/selected states
   - `light` - Lighter icons for subtle elements
   - `thin` - Minimal icons for dense interfaces
   - `duotone` - Two-tone icons for visual interest

3. **Color:** Icons inherit text color by default, or use semantic color tokens
   ```tsx
   // Inherits text color
   <Trash size={20} />

   // Custom color using design tokens
   <Trash size={20} className="text-[var(--color-text-error)]" />
   ```

**Example Usage:**

```tsx
import { Trash, Pencil, Plus, House } from "@phosphor-icons/react/dist/ssr";

// Basic icon
<Trash size={20} />

// Icon with weight
<Plus size={20} weight="bold" />

// Icon in button
<button className="flex items-center gap-s">
  <Plus size={20} weight="bold" />
  Add Item
</button>

// Icon with conditional weight (e.g., navigation)
<House size={20} weight={isActive ? "fill" : "regular"} />

// Icon with semantic color
<button className="text-[var(--color-text-error)]">
  <Trash size={20} />
</button>
```

**Migration Note:**

If you see TypeScript deprecation warnings like `'Trash' is deprecated.ts(6385)`, update your imports to use `/dist/ssr`:

```tsx
// Before
import { Trash } from "@phosphor-icons/react";

// After
import { Trash } from "@phosphor-icons/react/dist/ssr";
```

---

## Base Components

We have created foundational UI components that follow the design system and are ready to use throughout the application. These components are located in `/src/components/`.

### Button Component

A versatile button component with support for different variants, sizes, and states. Built with `class-variance-authority` and Base UI's Slot primitive.

**Location:** `/src/components/ui/Button/index.tsx`

**Variants:**
- `default` - Standard button with border (primary border, surface hover states)
- `weak` - Lighter border for secondary actions (tertiary border)
- `primary` - Dark purple filled button for primary actions
- `accent` - Dark purple brand accent button
- `noOutline` - Text-only button without borders

**Sizes:**
- `default` - 48px height (60px at xl breakpoint), with 16px/24px padding
- `small` - 32px height, 12px padding

**Width Options:**
- `default` - Auto width based on content
- `square` - Square aspect ratio (perfect for icon buttons)
- `full` - Full width of container

**Typography:** Uses `.label-button` class (monospace, medium weight, uppercase, 2% letter spacing)

**Example Usage:**
```tsx
import { Button } from '@/src/components/ui/Button'
import { ArrowRight, Plus } from '@phosphor-icons/react/dist/ssr'

// Basic button
<Button>Click me</Button>

// Primary action with icon
<Button variant="primary">
  Continue
  <ArrowRight size={20} weight="bold" />
</Button>

// Icon-only button
<Button width="square" aria-label="Add">
  <Plus size={20} weight="bold" />
</Button>

// As a link (polymorphic)
<Button asChild>
  <Link href="/about">Go to About</Link>
</Button>
```

**Design Tokens Used:**
- Colors: `--color-text-primary`, `--color-border-primary`, `--color-surface-medium`, `--color-interaction`, `--color-accent`
- Spacing: `--spacing-12`, `--spacing-16`, `--spacing-24`
- Typography: `.label-button` class
- Transitions: `duration-300`

### Card Component (Compound)

A flexible compound component for building card layouts with images, overlays, and content. Inspired by the TeaserProject pattern.

**Location:** `/src/components/ui/Card/index.tsx`

**Sub-components:**
- `Card.Root` - Container with border and rounded corners
- `Card.Link` - Wraps content in Next.js Link
- `Card.Image` - Optimized image with aspect ratio control (`square`, `video`, `auto`)
- `Card.Overlay` - Overlay content (hover or always visible)
- `Card.Content` - Main content area with configurable padding
- `Card.Header` - Groups subtitle and title
- `Card.Title` - Heading element (uses `.title-heading-3` by default)
- `Card.Subtitle` - Small label (uses `.title-chapter-title`)
- `Card.Description` - Body text (uses `.body-large`)
- `Card.Footer` - Footer area for actions
- `Card.Icon` - Icon container with optional border

**Common Patterns:**

**Project Teaser Card:**
```tsx
<Card.Root className="max-w-sm group">
  <Card.Link href="/project/1" ariaLabel="View Project">
    <Card.Image
      src="/images/project.jpg"
      alt="Project preview"
      aspectRatio="square"
    />
    <Card.Overlay showOnHover>
      <Card.Subtitle>Client Name</Card.Subtitle>
      <Card.Title as="h3" className="body-large font-bold normal-case">
        Project Description
      </Card.Title>
      <ArrowRight size={24} />
    </Card.Overlay>
  </Card.Link>
</Card.Root>
```

**Feature Card:**
```tsx
<Card.Root>
  <Card.Content padding="large">
    <Card.Icon bordered size="large">
      <Rocket size={32} weight="bold" />
    </Card.Icon>
    <Card.Header>
      <Card.Title as="h3">Feature Title</Card.Title>
    </Card.Header>
    <Card.Description>
      Feature description text.
    </Card.Description>
  </Card.Content>
</Card.Root>
```

**Blog Post Card:**
```tsx
<Card.Root>
  <Card.Image src="/images/post.jpg" alt="Blog post" aspectRatio="video" />
  <Card.Content>
    <Card.Header>
      <Card.Subtitle>Blog Post</Card.Subtitle>
      <Card.Title>Post Title</Card.Title>
    </Card.Header>
    <Card.Description>Post excerpt.</Card.Description>
    <Card.Footer>
      <Button variant="primary" size="small">
        Read More
        <ArrowRight size={16} />
      </Button>
    </Card.Footer>
  </Card.Content>
</Card.Root>
```

**Design Tokens Used:**
- Colors: `--color-border-tertiary`, `--clr-dark-purple-40`, `--color-white-100`
- Spacing: `--spacing-8`, `--spacing-12`, `--spacing-16`, `--spacing-24`, `--spacing-40`
- Border Radius: `--radius-8`
- Typography: `.title-heading-3`, `.title-chapter-title`, `.body-large`
- Transitions: `duration-300`

**Accessibility:**
- Use `ariaLabel` with `Card.Link` for interactive cards
- Provide meaningful `alt` text for images
- Use semantic heading levels with `Card.Title`'s `as` prop
- Add `group` class to `Card.Root` for group-hover functionality

**Padding Options:**
- `none` - No padding
- `small` - 16px padding
- `medium` - 24px padding (default)
- `large` - 40px padding

### Component Guidelines

**When to Use Button:**
- Primary actions (CTAs, form submissions)
- Secondary actions (cancel, back)
- Icon-only actions (close, menu, like)
- Navigation links styled as buttons

**When to Use Card:**
- Content previews (blog posts, projects, products)
- Feature highlights
- Grouped information
- Grid/list items
- Interactive navigation elements

**Icons:**
- Use `@phosphor-icons/react` for all icons
- Standard sizes: 16px (small), 20px (default), 24px (medium), 32px (large)
- Always use `weight="bold"` for consistency
- Provide `aria-label` for icon-only buttons

**See Also:**
- Component README: `/src/components/ui/README.md`
- Button examples: `/src/components/ui/Button/examples.tsx`
- Card examples: `/src/components/ui/Card/examples.tsx`

---

## Implementation Notes

### CSS Custom Properties

All design tokens are defined as CSS custom properties in the `:root` selector and can be used throughout the codebase:

```css
.example {
  color: var(--color-text-primary);
  background: var(--color-background-light);
  border-radius: var(--radius-8);
  padding: var(--spacing-16);
}
```

### Tailwind Integration

The application uses **Tailwind CSS v4** with a custom 1px spacing scale.

**Key Configuration:**
1.  **Reset Defaults:** Default Tailwind spacing and radius scales are reset to `initial` to prevent mix-ups.
2.  **Theme Block:** Configuration is defined in the `@theme` CSS block in `globals.css`.
3.  **1px Scale:** `space-y-16` equals `16px` (not `64px`).

```css
@theme inline {
  /* Reset defaults to avoid confusion */
  --spacing-*: initial;
  --radius-*: initial;

  /* Spacing Scale (1 unit = 1px) */
  --spacing-1: 1px;
  --spacing-4: 4px;
  /* ... */
  --spacing-32: 32px;
}
```

---

## Component Patterns & Guidelines

Based on Maji Studio's existing components, these patterns ensure consistency across the application.

### Repeatable Patterns

#### Responsive Padding Pattern
Consistent responsive padding used across containers:
```tsx
// Standard container padding progression
mobile: var(--spacing-24)    // 24px
sm: var(--spacing-32)        // 32px
md: var(--spacing-48)        // 48px
lg: var(--spacing-64)        // 64px
xl: var(--spacing-96)        // 96px

// Implementation
className="px-6 md:px-10 lg:px-20"
// Should be:
className="px-[var(--spacing-24)] sm:px-[var(--spacing-32)] md:px-[var(--spacing-48)] lg:px-[var(--spacing-64)] xl:px-[var(--spacing-96)]"
```

#### Responsive Gap Pattern
Standard gap progression for flex/grid containers:
```tsx
// Small gaps (between related items)
gap-xs:  16px → 32px    (mobile → 2xl)
gap-s:   16px → 40px
gap-m:   24px → 48px

// Large gaps (between sections)
gap-l:   32px → 80px
gap-xl:  48px → 160px
gap-2xl: 64px → 256px
```

#### Border Pattern
Consistent border styling across components:
```tsx
// Default border (buttons, cards)
border-width: 1px
border-color: var(--color-border-primary)

// Emphasized border (cards, media)
border-width: 1.5px
border-color: var(--color-border-tertiary) or var(--color-white-100)

// Subtle dividers
border-width: 1px
border-color: var(--color-white-10) or var(--color-border-tertiary)
```

#### Interactive State Pattern
Standard state progression for interactive elements:
```tsx
// Text/Icon color progression
default: var(--color-text-primary)
secondary: var(--color-text-secondary)
hover: var(--color-text-primary)

// Border progression
default: var(--color-border-tertiary)
hover: var(--color-border-primary)
active: var(--color-border-primary)

// Background progression
default: transparent
hover: var(--color-surface-medium)
active: var(--color-surface-light)

// Opacity for disabled/inactive
opacity: 0.4 (40%)
```

#### Aspect Ratio Pattern
Common aspect ratios across media:
```tsx
// Square (project cards, images, profile pictures)
aspect-square (1:1)

// Square buttons/icons
aspect-square with p-0
```

#### Icon Sizing Pattern
Consistent icon dimensions:
```tsx
// Small icons (in buttons)
size: 20px

// Medium icons (standalone)
size: 24px

// Large icons (in cards)
size: 32px

// Feature icons (in value prop cards)
size: 32px
container: 68x68px with border
```

#### Overlay Pattern
Dark overlay for image cards with content:
```tsx
// Standard overlay
background: var(--clr-dark-purple-40)
color: var(--color-white-100)
padding: var(--spacing-24)
gap: var(--spacing-24)

// Transition
transition-property: opacity
transition-duration: 300ms
opacity-states: 0 (hidden) → 1 (visible on hover/focus)
```

#### Two-Column Responsive Pattern
Standard two-column layout that stacks on mobile:
```tsx
// Container
flex flex-col lg:flex-row
gap-l lg:gap-columns

// Columns
lg:w-1/2

// Content spacing
lg:px-20 (80px internal padding)
```

#### Transition Duration Pattern
Consistent timing for animations:
```tsx
// Standard transitions (color, background, border)
duration-300 (300ms)

// Smooth content transitions (opacity, position)
duration-500 (500ms)
```

#### Responsive Breakpoint Usage Pattern
Standard breakpoint application order:
```tsx
// Mobile-first approach
className="base-value md:tablet-value lg:desktop-value xl:large-desktop-value 2xl:extra-large-value"

// Common patterns:
// Text sizing
text-xs md:text-xs lg:text-s 2xl:text-s

// Padding progression
px-6 md:px-10 lg:px-20
// translates to:
px-[var(--spacing-24)] md:px-[var(--spacing-40)] lg:px-[var(--spacing-80)]

// Layout changes
flex-col lg:flex-row
```

#### Flex Layout Patterns
```tsx
// Vertical stack with gap
flex flex-col gap-{size}

// Horizontal row with gap
flex flex-row gap-{size}

// Horizontal icon list (social media, actions)
flex space-x-[var(--spacing-16)]

// Space between
flex justify-between

// Center alignment
flex items-center justify-center

// Responsive direction change
flex flex-col lg:flex-row

// Grid layout (for card grids)
grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-m
```

#### Grid-like Flex Pattern (Slider)
```tsx
// Container
flex

// Items with percentage-based flex-basis
flex-[0_0_100%]           // Full width (mobile)
md:flex-[0_0_50%]         // Half width (tablet)
xl:flex-[0_0_33.333%]     // Third width (desktop)
```

#### Conditional Rendering Pattern
```tsx
// Optional content
{subtitle && <span className="title-chapter-title">{subtitle}</span>}

// Type guard
{isMedia(image) && <MediaComponent media={image} />}

// Responsive visibility
<div className="hidden md:flex">
  {/* Desktop-only content */}
</div>
```

#### Dynamic Class Pattern
```tsx
// Using clsx/cn for conditional classes
import { cn } from '@/lib/utils'

className={cn(
  'base-classes',
  'more-base-classes',
  condition && 'conditional-class',
  variant === 'primary' && 'variant-class'
)}

// Opacity states
className={`transition-opacity duration-300 ${
  isDisabled ? 'opacity-40' : 'opacity-100'
}`}
```

### Button Components

**Structure:**
```tsx
// Primary button sizing
height: 48px (default) | 60px (xl breakpoint)
padding-x: var(--spacing-16) | var(--spacing-24) (xl)
gap: var(--spacing-12)

// Small button sizing
height: 32px
padding-x: var(--spacing-12)
gap: var(--spacing-8)

// Square/Icon buttons
aspect-ratio: 1/1
padding: 0
```

**Color tokens:**
- Text: `var(--color-text-primary)`
- Border default: `var(--color-border-primary)`
- Border weak: `var(--color-border-tertiary)`
- Hover background: `var(--color-surface-medium)`
- Active background: `var(--color-surface-light)`

**Typography:**
- Use `.label-button` class (14px, medium weight, 100% line-height, 2% letter-spacing, uppercase)

**Implementation pattern:**
```tsx
// Using class-variance-authority (CVA)
const buttonVariants = cva(
  'inline-flex whitespace-nowrap items-center justify-center label-button transition-colors duration-300',
  {
    variants: {
      variant: { /* color variants */ },
      size: { /* size variants */ },
      width: { /* width variants */ },
    }
  }
)
```

### Card Components

**Border pattern:**
```css
border-width: 1.5px;
border-color: var(--color-border-tertiary);
```

**Padding:**
- Default: `var(--spacing-40)` (40px)
- Responsive: Adjust based on viewport

**Internal spacing:**
- Gap between icon and title: `var(--spacing-32)` (32px)
- Use semantic gap utilities: `gap-s`, `gap-m`, `gap-l`

### Content Sections

**Two-column layouts:**
```tsx
// Container gap
gap-l lg:gap-columns

// Content column internal spacing
gap-m (24-48px responsive)

// Column width
lg:w-1/2
lg:px-20 (80px padding for content spacing)
```

**Typography hierarchy:**
1. Subtitle: `.title-chapter-title` (uppercase, monospace, 14px)
2. Title: `.title-heading-2` (32px base, responsive)
3. Description: `.body-large` (18px base, responsive)

### Footer & Navigation

**Container spacing:**
```tsx
// Outer padding
padding: var(--spacing-48) var(--spacing-24)
md: var(--spacing-64) var(--spacing-40)
lg: var(--spacing-80)

// Internal gaps
gap: var(--spacing-48) lg:var(--spacing-80)
```

**Navigation lists:**
- Gap between items: `var(--spacing-24)` (24px)
- Min-height for touch targets: 32px

**Dividers:**
```css
border: 1px solid var(--color-white-10);
```

### Project Cards & Media

**Overlay pattern:**
```tsx
// Background overlay
background: var(--clr-dark-purple-40)

// Padding
padding: var(--spacing-24)

// Internal gap
gap: var(--spacing-24)
```

**Border on images:**
```css
border-width: 1.5px;
border-color: var(--color-white-100);
```

### Language Selector / Toggle Groups

**Item sizing:**
```tsx
height: 48px (h-12)
padding-x: var(--spacing-16) md:var(--spacing-24)
```

**States:**
- Active: `border-color: var(--color-border-primary)`
- Inactive: `border-color: var(--color-border-tertiary)`, `color: var(--color-text-secondary)`
- Hover (inactive): `border-color: var(--color-border-primary)`, `color: var(--color-text-primary)`

### Testimonials & Quotes

**Layout spacing:**
```tsx
// Container gap
gap-l lg:gap-xl

// Content column gap
gap-s
```

**Typography:**
- Quote: `.body-quote` (italic, thin weight, 24px base, responsive)
- Attribution: `.body-large`

**Image sizing:**
```tsx
// Person image (circular)
width/height: 160px (base) | 200px (md) | 240px (lg)
border-radius: var(--radius-full)
```

### Sliders & Carousels

**Container spacing:**
```tsx
// Wrapper gap
gap: var(--spacing-32)

// Slide spacing
padding-right: var(--spacing-16) md:var(--spacing-24) xl:var(--spacing-48)
```

**Control spacing:**
```tsx
// Dot indicators gap
gap: var(--spacing-16)
```

### Animated Elements

**Headline animation:**
- Container height: Fixed based on largest headline to prevent layout shift
- Typography: Use heading classes (`title-heading-1`, etc.) or responsive text sizes
- Animation duration: 500ms for smooth transitions

### Component Composition Patterns

#### Content Hierarchy Pattern
Standard vertical spacing for content blocks:
```tsx
<div className="flex flex-col gap-m">
  <span className="title-chapter-title">{subtitle}</span>
  <h2 className="title-heading-2">{title}</h2>
  <p className="body-large">{description}</p>
</div>
```

**Spacing rules:**
- Chapter title to heading: `gap-m` (24-48px)
- Heading to body: `gap-m` (24-48px)
- Body paragraphs: `gap-s` (16-40px)

#### Media + Content Pattern
Standard pattern for image with text content:
```tsx
<div className="flex flex-col lg:flex-row gap-l lg:gap-columns">
  {/* Image column */}
  <div className="lg:w-1/2">
    <div className="relative aspect-square">
      {/* Media component */}
    </div>
  </div>

  {/* Content column */}
  <div className="flex flex-col gap-m justify-center lg:w-1/2 lg:px-20">
    {/* Content hierarchy */}
  </div>
</div>
```

#### Navigation List Pattern
```tsx
<nav>
  <ul className="flex flex-col gap-[var(--spacing-24)]">
    {items.map((item) => (
      <li key={item.id}>
        <Link className="min-h-8" href={item.href}>
          {item.label}
        </Link>
      </li>
    ))}
  </ul>
</nav>
```

**Touch target:** Minimum `min-h-8` (32px) for accessibility

#### Slider/Carousel Pattern
```tsx
// Container
<div className="flex flex-col gap-[var(--spacing-32)]">

  {/* Embla viewport */}
  <div ref={emblaRef}>
    <div className="flex">
      {items.map((item, index) => (
        <div className="flex-[0_0_100%] md:flex-[0_0_50%] xl:flex-[0_0_33.333%] pr-[var(--spacing-16)] md:pr-[var(--spacing-24)] xl:pr-[var(--spacing-48)]">
          {/* Slide content */}
        </div>
      ))}
    </div>
  </div>

  {/* Controls */}
  <div className="flex justify-between">
    <div className="flex gap-[var(--spacing-16)]">
      {/* Dot indicators */}
    </div>
    <div className="hidden md:flex">
      {/* Prev/Next buttons */}
    </div>
  </div>
</div>
```

**Slide widths:**
- Mobile: 100%
- Tablet (md): 50%
- Desktop (xl): 33.333%

**Slide spacing:**
- Mobile: 16px right padding
- Tablet: 24px right padding
- Desktop: 48px right padding

### Accessibility Patterns

#### Touch Targets
Minimum sizes for interactive elements:
```tsx
// Links in navigation
min-h-8 (32px minimum)

// Buttons
height: 48px (default) | 32px (small) - both meet minimum

// Icon buttons
aspect-square with min 32px dimension
```

#### Focus States
```tsx
// Standard focus ring
focus:outline-none focus:ring-2

// Transition for smooth appearance
transition (includes focus states)
```

#### ARIA Labels
```tsx
// Icon buttons
aria-label="Descriptive action"

// Carousel controls
aria-label="Previous slide"
aria-disabled={isDisabled}
aria-current={isActive ? 'true' : 'false'}

// Language selector
aria-label="Language selector"
aria-current={isActive ? 'page' : undefined}
```

#### Semantic HTML
- Use `<nav>` for navigation sections
- Use `<blockquote>` for testimonials/quotes
- Use proper heading hierarchy (H1 → H2 → H3 → H4)

---

## Design Token Usage Rules

### When to Use Design Tokens

**Always use tokens for:**
1. **Spacing:** Use semantic utilities (`gap-xs`, `gap-s`, `gap-m`, etc.) or CSS variables (`var(--spacing-16)`)
2. **Colors:** Always use CSS variables (`var(--color-text-primary)`, `var(--clr-dark-purple)`)
3. **Typography:** Use design system classes (`.title-heading-2`, `.body-large`, etc.)
4. **Border radius:** Use tokens (`var(--radius-8)`, `var(--radius-12)`, etc.)

**Avoid:**
- Hardcoded pixel values for spacing (e.g., `gap-6`, `p-10`, `px-4`)
- Direct color values or custom color names without tokens
- Inline text sizing (e.g., `text-4xl`) - use typography classes instead
- Magic numbers without semantic meaning

### Migration Pattern

**Before:**
```tsx
className="gap-6 p-10 text-textprimary border-borderprimary"
```

**After:**
```tsx
className="gap-[var(--spacing-24)] p-[var(--spacing-40)] text-[var(--color-text-primary)] border-[var(--color-border-primary)]"
```

Or better, use semantic utilities:
```tsx
className="gap-m p-[var(--spacing-40)] text-[var(--color-text-primary)] border-[var(--color-border-primary)]"
```

### Common Token Mappings

**Spacing conversions:**
- `gap-3` → `gap-[var(--spacing-12)]` or use semantic `gap-xs` if appropriate
- `gap-4` → `gap-[var(--spacing-16)]`
- `gap-6` → `gap-[var(--spacing-24)]`
- `gap-8` → `gap-[var(--spacing-32)]`
- `gap-12` → `gap-[var(--spacing-48)]`
- `p-6` → `p-[var(--spacing-24)]`
- `p-10` → `p-[var(--spacing-40)]`
- `px-4` → `px-[var(--spacing-16)]`

**Color conversions:**
- `textprimary` → `text-[var(--color-text-primary)]`
- `textsecondary` → `text-[var(--color-text-secondary)]`
- `borderprimary` → `border-[var(--color-border-primary)]`
- `bordertertiary` → `border-[var(--color-border-tertiary)]`
- `surfacestrong` → `bg-[var(--color-surface-strong)]`
- `surfaceweak`/`surfacelight` → `bg-[var(--color-surface-light)]`
- `darkPurple` → `bg-[var(--clr-dark-purple)]`
- `darkPurple-40` → `bg-[var(--clr-dark-purple-40)]`

### Utility Class Hierarchy

**Priority order (from most to least preferred):**

1. **Design system typography classes** (highest priority)
   ```tsx
   className="title-heading-2"
   className="body-large"
   className="label-button"
   ```

2. **Semantic spacing utilities**
   ```tsx
   className="gap-m"
   className="pt-l"
   className="mb-xl"
   ```

3. **CSS variable with Tailwind bracket notation**
   ```tsx
   className="px-[var(--spacing-24)]"
   className="text-[var(--color-text-primary)]"
   className="rounded-[var(--radius-8)]"
   ```

4. **Raw Tailwind utilities** (only when no token exists)
   ```tsx
   className="flex items-center"
   className="w-1/2"
   className="aspect-square"
   ```

5. **Inline styles** (avoid unless dynamic values required)
   ```tsx
   style={{ objectFit: 'cover' }}
   ```

### Naming Conventions

**Component files:**
- Use index.tsx within component folders
- Export named components: `export default function ComponentName()`

**Props:**
- Use descriptive, semantic names
- Boolean props: `is*`, `has*`, `should*` (e.g., `isActive`, `imageOnLeft`)
- Optional props: Mark with `?` in TypeScript

**CSS classes:**
- Use kebab-case for custom classes
- Prefer design system classes over custom classes
- Group Tailwind classes logically: layout → spacing → typography → colors → effects

**Example class ordering:**
```tsx
className="
  flex flex-col lg:flex-row          // Layout
  gap-m lg:gap-l                      // Spacing
  title-heading-2                     // Typography
  text-[var(--color-text-primary)]   // Colors
  transition-opacity duration-300     // Effects
"
```

### Component File Structure Pattern

```tsx
'use client' // Only if needed (hooks, events)

import * as React from 'react'
import { /* external dependencies */ } from 'package'
import { /* internal utilities */ } from '@/lib/utils'
import { /* types */ } from '@/types'

// Type definitions
type ComponentProps = {
  // Required props first
  title: string
  // Optional props with ? or null
  subtitle?: string | null
}

// Main component
export default function ComponentName({
  title,
  subtitle,
}: ComponentProps) {
  // Hooks first
  // Derived state/calculations
  // Event handlers

  // Render
  return (
    <div className="design-system-classes">
      {/* Component content */}
    </div>
  )
}
```

### Best Practices Summary

**DO:**
- ✓ Use design system typography classes for all text
- ✓ Use semantic spacing utilities (gap-m, pt-l) when available
- ✓ Use CSS variables with bracket notation for exact values
- ✓ Apply mobile-first responsive design
- ✓ Include proper ARIA labels and semantic HTML
- ✓ Use min-h-8 (32px) minimum for touch targets
- ✓ Apply consistent transition durations (300ms or 500ms)
- ✓ Use type guards for optional/union types

**DON'T:**
- ✗ Use hardcoded pixel values without tokens
- ✗ Use inline text sizing (text-4xl) when heading classes exist
- ✗ Create custom color names without design tokens
- ✗ Skip accessibility attributes on interactive elements
- ✗ Use magic numbers without semantic meaning
- ✗ Mix different spacing systems in same component

---

**Version:** 1.0.2
**Last Updated:** 2026-01-31
**Maintained by:** Maji Studio
