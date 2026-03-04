# Forms Guide

This guide covers form handling in the template using React Hook Form with Zod validation.

## Quick Start

```typescript
import { useState } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { myFormSchema, type MyFormData } from "@/schemas/my-feature";
import { FormField, FormInput, ServerError } from "@/components/forms";

function MyForm() {
  const [serverError, setServerError] = useState("");

  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<MyFormData>({
    resolver: zodResolver(myFormSchema),
    defaultValues: {
      title: "",
      description: "",
    },
  });

  async function onSubmit(data: MyFormData) {
    setServerError("");
    const result = await myServerAction(data);

    if (result.success) {
      // Handle success
    } else {
      setServerError(result.error);
    }
  }

  return (
    <form onSubmit={handleSubmit(onSubmit)} className="space-y-m">
      <FormField id="title" label="Title" error={errors.title?.message}>
        <FormInput
          id="title"
          type="text"
          placeholder="Enter title"
          disabled={isSubmitting}
          error={!!errors.title}
          {...register("title")}
        />
      </FormField>

      <ServerError message={serverError} />

      <button type="submit" disabled={isSubmitting}>
        {isSubmitting ? "Saving..." : "Save"}
      </button>
    </form>
  );
}
```

## Schema Patterns

### Basic Schema

Create schemas in `src/schemas/your-feature.ts`:

```typescript
import { z } from "zod";

export const myFormSchema = z.object({
  title: z.string().min(1, "Title is required").max(255),
  description: z.string().max(1000).optional().or(z.literal("")),
});

export type MyFormData = z.infer<typeof myFormSchema>;
```

### Cross-Field Validation

Use `.refine()` for fields that depend on each other:

```typescript
export const passwordFormSchema = z
  .object({
    password: z.string().min(8, "Password must be at least 8 characters"),
    confirmPassword: z.string().min(8, "Password must be at least 8 characters"),
  })
  .refine((data) => data.password === data.confirmPassword, {
    message: "Passwords do not match",
    path: ["confirmPassword"], // Error shows on this field
  });
```

### Server Action Schemas

Separate form schemas from server action schemas:

```typescript
// Form schema (client-side, UI fields only)
export const itemFormSchema = z.object({
  title: z.string().min(1, "Title is required").max(255),
  description: z.string().max(1000).optional().or(z.literal("")),
});

// Server action schema (includes additional fields like projectId)
export const createItemSchema = itemFormSchema.extend({
  projectId: z.string().uuid(),
});

// Usage in form
onSubmit={(data) => createItemFn({ ...data, projectId })}
```

### Optional Fields and Empty Strings

HTML inputs send `""` for empty fields, but Zod `.optional()` expects `undefined`. Use this pattern:

```typescript
description: z.string().max(1000).optional().or(z.literal(""))
```

## Component Utilities

### FormError

Displays field-level validation errors:

```typescript
<FormError message={errors.fieldName?.message} />
```

### ServerError

Displays server-side errors in an alert box:

```typescript
<ServerError message={serverError} />
```

**Tip:** For server validation errors on specific fields, use `setError`:

```typescript
setError('root.serverError', { type: 400, message: 'Server error' })
```

### FormField

Wrapper that combines label, input, and error:

```typescript
<FormField
  id="email"
  label="Email Address"
  error={errors.email?.message}
  helperText="We'll never share your email" // Optional
>
  <FormInput
    id="email"
    type="email"
    {...register("email")}
  />
</FormField>
```

### FormInput

Styled input component that integrates with React Hook Form:

```typescript
<FormInput
  id="title"
  type="text"
  placeholder="Enter title"
  disabled={isSubmitting}
  error={!!errors.title}
  {...register("title")}
/>
```

### FormTextarea

Styled textarea component:

```typescript
<FormTextarea
  id="description"
  placeholder="Enter description"
  disabled={isSubmitting}
  error={!!errors.description}
  {...register("description")}
/>
```

## React Query Integration

### Mutation with Form

