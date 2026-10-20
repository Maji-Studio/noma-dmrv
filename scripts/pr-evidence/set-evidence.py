"""Keep one managed screenshot block inside the PR body's Evidence section.

Usage: python3 -I scripts/pr-evidence/set-evidence.py <body.md> <head_sha> \
    <caption>|<before_url>|<after_url>|<width> ...
The block sits between <!-- pr-evidence:start --> and <!-- pr-evidence:end -->; a run
replaces only that block. Without markers it goes at the top of an existing
`## Evidence` section (other content kept), else a new `## Evidence` section.
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
EVIDENCE_HEADING = re.compile(r"## Evidence\b.*")
START_MARKER = "<!-- pr-evidence:start -->"
END_MARKER = "<!-- pr-evidence:end -->"


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


def render_block(head, entries):
    lines = [START_MARKER, f"**Screenshots (head {head[:SHORT_SHA_LENGTH]})**"]
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
    lines.append(END_MARKER)
    return "\n".join(lines)


def find_evidence_heading(lines):
    """First `## Evidence` heading outside fenced code, or None."""
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
        if fence_char is None and EVIDENCE_HEADING.fullmatch(line.rstrip()):
            return index
    return None


def rewrite_body(body, block):
    start = body.find(START_MARKER)
    if start != -1:
        end = body.find(END_MARKER, start)
        if end == -1:
            raise ValueError("found the start marker without the end marker")
        end += len(END_MARKER)
        return body[:start] + block + body[end:]
    lines = body.splitlines()
    heading = find_evidence_heading(lines)
    if heading is not None:
        rest = "\n".join(lines[heading + 1:]).strip("\n")
        parts = ["\n".join(lines[:heading + 1]), block, rest]
        return "\n\n".join(part for part in parts if part) + "\n"
    footer = len(lines)
    while footer and not lines[footer - 1].strip():
        footer -= 1
    if footer and lines[footer - 1].startswith("🤖 Generated with"):
        footer -= 1
    else:
        footer = len(lines)
    before = "\n".join(lines[:footer]).rstrip("\n")
    after = "\n".join(lines[footer:]).strip("\n")
    return "\n\n".join(part for part in (before, "## Evidence\n\n" + block, after) if part) + "\n"


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
        block = render_block(args.head_sha, entries)
        body = args.body.read_text(encoding="utf-8")
        args.body.write_text(rewrite_body(body, block), encoding="utf-8")
    except (OSError, UnicodeError, ValueError) as error:
        parser.error(str(error))


if __name__ == "__main__":
    main()
