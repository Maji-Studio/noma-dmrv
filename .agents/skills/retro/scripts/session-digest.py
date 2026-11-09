#!/usr/bin/env python3
"""Summarize Claude Code session events within local midnight boundaries."""

import argparse
import collections
import datetime as dt
import json
from pathlib import Path
import re
import subprocess
import tempfile

LARGE_RESULT_CHARACTERS = 30000
USER_TEXT_LIMIT = 1500
ERROR_INPUT_LIMIT = 300
ERROR_TEXT_LIMIT = 500
LARGE_INPUT_LIMIT = 200
LAUNCH_DESCRIPTION_LIMIT = 80
SYSTEM_PREFIX_LIMIT = 50
SESSION_ID_LENGTH = 8
TOOL_DISPLAY_LIMIT = 25
BYTES_PER_KIB = 1024
LAUNCH_TOOLS = {"Agent", "Workflow"}
SUMMARY_COLUMNS = "sid sizeKB users errs big compacts toolcalls outputTokens digestKB"


def text(content):
    if isinstance(content, str):
        return content
    return "\n".join(block.get("text", "") for block in content or []
                     if isinstance(block, dict) and block.get("type") == "text")


def timestamp(value):
    """Accept explicit UTC/offset ISO timestamps, never guess a log's timezone."""
    if not isinstance(value, str):
        return None
    try:
        parsed = dt.datetime.fromisoformat(value.replace("Z", "+00:00"))
        return parsed if parsed.tzinfo else None
    except ValueError:
        return None


def midnight(value):
    return dt.datetime.strptime(value, "%Y-%m-%d").timestamp()


def default_logs():
    common = subprocess.check_output(
        ["git", "rev-parse", "--path-format=absolute", "--git-common-dir"], text=True
    ).strip()
    checkout = Path(common).parent
    slug = re.sub(r"[^A-Za-z0-9]", "-", str(checkout))
    return Path.home() / ".claude" / "projects" / slug


def read_events(path, lo, hi):
    inside, outside = [], []
    previous = None
    with path.open(encoding="utf-8") as source:
        for line in source:
            try:
                event = json.loads(line)
            except (ValueError, TypeError):
                continue
            if not isinstance(event, dict) or event.get("isSidechain"):
                continue
            if event.get("timestamp"):
                parsed = timestamp(event["timestamp"])
                if parsed is None:
                    continue
                previous = parsed
            if previous is None:
                continue
            if lo <= previous.timestamp() < hi:
                inside.append((previous, event))
            else:
                outside.append(previous)
    return inside, outside