```typescript
import { useMutation, useQueryClient } from "@tanstack/react-query";

function MyForm() {
  const queryClient = useQueryClient();

  const mutation = useMutation({
    mutationFn: createItemFn,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["items", projectId] });
      reset(); // Clear form
      onClose(); // Close modal
    },
  });

  async function onSubmit(data: MyFormData) {
    mutation.mutate({ ...data, projectId });
  }

  return (
    <form onSubmit={handleSubmit(onSubmit)}>
      {/* Form fields */}
      <ServerError message={mutation.error?.message} />
      <button type="submit" disabled={mutation.isPending}>
        {mutation.isPending ? "Saving..." : "Save"}
      </button>
    </form>
  );
}
```

## Best Practices

### 1. Schema Location

- Store schemas in `src/schemas/` directory
- Group by feature (e.g., `items.ts`, `auth.ts`)
- Export type inference: `export type MyFormData = z.infer<typeof myFormSchema>`

### 2. Error Messages

- Provide user-friendly error messages in schemas
- Keep messages short and actionable
- Use `ServerError` for server-side errors
- Use `FormError` for field-level errors

### 3. Form State

- Use `formState.isSubmitting` for loading states
- Clear server errors at the start of `onSubmit`
- Use `reset()` to clear form after success
- Use `getValues()` to access form data outside submit

### 4. Accessibility

- Always provide `id` and `label` for inputs
- Use `aria-label` for additional context
- `FormError` includes `role="alert"` for screen readers
- `ServerError` includes `role="alert"` and `aria-live="polite"`

### 5. Design System Compliance

- All form components use design system tokens
- No hardcoded colors or spacing
- Typography classes (`.body-medium`, `.body-small`)
- Consistent focus states (`focus:ring-2 focus:ring-[var(--clr-dark-purple)]`)

## Common Patterns

### Form with Success State

```typescript
const [success, setSuccess] = useState(false);

async function onSubmit(data: MyFormData) {
  const result = await myServerAction(data);

  if (result.success) {
    setSuccess(true);
    reset();
  } else {
    setServerError(result.error);
  }
}

if (success) {
  return <SuccessMessage />;
}

return <form>...</form>;
```

### Form with Conditional Logic

```typescript
const email = watch("email"); // Watch specific field

{showResendVerification && (
  <button onClick={() => handleResend(email)}>
    Resend Email
  </button>
)}
```

### Pre-filled Form (Edit Mode)

```typescript
const {
  register,
  handleSubmit,
  formState: { errors, isSubmitting },
} = useForm<MyFormData>({
  resolver: zodResolver(myFormSchema),
  defaultValues: {
    title: item?.title ?? "",
    description: item?.description ?? "",
  },
});
```

## Migration Checklist

When migrating an existing form to React Hook Form:

- [ ] Create Zod schema in `src/schemas/`
- [ ] Replace `useState` with `useForm`
- [ ] Add `zodResolver` with schema
- [ ] Replace `onChange` handlers with `{...register("fieldName")}`
- [ ] Replace manual error state with `errors.fieldName?.message`
- [ ] Replace loading state with `isSubmitting`
- [ ] Use `handleSubmit(onSubmit)` instead of manual `e.preventDefault()`
- [ ] Remove HTML5 validation attributes (`required`, `minLength`, etc.)
- [ ] Update components to use `FormField`, `FormInput`, `FormTextarea`
- [ ] Use `ServerError` for server-side errors
- [ ] Test validation (empty fields, length limits, cross-field validation)
- [ ] Test success and error paths
- [ ] Verify accessibility (keyboard navigation, screen reader)

## Numeric Input Coercion

HTML inputs always return strings. Use the shared utilities from `@/lib/form-utils` with `setValueAs` to coerce values before they reach Zod validation.

**Never use `valueAsNumber: true`** — it converts empty strings to `NaN`, which fails all Zod branches.

