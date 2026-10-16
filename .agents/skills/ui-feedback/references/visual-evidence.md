# Visual evidence

Read for live capture, replay, visual proposals, and implementation before/after
comparison. Actual UI evidence is a capture of the running app; generated or
edited concepts never prove observed behavior.

## Capture and provenance

Check the current tools' screenshot, file-export, recording, and publication
capabilities before promising artifacts. Continuous recording and GIF export
are optional capabilities, not assumed features of computer-use. When absent,
capture an ordered screenshot storyboard with actions between frames. A frame
missed during the walkthrough stays a gap until replayed; label that replay
**reconstructed replay**, not original capture. Native screen-context capture
may have voice-session restrictions; honor the available tool's contract.

For each numbered image record:

- Observation/issue ID and role: original before, replay before, concept, or after.
- Timestamp, app environment/version or commit (unknown when unavailable), route,
  steps and precise state, viewport/zoom, role, and synthetic data/fixture IDs.
- What is visible, observed versus expected, and any limits (cropped region,
  unsupported interaction, different data, incomplete flow).
- Local file and publication status; verified remote URL once available.

Capture only the relevant app region and use synthetic data where possible.
Keep names, emails, credentials, tokens, private operational data, and unrelated
windows out of saved/shared artifacts. If a capture contains sensitive content,
produce a sanitized copy with explicit redaction/cropping disclosed; never
publish the original. Redaction must not alter the behavior being evidenced.
Preserve the original before evidence used for the decision; after captures get
new IDs. Keep unsafe raw captures out of the shared evidence bundle.

## Reviewer-accessible publication

The existing computer-use artifact directory is local scratch space. Repository
QA conventions ignore screenshot/video binaries (`.gitignore`); Markdown paths
to those files will not become GitHub attachments. `docs/storage.md` describes
application evidence storage, not a configured screenshot publishing service.
CI artifacts may expire and are not a durable visual record on their own.

For authorized issue/PR publication, prefer attaching sanitized images through
the authenticated GitHub issue/PR editor if the available browser/tool supports
file upload. Use the attachment URLs actually returned by GitHub in the body or
comment; `gh issue ... --body-file` can embed existing URLs but does not upload
local image paths. Check the rendered issue/PR and that intended reviewers can
access the images. Do not assume repository privacy also restricts attachment
URLs; only publish material safe for that visibility.

If native attachment is unavailable, use an existing user-approved durable
shared location with suitable reviewer access, if one is available. Verify its
actual upload/read capabilities and retention. Do not create storage
infrastructure, repurpose application document records, force-add ignored
binaries, or substitute expiring signed URLs to manufacture a working link.

If neither route is available, retain sanitized files and an evidence manifest
in `.scratchpad/ui-feedback/<session>/`, mark **publication blocked**, and give
the user the concrete files/captions for manual attachment. Continue drafting
or updating the issue with the limitation made explicit. A local path is only a
handoff path, never a published attachment. Request the missing upload action
only after this package is complete; record and verify returned URLs before
calling visual handoff complete or moving captured work to Ready. A draft PR
can be published with this blocker disclosed, but visual verification/evidence
delivery remains incomplete.

## Comparable implementation evidence

Before editing a UI, retain the original issue images and selected direction in
the implementation brief. If before evidence is absent, capture it from the
running baseline where possible and label replay provenance. If the baseline
cannot be run, record the gap instead of inventing a before image.

After implementation, use the implement-ticket playbook's session-appropriate
UI verification and capture the running app at the same relevant flow, state,
viewport, role, and data. Include intermediate/error states when they are part
of the acceptance criteria. Caption any unavoidable mismatch and explain what
it prevents comparing. A concept mockup cannot serve as after evidence.

Embed before/after pairs or link a durable illustrated storyboard in the PR,
with issue/observation IDs, selected proposal reference, observed versus expected,
acceptance result, tested commit, and limitations. Reviewers must be able to see
the change without running the prototype or reproducing the flow. Visual
comparison supplements correctness tests; it does not replace them. If later
review fixes change the UI, refresh the affected after captures and captions.