def digest(path, events, outside, out):
    sid = path.name[:SESSION_ID_LENGTH]
    tools = collections.Counter()
    names, tokens = {}, {}
    users, agents, errors, large = [], [], [], []
    seen_tools, seen_results, seen_users, seen_compactions = set(), set(), set(), set()
    compactions = 0
    for index, (when, event) in enumerate(events):
        message = event.get("message") or {}
        content = message.get("content")
        stamp = when.isoformat()
        if event.get("type") == "summary" or event.get("isCompactSummary"):
            compact_id = message.get("id") or event.get("uuid") or ("line", index)
            if compact_id not in seen_compactions:
                seen_compactions.add(compact_id)
                compactions += 1
        if event.get("type") != "assistant":
            continue
        message_id = message.get("id") or ("line", index)
        output_tokens = (message.get("usage") or {}).get("output_tokens", 0)
        tokens[message_id] = max(tokens.get(message_id, 0), output_tokens)
        for block in content if isinstance(content, list) else []:
            if not isinstance(block, dict) or block.get("type") != "tool_use":
                continue
            tool_id = block.get("id")
            if tool_id in seen_tools:
                continue
            seen_tools.add(tool_id)
            name, inputs = block.get("name", "?"), block.get("input")
            tools[name] += 1
            names[tool_id] = (name, inputs)
            if name in LAUNCH_TOOLS:
                inputs = inputs or {}
                description = str(inputs.get("description") or inputs.get("name") or "")
                agents.append(f"{stamp} {name} model={inputs.get('model')} "
                              f"type={inputs.get('subagent_type')} {description[:LAUNCH_DESCRIPTION_LIMIT]}")
    for index, (when, event) in enumerate(events):
        if event.get("type") != "user":
            continue
        message = event.get("message") or {}
        content = message.get("content")
        stamp = when.isoformat()
        results = [block for block in content if isinstance(block, dict)
                   and block.get("type") == "tool_result"] if isinstance(content, list) else []
        if results:
            for block in results:
                tool_id = block.get("tool_use_id")
                if tool_id in seen_results:
                    continue
                seen_results.add(tool_id)
                body = text(block.get("content"))
                name, inputs = names.get(tool_id, ("?", None))
                if block.get("is_error"):
                    snippet = json.dumps(inputs)[:ERROR_INPUT_LIMIT] if inputs else ""
                    errors.append(f"[{stamp}] {name} {snippet}\n   -> {body[:ERROR_TEXT_LIMIT]}")
                if len(body) > LARGE_RESULT_CHARACTERS:
                    large.append(f"[{stamp}] {name} {len(body)} chars: "
                                 f"{json.dumps(inputs)[:LARGE_INPUT_LIMIT]}")
        else:
            body = text(content).strip()
            if not body or event.get("isMeta"):
                continue
            if body.startswith(("<task-notification", "<system-reminder")) or "tool_use_id" in body[:SYSTEM_PREFIX_LIMIT]:
                continue
            message_id = message.get("id") or ("line", index)
            if message_id not in seen_users:
                seen_users.add(message_id)
                users.append(f"[{stamp}] {body[:USER_TEXT_LIMIT]}")
    first, last = min(when for when, _ in events), max(when for when, _ in events)
    size = path.stat().st_size // BYTES_PER_KIB
    output_tokens = sum(tokens.values())
    outside_range = f"{min(outside).isoformat()} .. {max(outside).isoformat()}" if outside else "none"
    sections = [
        f"# session {sid} ({path.name})",
        f"{first.isoformat()} .. {last.isoformat()}; size {size}KB; compactions {compactions}; output tokens {output_tokens}",
        f"also holds events outside the window: {'yes' if outside else 'no'}; count {len(outside)}; date range {outside_range}",
        "tools: " + ", ".join(f"{name}={count}" for name, count in tools.most_common(TOOL_DISPLAY_LIMIT)),
        "",
    ]
    for title, items in [("user messages", users), ("agent/workflow launches", agents),
                         ("tool errors", errors), ("large tool results", large)]:
        sections.extend([f"## {title} ({len(items)})", "\n\n".join(items), ""])
    destination = out / f"{sid}.md"
    destination.write_text("\n".join(sections), encoding="utf-8")
    return (sid, size, len(users), len(errors), len(large), compactions,
            sum(tools.values()), output_tokens, destination.stat().st_size // BYTES_PER_KIB)


def summarize(logs, out, start, end):
    lo, hi = midnight(start), midnight(end)
    if lo >= hi:
        raise ValueError("--from must be before --to")
    out.mkdir(parents=True, exist_ok=True)
    rows, skipped = [], 0
    for path in sorted(logs.glob("*.jsonl")):
        events, outside = read_events(path, lo, hi)
        if not events:
            skipped += 1
            continue
        rows.append(digest(path, events, outside, out))
    return rows, skipped


def self_test():
    # Synthetic fixtures use system temp; never inspect real home logs.
    with tempfile.TemporaryDirectory(prefix="session-digest-test-") as directory:
        root = Path(directory)
        before, within, after = "2026-01-01T00:00:00Z", "2026-01-03T00:00:00Z", "2026-01-05T00:00:00Z"
        assistant = {"type": "assistant", "timestamp": within, "message": {
            "id": "stream", "usage": {"output_tokens": 3}, "content": [
                {"type": "tool_use", "id": "tool", "name": "Bash", "input": {}}]}}
        events = [
            {"type": "user", "message": {"content": "untimed prefix"}},
            {"type": "summary", "timestamp": before},
            {**assistant, "timestamp": before, "message": {
                "id": "outside", "usage": {"output_tokens": 100}, "content": [
                    {"type": "tool_use", "id": "outside-tool", "name": "Agent", "input": {}}]}},
            assistant,
            {**assistant, "message": {**assistant["message"], "usage": {"output_tokens": 7}}},
            {"type": "user", "message": {"content": "inherited timestamp"}},
            {"type": "summary", "timestamp": after},
            {"type": "user", "message": {"content": "outside inherited timestamp"}},
            {**assistant, "isSidechain": True},
        ]
        (root / "included-session.jsonl").write_text("\n".join(map(json.dumps, events)), encoding="utf-8")
        (root / "excluded-session.jsonl").write_text(json.dumps(events[1]), encoding="utf-8")
        rows, skipped = summarize(root, root / "out", "2026-01-02", "2026-01-04")
        assert skipped == 1 and len(rows) == 1, (rows, skipped)
        assert rows[0][2:8] == (1, 0, 0, 0, 1, 7), rows
        body = (root / "out" / "included.md").read_text(encoding="utf-8")
        assert "also holds events outside the window: yes; count 4" in body, body
        assert "outside inherited timestamp" not in body and "untimed prefix" not in body
        assert "tools: Bash=1" in body
        boundary_logs = root / "boundaries"
        boundary_logs.mkdir()
        start, end = "2026-01-02", "2026-01-04"
        def utc_boundary(date):
            return dt.datetime.fromtimestamp(midnight(date), dt.timezone.utc).isoformat()
        boundary_events = [
            {"type": "user", "timestamp": utc_boundary(start), "message": {"content": "inclusive"}},
            {"type": "user", "timestamp": utc_boundary(end), "message": {"content": "exclusive"}},
        ]
        (boundary_logs / "boundary-session.jsonl").write_text(
            "\n".join(map(json.dumps, boundary_events)), encoding="utf-8")
        boundary_rows, boundary_skipped = summarize(boundary_logs, root / "boundary-out", start, end)
        assert boundary_skipped == 0 and boundary_rows[0][2] == 1
        boundary_body = (root / "boundary-out" / "boundary.md").read_text(encoding="utf-8")
        assert "inclusive" in boundary_body and "exclusive" not in boundary_body
    print("session-digest self-test passed")


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--from", dest="start", help="inclusive local date, YYYY-MM-DD")
    parser.add_argument("--to", dest="end", help="exclusive local date, YYYY-MM-DD")
    parser.add_argument("--out", type=Path)
    parser.add_argument("--logs", type=Path, help="session JSONL directory (defaults to main checkout logs)")
    parser.add_argument("--self-test", action="store_true")
    args = parser.parse_args()
    if args.self_test:
        self_test()
        return
    if not all((args.start, args.end, args.out)):
        parser.error("--from, --to and --out are required")
    try:
        rows, skipped = summarize(args.logs if args.logs is not None else default_logs(), args.out, args.start, args.end)
    except (ValueError, OSError, subprocess.CalledProcessError) as error:
        parser.error(str(error))
    print(f"window [{args.start}, {args.end}) at local midnight; skipped {skipped} files with no in-window events")
    print(SUMMARY_COLUMNS)
    for row in rows:
        print(*row)
    print("TOTAL", *(sum(row[index] for row in rows) for index in range(1, len(SUMMARY_COLUMNS.split()))))


if __name__ == "__main__":
    main()
