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