```typescript
import { numericValue, nullableNumericValue, integerValue } from "@/lib/form-utils";

// Optional number field (empty → undefined, otherwise parseFloat)
{...register("fieldSizeHa", { setValueAs: numericValue })}

// Nullable number field (empty → null, otherwise Number)
{...register("massKg", { setValueAs: nullableNumericValue })}

// Optional integer field (empty → undefined, otherwise parseInt)
{...register("residenceTimeMinutes", { setValueAs: integerValue })}
```

**Which to use:**
- `numericValue` — most common, for optional numeric fields with `z.number().optional()`
- `nullableNumericValue` — for nullable fields with `z.number().nullable().optional()`
- `integerValue` — for integer-only fields

## Zod Preprocessors for Nullable Numeric Fields

For Zod schemas that need string-to-number coercion (e.g., form inputs → nullable numbers), use the shared preprocessors from `@/schemas/helpers`:

```typescript
import { toNumberOrNull, toIntOrNull } from "@/schemas/helpers";

// Nullable float (empty → null, otherwise Number)
fieldKg: z.preprocess(toNumberOrNull, z.number().positive().nullable()).optional(),

// Nullable integer (empty → null, otherwise parseInt)
durationMinutes: z.preprocess(toIntOrNull, z.number().int().positive().nullable()).optional(),
```

This is cleaner than the `z.union([z.number(), z.string().transform(...), z.null()])` pattern and ensures validation runs on the coerced number.

## Zod String-to-Number Transform Gotchas

When using `z.union([z.number(), z.string().transform(...)])` for numeric fields, the string transform branch **bypasses** range validation on the number branch. Prefer `z.preprocess()` (above) instead. If you must use `z.union`, always validate inside the transform:

```typescript
// ❌ BAD — string "999" bypasses .min(-90).max(90)
gpsLatitude: z.union([
  z.number().min(-90).max(90),
  z.string().transform((val) => {
    if (val === "") return null;
    return parseFloat(val); // No range check!
  }),
]),

// ✅ GOOD — validate in the transform
gpsLatitude: z.union([
  z.number().min(-90).max(90),
  z.string().transform((val, ctx) => {
    if (val === "") return null;
    const n = parseFloat(val);
    if (isNaN(n) || n < -90 || n > 90) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: "Latitude must be between -90 and 90" });
      return z.NEVER;
    }
    return n;
  }),
]),
```

Same applies to date transforms — always validate `isNaN(date.getTime())` after `new Date(val)`.

### Date/DateTime Form Defaults

Use `@/lib/date-utils` for date and datetime default values. **Never** use `toISOString()` — it converts to UTC, which shifts the date in non-UTC timezones (e.g., midnight March 3 in UTC-5 becomes March 3 05:00 UTC, but 11 PM March 2 in UTC-5 becomes March 3 in UTC).

```typescript
import { formatLocalDate, formatLocalDateTime } from "@/lib/date-utils";

// BAD — UTC conversion shifts the date in negative-offset timezones
date: new Date().toISOString().split("T")[0],
startTime: new Date().toISOString().slice(0, 16),

// GOOD — formats in user's local timezone
date: formatLocalDate(new Date()),           // "2026-03-03"
startTime: formatLocalDateTime(new Date()),  // "2026-03-03T14:30"
```

Available helpers:
- `formatLocalDate(date)` → `"YYYY-MM-DD"` (for `<input type="date">`)
- `formatLocalDateTime(date)` → `"YYYY-MM-DDTHH:MM"` (for `<input type="datetime-local">`)
- `toDateInputValue(value)` → `"YYYY-MM-DD"` (accepts `string | Date | null`, passes through YYYY-MM-DD strings as-is)
- `parseLocalDateString(str)` → `Date` (avoids UTC midnight shift when parsing `"YYYY-MM-DD"`)

## Examples

See these files for complete examples:

- **Simple Form**: `src/components/items/ItemForm.tsx`
- **Single Field**: `src/components/auth/ForgotPasswordForm.tsx`
- **Cross-Field Validation**: `src/components/auth/SetPasswordForm.tsx`
- **Complex Logic**: `src/components/auth/LoginForm.tsx` (with resend verification)
