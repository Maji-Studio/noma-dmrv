---
name: handoff
description: Compact the current conversation into a handoff document for another agent to pick up. Use when the user asks for a handoff, context transfer, continuation note, or summary for a future session.
---

Write a handoff document summarizing the current conversation so a fresh agent can continue the work.

Save it to a path produced by `mktemp -t handoff-XXXXXX.md`. Read the file before writing to it.

Suggest the skills to be used, if any, by the next session.

Do not duplicate content already captured in other artifacts such as PRDs, plans, ADRs, issues, commits, or diffs. Reference them by path or URL instead.

If the user provided a focus area, treat it as a description of what the next session will work on and tailor the document accordingly.
