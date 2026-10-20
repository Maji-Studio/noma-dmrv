"""Replace PR screenshot evidence with one section for the current head.

Usage: python3 -I scripts/pr-evidence/set-evidence.py <body.md> <head_sha> \
    <caption>|<before_url>|<after_url>|<width> ...
Also accepts --gif <caption>|<url>|<width>, placing the GIF in the After cell.
Quote each entry in the shell. Use matching viewport and state for before/after
captures, normally with width 400. Empty cells are allowed; each entry must
contain at least one image. Uses only the Python standard library.
"""

import argparse
import html
import re
from pathlib import Path
from urllib.parse import urlsplit


SHORT_SHA_LENGTH = 7
MAX_SHA_LENGTH = 40
ROW_FIELDS = 4
GIF_FIELDS = 3
EVIDENCE_HEADING = re.compile(r"## Evidence(?: \(head [^)]*\))?(?:[ \t]+#+)?[ \t]*")


def image_cell(url, caption, width):
    """Escape attribute values before embedding them in a Markdown table."""
    if not url:
        return ""
    return (
        f'<img src="{html.escape(url, quote=True)}" '
        f'alt="{html.escape(caption, quote=True)}" width="{width}">'
    )


def parse_entry(value, gif=False):
    fields = [field.strip() for field in value.split("|")]
    expected = GIF_FIELDS if gif else ROW_FIELDS
    if len(fields) != expected:
        form = "caption|url|width" if gif else "caption|before_url|after_url|width"
        raise ValueError(f"expected {form}")
    if gif:
        caption, after, width = fields
        before = ""
    else:
        caption, before, after, width = fields
    if not caption or any(ord(char) < 32 for char in value):
        raise ValueError("entries need a nonempty caption and must fit on one line")
    if not re.fullmatch(r"[0-9]+", width) or int(width) <= 0:
        raise ValueError("image width must be a positive integer")
    if not before and not after:
        raise ValueError("each entry needs at least one image URL")
    for url in (before, after):
        if not url:
            continue
        parsed = urlsplit(url)
        if (
            parsed.scheme not in ("http", "https")
            or not parsed.hostname
            or any(char.isspace() for char in url)
        ):
            raise ValueError("image URLs must be absolute HTTP or HTTPS URLs without whitespace")
    return caption, before, after, str(int(width))


def render_section(head, entries):
    lines = [f"## Evidence (head {head[:SHORT_SHA_LENGTH]})"]
    for caption, before, after, width in entries:
        # Escape Markdown punctuation so captions stay within one bold label.
        label = re.sub(r"([\\`*_{}\[\]<>#!])", r"\\\1", caption)
        lines.extend([
            "",
            f"**{label}**",
            "",
            "| Before | After |",
            "| --- | --- |",
            f"| {image_cell(before, caption, width)} | {image_cell(after, caption, width)} |",
        ])
    return "\n".join(lines)


def level_two_headings(lines):
    """Find section boundaries while leaving fenced examples alone."""
    headings = []
    fence_char = None
    fence_length = 0
    for index, line in enumerate(lines):
        fence = re.match(r"^ {0,3}(`{3,}|~{3,})(.*)$", line)
        if fence:
            marker, rest = fence.groups()
            if fence_char is None:
                fence_char, fence_length = marker[0], len(marker)
            elif marker[0] == fence_char and len(marker) >= fence_length and not rest.strip():
                fence_char = None
            continue
        if fence_char is None and re.match(r"^ {0,3}#{1,2}[ \t]", line):
            headings.append(index)
    return headings


def rewrite_body(body, section):
    lines = body.splitlines()
    headings = level_two_headings(lines)
    footer = len(lines)
    while footer and not lines[footer - 1].strip():
        footer -= 1
    if footer and lines[footer - 1].startswith("🤖 Generated with"):
        footer -= 1
    else:
        footer = len(lines)
    spans = [
        (start, headings[position + 1] if position + 1 < len(headings) else footer)
        for position, start in enumerate(headings)
        if EVIDENCE_HEADING.fullmatch(lines[start].lstrip())
    ]
    if spans:
        insertion = spans[0][0]
        for start, end in reversed(spans):
            del lines[start:end]
    else:
        insertion = footer
    before = "\n".join(lines[:insertion]).rstrip("\n")
    after = "\n".join(lines[insertion:]).strip("\n")
    return "\n\n".join(part for part in (before, section, after) if part) + "\n"


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("body", type=Path)
    parser.add_argument("head_sha")
    # Parse entries manually to allow repeated --gif entries interleaved with pairs.
    parser.add_argument("entries", nargs=argparse.REMAINDER)
    args = parser.parse_args()
    if not re.fullmatch(rf"[0-9a-fA-F]{{{SHORT_SHA_LENGTH},{MAX_SHA_LENGTH}}}", args.head_sha):
        parser.error("head_sha must contain 7 to 40 hexadecimal characters")
    entries = []
    values = iter(args.entries)
    try:
        for value in values:
            if value == "--gif":
                value = next(values, None)
                if value is None:
                    raise ValueError("--gif requires caption|url|width")
                entries.append(parse_entry(value, gif=True))
            else:
                entries.append(parse_entry(value))
        if not entries:
            raise ValueError("provide at least one screenshot row or --gif entry")
        section = render_section(args.head_sha, entries)
        body = args.body.read_text(encoding="utf-8")
        args.body.write_text(rewrite_body(body, section), encoding="utf-8")
    except (OSError, UnicodeError, ValueError) as error:
        parser.error(str(error))


if __name__ == "__main__":
    main()
