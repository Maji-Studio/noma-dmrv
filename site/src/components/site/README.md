# Site components (marketing site)

Light editorial pages with one dark keynote stage per page. Brief: owner's 2026-09-30 build brief.

## Plan

- **Colour.** Page `#fff2f7` (`--page`), ink `#0f021a`, purple `#480b73` (CTA, links), rose `#ffb2d2` (the lit
  accent on stages), hairlines purple-20. Stages are `--stage` (`#0f021a`), never neutral grey.
- **Type.** GT Flexa Light 300 for every heading, tracked tight (`--track-display`). Bold only for the wordmark.
  Body Light 18px, lead 22px, measure 52ch. GT Flexa Mono uppercase appears only inside stage diagrams.
- **Layout.** A 1240px column framed by two hairlines; every section adds a top rule, and a small cross marks
  each place a rule meets the frame. Content left-aligned, headline and lead as a tight pair. Stages break out
  full-bleed; the frame lines carry through them, dimmed.

```text
 +---------------------------------------------+
 | Trace your biochar,         lead            |
 | from feedstock              [Book a walk…]  |
 | to application.                             |
 | [ interactive trace, square, hairline ]     |
 +---------------------------------------------+
 ███ STAGE: huge line, then a dot-and-dash timeline ███
 +----------------------+----------------------+
 | tour cell (glyph)    | tour cell            |   2 x 2 cells, hairline gaps
 +----------------------+----------------------+
 | photo                | Built with producers |
 +---------------------------------------------+
 | rose band: Upcoming teaser                  |
 | open-source line                            |
 | purple-5 band: Get started                  |
 +---------------------------------------------+
```

- **Principles.** Spend the boldness on the stage; keep the light pages quiet. Structure carries meaning
  (dot = a record at a moment, solid line = time spent, dashes = transport). One lit element per stage.
  Content is complete without JS; motion only replays what is already there.

## Components

Each `.astro` file documents its props at the top. Shell: `SiteShell`, `SiteNav`, `SiteFooter`.
Layout: `GridFrame`, `SectionIndex`. Actions: `Button`, `TextLink`, `Chip`. Stage: `stage/Stage`,
`stage/StageCheckRow`, `stage/StageConnector`, `stage/StageDot`, `stage/StageMark`. Motion: `motion.js`.
Config (nav, login flag, section anchors): `src/config.js`.
