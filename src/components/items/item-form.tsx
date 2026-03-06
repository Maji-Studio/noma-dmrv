"use client";

import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import type { Item } from "@/db/schema";
import { itemFormSchema, type ItemFormData } from "@/schemas/items";
import { FormField, FormInput, FormTextarea } from "@/components/forms";
import { Button } from "@/components/ui";

interface ItemFormProps {
  item?: Item;
  onSubmit: (data: ItemFormData) => void;
  onCancel: () => void;
  isSubmitting?: boolean;
}

export function ItemForm({
  item,
  onSubmit,
  onCancel,
  isSubmitting,
}: ItemFormProps) {
  const {
    register,
    handleSubmit,
    formState: { errors },
  } = useForm<ItemFormData>({
    resolver: zodResolver(itemFormSchema),
    defaultValues: {
      title: item?.title ?? "",
      description: item?.description ?? "",
    },
  });

  return (
    <form onSubmit={handleSubmit(onSubmit)} className="space-y-24">
      <FormField id="title" label="Title" error={errors.title?.message} required>
        <FormInput
          id="title"
          type="text"
          placeholder="e.g., Feedstock intake checklist"
          disabled={isSubmitting}
          error={!!errors.title}
          {...register("title")}
        />
      </FormField>

      <FormField
        id="description"
        label="Description"
        error={errors.description?.message}
      >
        <FormTextarea
          id="description"
          placeholder="Describe the MRV task, workflow, or operating note"
          disabled={isSubmitting}
          error={!!errors.description}
          {...register("description")}
        />
      </FormField>

      <div className="flex items-center gap-16 justify-end">
        <Button size="large" variant="default" onClick={onCancel} disabled={isSubmitting}>
          Cancel
        </Button>
        <Button type="submit" size="large" variant="primary" disabled={isSubmitting}>
          {isSubmitting ? "Saving..." : item ? "Update" : "Create"}
        </Button>
      </div>
    </form>
  );
}
