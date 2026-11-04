# UX Writing

Use this guide for all user-facing copy in noma. It applies to interface text,
validation and error messages, warnings, toasts, empty states, generated and
template content, operator reports, PDFs, and emails.

Check [GLOSSARY.md](../GLOSSARY.md) before naming a domain concept. Its terms
override casual alternatives.

## Core rules

- Use simple, direct words.
- Keep copy concise. Remove words that do not help the current task.
- Use the exact same term for the same feature everywhere.
- Use active voice. Lead guidance with the action the operator can take.
- Use present tense.
- Include only details the operator needs for the current task.
- Do not use an en dash or em dash. Use a full stop, comma, colon, or
  parentheses instead.

Preserve necessary domain terms from [GLOSSARY.md](../GLOSSARY.md), even when a
more casual term looks simpler. Explain a domain term only when the operator
needs that explanation to complete the task.

## Message structure

Put the most useful information first. Use short sentences and one instruction
per sentence. Name buttons, fields, records, and destinations exactly as they
appear in the app.

Prefer:

> Application AP-26-001 is dated 2028-01-08. Change the application date or
> wait until then.

Avoid:

> The application date entered for this record appears to be invalid because it
> is in the future.

The preferred version names the record, states the problem, and gives the next
action.

## Errors and validation

Use this pattern:

1. Identify the affected record and the problem.
2. Give the next action.

For field validation, name the field when the field label or placement does not
already make it clear. For record-level errors, include the stable record code
when it is available.

Avoid blame, filler, redundant explanations, and implementation jargon. Do not
use phrases such as "you failed to", "something went wrong", "please note",
"invalid payload", or "an error has occurred" when a specific explanation is
available.

Keep the message accurate. Do not claim that an event is complete when the
system only knows that its scheduled end time has passed.

## Saved, saved with warning, not saved

Tell the operator what the system knows about the commit, never what it hopes.
There are three outcomes and they never blur:

- **Saved.** The write committed. Confirm it and name the record.
- **Saved with warning.** The write committed and a follow-up did not: a
  preference that was not stored, a detail read that failed. Lead with the
  saved record, then say what is missing and what to do. The shared phrase for
  a failed follow-up read is `SAVED_DETAILS_UNAVAILABLE` in
  `src/lib/copy-utils.ts`: "The record was saved, but its details could not be
  loaded."
- **Not saved.** The write rolled back. Say plainly that nothing changed and
  give the next action.

Never describe a rollback with saved-with-warning copy, and never report a
known commit as "not created" or "not found".

## Warnings

State the current condition, its task impact, and the next action. Do not turn a
warning into a background lesson. If the operator can continue safely, say what
needs review. If the warning blocks the task, say how to clear it.

Render every warning, info line and blocker with `Notice` (see "Notice" in
`docs/design-system.md`): an optional short title, one line, an optional action
that clears it. Choose the tone by impact, not by wording: `warning` when the
operator can continue, `error` only when the task is blocked.

## Toasts

Confirm the completed action and name the affected record when useful.

- Success: state what changed.
- Failure: state what did not change and give the next action.

Do not repeat the button label or add celebratory filler. Keep form errors near
the form instead of using a toast when the operator needs field context.

## Empty states

Explain what belongs in the empty area or how to return to results. Give one
clear action when an action is available.

- For a zero state, describe the entity briefly or invite the first creation.
- For filtered results, tell the operator how to change or clear the filter.

Do not repeat the same instruction in the title, description, and button.
Follow the `EmptyState` patterns in [design-system.md](./design-system.md).

## Missing values

The section above is about a whole surface with nothing in it. This one is
about a single field with nothing in it, which is a different problem: a blank
optional note and a missing certification-blocking measurement must not read the
same.

**Name the situation, not the screen.** There is one token per situation, and a
blank value takes the token that answers *why it is absent*. The tokens live in
`MISSING_VALUE` (`src/lib/copy-utils.ts`):

| Token | Use when |
| --- | --- |
| `Not recorded` | The operator could have entered this and did not. |
| `Not set` | A setting, option, or relation nobody has chosen yet. |
| `None` | The value is a collection and the collection is empty. "None" is an answer, not a gap. |
| `Not applicable` | The field does not apply to this record at all, so nobody will ever fill it. |
| `Not yet computed` | The app will produce this value once upstream work finishes. |

**Say why, or leave it out.** There is no catch-all for "the app has no value
here". When none of the tokens fits:

- If the code knows why the value is missing, say so in a few words in the
  value's place: "No moisture reading", "Isometric gives no unit", "Unreadable
  date", "Could not load the facility".
- If the figure is only derived (a sum, an estimate, a share, a ratio), leave
  the figure, row or cell out. Nothing is lost: the inputs it would come from
  show their own gaps.
- Never guess a reason the code cannot know at that point. A reason names the
  cause, so a lookup that failed says what failed, and a value that is simply
  absent upstream takes a token.

Which token a **formatter** returns is decided by what its input is, not by its
unit. A formatter that receives a value an operator records (a mass, a
percentage, a date, a distance) returns `Not recorded` when that value is null,
and a short reason when it cannot parse it ("Unreadable date"). A formatter
for a value the app derives (CO₂e, aggregated tonnes, file size) takes a number
only, so the caller decides where the figure goes when there is none.

Three rules follow:

- **Do not invent a new token.** "Missing", "Unassigned", "Not linked", "Not
  available" and a bare en dash or em dash are all off-vocabulary. Pick the
  situation, give the reason, or leave the figure out. A screen that needs to
  explain more adds a second short sentence after the token, and never
  rewrites the token itself.
- **Never render a fabricated zero.** Zero is a measurement; absence is not. A
  readout whose input is missing shows the token or reason, and drops the unit
  with it, so a card never reads "Not recorded tph". Counts are the exception:
  zero rows is a true count. Name the missing input when that helps the
  operator act ("Enter a wet mass for each selected bin.").
- **Never hand-write a token in a component.** Route through the shared
  formatters and the `DetailField` empty contract, per the routing rule in
  [design-system.md](./design-system.md).

## Generated and template content

Write generated text so it reads naturally after values are inserted. Use
stable record codes and approved domain terms. Handle singular and plural forms
explicitly. Do not expose placeholders, internal keys, database names, or
programmer-style forms such as `record(s)`.

Keep template instructions close to the variable or section they affect. A
generated document must not invent certainty that the source data does not
provide.

## Operator reports and PDFs

Write for an operator who may read the output away from the app. Give records,
dates, units, statuses, and required actions enough context to stand alone.
Keep headings and field names consistent with the app and
[GLOSSARY.md](../GLOSSARY.md).

Separate observed facts from estimates, derived values, and requirements. Keep
machine-facing dates and identifiers in their required stable format.

## Emails

Use a specific subject that names the event or required action. Open with the
reason for the email, then give the next action and any deadline. Include only
the context needed to act safely. Link to the exact destination when one exists.

Do not include sensitive data that the recipient does not need. Use the same
feature and status terms as the app.

## Review checklist

Before shipping user-facing copy, confirm that it:

- uses the terms in [GLOSSARY.md](../GLOSSARY.md);
- uses simple, direct words and short sentences;
- uses active voice and present tense;
- gives the next action when one is needed;
- contains only current-task details;
- handles singular and plural forms naturally;
- contains no en dash or em dash;
- matches any tests, fixtures, templates, reports, PDFs, or emails that repeat
  the same message.
