"""Insert a '## Screenshots' section into an issue body.
Usage: python3 -I add-shots.py <body.md> <mode: after-first|end> <caption>|<url>|<width> [...]"""
import sys
path, mode, items = sys.argv[1], sys.argv[2], sys.argv[3:]
body = open(path).read().rstrip("\n")
if "## Screenshots" in body:
    sys.exit("already has screenshots")
block = ["## Screenshots", ""]
for it in items:
    cap, url, w = it.split("|")
    block += [f"**{cap}**", "", f'<img src="{url}" alt="{cap}" width="{w}">', ""]
section = "\n".join(block).rstrip("\n")
lines = body.split("\n")
if mode == "after-first":
    idx = [i for i, l in enumerate(lines) if l.startswith("## ")]
    at = idx[1] if len(idx) > 1 else len(lines)
    lines[at:at] = section.split("\n") + [""]
    out = "\n".join(lines)
else:
    out = body + "\n\n" + section
open(path, "w").write(out + "\n")
