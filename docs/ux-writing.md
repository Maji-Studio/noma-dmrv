# UX Writing

Use this guide for all user-facing copy in noma. It applies to interface text,
validation and error messages, warnings, toasts, empty states, generated and
template content, operator reports, PDFs, and emails.

Check [CONTEXT.md](../CONTEXT.md) before naming a domain concept. Its terms
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

Preserve necessary domain terms from [CONTEXT.md](../CONTEXT.md), even when a
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

## Warnings

State the current condition, its task impact, and the next action. Do not turn a
warning into a background lesson. If the operator can continue safely, say what
needs review. If the warning blocks the task, say how to clear it.

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
| `Not available` | The app cannot read or derive the value: a lookup returned nothing, a stored value will not parse, a derived figure's inputs are missing. |
| `Not set` | A setting, option, or relation nobody has chosen yet. |
| `None` | The value is a collection and the collection is empty. "None" is an answer, not a gap. |
| `Not applicable` | The field does not apply to this record at all, so nobody will ever fill it. |
| `Not yet computed` | The app will produce this value once upstream work finishes. |

Which token a **formatter** returns is decided by what its input is, not by its
unit. A formatter that receives a value an operator records (a mass, a
percentage, a date, a distance) returns `Not recorded` when that value is null,
and `Not available` when it receives a value it cannot parse. A formatter that
receives a value the app derives (CO₂e, aggregated tonnes, file size) returns
`Not available`, because there was never an operator to record it.

Three rules follow:

- **Do not invent a seventh phrasing.** "Missing", "Unassigned", "No crop type",
  "Not linked" and a bare en dash or em dash are all off-vocabulary. Pick the
  situation instead. A screen that needs to explain *why* adds a second short
  sentence after the token, and never rewrites the token itself.
- **Never render a fabricated zero.** Zero is a measurement; absence is not. A
  readout whose input is missing shows the token, and drops the unit with it, so
  a card never reads "Not available tph". Counts are the exception: zero rows is
  a true count. Name the missing input when that helps the operator act
  ("Enter a wet mass for each selected bin.").
- **Never hand-write the string in a component.** Route through the shared
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
[CONTEXT.md](../CONTEXT.md).

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

- uses the terms in [CONTEXT.md](../CONTEXT.md);
- uses simple, direct words and short sentences;
- uses active voice and present tense;
- gives the next action when one is needed;
- contains only current-task details;
- handles singular and plural forms naturally;
- contains no en dash or em dash;
- matches any tests, fixtures, templates, reports, PDFs, or emails that repeat
  the same message.
