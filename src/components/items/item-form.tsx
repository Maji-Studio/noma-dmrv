"use client";

import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import type { Item } from "@/db/schema";
import { itemFormSchema, type ItemFormData } from "@/schemas/items";
import { FormField, FormInput, FormTextarea } from "@/components/forms";

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
    <form onSubmit={handleSubmit(onSubmit)} className="space-y-m">
      <FormField id="title" label="Title" error={errors.title?.message}>
        <FormInput
          id="title"
          type="text"
          placeholder="Enter item title"
          disabled={isSubmitting}
          error={!!errors.title}
          {...register("title")}
        />
      </FormField>

      <FormField
        id="description"
        label="Description (optional)"
        error={errors.description?.message}
      >
        <FormTextarea
          id="description"
          placeholder="Enter item description"
          disabled={isSubmitting}
          error={!!errors.description}
          {...register("description")}
        />
      </FormField>

      <div className="flex items-center gap-s justify-end">
        <button
          type="button"
          onClick={onCancel}
          className="px-l py-s border border-[var(--color-border-primary)] rounded-lg hover:bg-[var(--color-bg-secondary)] transition-colors"
          disabled={isSubmitting}
        >
          Cancel
        </button>
        <button
          type="submit"
          className="px-l py-s bg-[var(--clr-dark-purple)] text-white rounded-lg hover:opacity-90 transition-opacity disabled:opacity-50"
          disabled={isSubmitting}
        >
          {isSubmitting ? "Saving..." : item ? "Update" : "Create"}
        </button>
      </div>
    </form>
  );
}
