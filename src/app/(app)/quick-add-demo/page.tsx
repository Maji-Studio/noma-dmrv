/**
 * Quick Add Demo Page
 * Demonstrates inline quick-add dialog components for drivers, vehicles, and feedstock types
 */
"use client";

import { useState } from "react";
import { useForm } from "react-hook-form";
import { FormEntitySelect } from "@/components/forms/entity-select";
import {
  DriverQuickAddDialog,
  VehicleQuickAddDialog,
  FeedstockTypeQuickAddDialog,
  useQuickAddDialog,
  type EntityOption,
} from "@/components/forms/entity-select";
import { useQueryClient } from "@tanstack/react-query";

interface DemoFormData {
  driverId?: string;
  vehicleId?: string;
  feedstockTypeId?: string;
}

export default function QuickAddDemoPage() {
  const { control, watch, setValue } = useForm<DemoFormData>();
  const queryClient = useQueryClient();

  // Dialog state for each entity type
  const driverDialog = useQuickAddDialog();
  const vehicleDialog = useQuickAddDialog();
  const feedstockTypeDialog = useQuickAddDialog();

  // Track created entities for display
  const [createdEntities, setCreatedEntities] = useState<{
    drivers: EntityOption[];
    vehicles: EntityOption[];
    feedstockTypes: EntityOption[];
  }>({
    drivers: [],
    vehicles: [],
    feedstockTypes: [],
  });

  // Watch form values for display
  const driverId = watch("driverId");
  const vehicleId = watch("vehicleId");
  const feedstockTypeId = watch("feedstockTypeId");

  // Handlers for when new entities are created
  const handleDriverCreated = (entity: EntityOption) => {
    setCreatedEntities((prev) => ({
      ...prev,
      drivers: [...prev.drivers, entity],
    }));
    // Auto-select the newly created entity
    setValue("driverId", entity.id);
    // Invalidate the entities query to refresh the dropdown
    queryClient.invalidateQueries({ queryKey: ["entities", "driver"] });
  };

  const handleVehicleCreated = (entity: EntityOption) => {
    setCreatedEntities((prev) => ({
      ...prev,
      vehicles: [...prev.vehicles, entity],
    }));
    setValue("vehicleId", entity.id);
    queryClient.invalidateQueries({ queryKey: ["entities", "vehicle"] });
  };

  const handleFeedstockTypeCreated = (entity: EntityOption) => {
    setCreatedEntities((prev) => ({
      ...prev,
      feedstockTypes: [...prev.feedstockTypes, entity],
    }));
    setValue("feedstockTypeId", entity.id);
    queryClient.invalidateQueries({ queryKey: ["entities", "feedstockType"] });
  };

  return (
    <div className="container-max page-shell">
      <div>
        <h1 className="title-heading-2">Quick Add Dialogs Demo</h1>
        <p className="text-[var(--color-text-secondary)]">
          This page demonstrates inline quick-add dialog components for drivers,
          vehicles, and feedstock types. Click the &quot;Add new...&quot; option
          at the bottom of each dropdown to create new entities without leaving
          the form.
        </p>
      </div>

      <div className="grid gap-24 md:grid-cols-2">
        {/* Form Section */}
        <div className="space-y-84">
          <div className="border border-[var(--color-border-primary)] p-24 rounded-[8px]">
            <h2 className="title-heading-3 mb-16">Entity Selection Form</h2>

            <div className="space-y-46">
              {/* Driver Select */}
              <FormEntitySelect
                control={control}
                name="driverId"
                label="Driver"
                entityType="driver"
                placeholder="Select a driver..."
                allowCreate={true}
                createLabel="Add new driver"
                onCreateNew={driverDialog.open}
              />

              {/* Vehicle Select */}
              <FormEntitySelect
                control={control}
                name="vehicleId"
                label="Vehicle"
                entityType="vehicle"
                placeholder="Select a vehicle..."
                allowCreate={true}
                createLabel="Add new vehicle"
                onCreateNew={vehicleDialog.open}
              />

              {/* Feedstock Type Select */}
              <FormEntitySelect
                control={control}
                name="feedstockTypeId"
                label="Feedstock Type"
                entityType="feedstockType"
                placeholder="Select a feedstock type..."
                allowCreate={true}
                createLabel="Add new feedstock type"
                onCreateNew={feedstockTypeDialog.open}
              />
            </div>
          </div>

          {/* Selected Values */}
          <div className="border border-[var(--color-border-primary)] p-24 rounded-[8px] bg-[var(--color-background-light)]">
            <h3 className="label-medium mb-8">Selected Values</h3>
            <pre className="text-[var(--text-xs)] text-[var(--color-text-secondary)] font-mono">
              {JSON.stringify(
                {
                  driverId: driverId || null,
                  vehicleId: vehicleId || null,
                  feedstockTypeId: feedstockTypeId || null,
                },
                null,
                2
              )}
            </pre>
          </div>
        </div>

        {/* Created Entities Section */}
        <div className="space-y-84">
          <div className="border border-[var(--color-border-primary)] p-24 rounded-[8px]">
            <h2 className="title-heading-3 mb-16">Newly Created Entities</h2>

            {createdEntities.drivers.length === 0 &&
            createdEntities.vehicles.length === 0 &&
            createdEntities.feedstockTypes.length === 0 ? (
              <p className="text-[var(--color-text-tertiary)] text-[var(--text-s)]">
                No entities created yet. Use the &quot;Add new...&quot; option in
                the dropdowns to create new entities.
              </p>
            ) : (
              <div className="space-y-46">
                {createdEntities.drivers.length > 0 && (
                  <div>
                    <h4 className="label-medium mb-8 text-[var(--color-interaction)]">
                      Drivers ({createdEntities.drivers.length})
                    </h4>
                    <ul className="space-y-4">
                      {createdEntities.drivers.map((entity) => (
                        <li
                          key={entity.id}
                          className="text-[var(--text-s)] bg-[var(--color-background-light)] p-8 rounded-none"
                        >
                          <span className="font-medium">{entity.code}</span>
                          <span className="mx-4">-</span>
                          <span>{entity.name}</span>
                          {entity.subtitle && (
                            <span className="text-[var(--color-text-tertiary)] ml-8">
                              ({entity.subtitle})
                            </span>
                          )}
                        </li>
                      ))}
                    </ul>
                  </div>
                )}

                {createdEntities.vehicles.length > 0 && (
                  <div>
                    <h4 className="label-medium mb-8 text-[var(--color-interaction)]">
                      Vehicles ({createdEntities.vehicles.length})
                    </h4>
                    <ul className="space-y-4">
                      {createdEntities.vehicles.map((entity) => (
                        <li
                          key={entity.id}
                          className="text-[var(--text-s)] bg-[var(--color-background-light)] p-8 rounded-none"
                        >
                          <span className="font-medium">{entity.code}</span>
                          <span className="mx-4">-</span>
                          <span>{entity.name}</span>
                          {entity.subtitle && (
                            <span className="text-[var(--color-text-tertiary)] ml-8">
                              ({entity.subtitle})
                            </span>
                          )}
                        </li>
                      ))}
                    </ul>
                  </div>
                )}

                {createdEntities.feedstockTypes.length > 0 && (
                  <div>
                    <h4 className="label-medium mb-8 text-[var(--color-interaction)]">
                      Feedstock Types ({createdEntities.feedstockTypes.length})
                    </h4>
                    <ul className="space-y-4">
                      {createdEntities.feedstockTypes.map((entity) => (
                        <li
                          key={entity.id}
                          className="text-[var(--text-s)] bg-[var(--color-background-light)] p-8 rounded-none"
                        >
                          <span className="font-medium">{entity.code}</span>
                          <span className="mx-4">-</span>
                          <span>{entity.name}</span>
                          {entity.subtitle && (
                            <span className="text-[var(--color-text-tertiary)] ml-8">
                              ({entity.subtitle})
                            </span>
                          )}
                        </li>
                      ))}
                    </ul>
                  </div>
                )}
              </div>
            )}
          </div>

          {/* Instructions */}
          <div className="border border-[var(--color-border-primary)] p-24 rounded-[8px] bg-[var(--color-background-light)]">
            <h3 className="label-medium mb-8">How it Works</h3>
            <ol className="text-[var(--text-s)] text-[var(--color-text-secondary)] space-y-8 list-decimal list-inside">
              <li>Click on any entity select dropdown</li>
              <li>Scroll to the bottom of the dropdown options</li>
              <li>Click &quot;Add new...&quot; to open the quick-add dialog</li>
              <li>Fill in the required fields and submit</li>
              <li>The new entity is automatically selected in the form</li>
            </ol>
          </div>
        </div>
      </div>

      {/* Quick Add Dialogs */}
      <DriverQuickAddDialog
        isOpen={driverDialog.isOpen}
        onClose={driverDialog.close}
        onSuccess={handleDriverCreated}
      />
      <VehicleQuickAddDialog
        isOpen={vehicleDialog.isOpen}
        onClose={vehicleDialog.close}
        onSuccess={handleVehicleCreated}
      />
      <FeedstockTypeQuickAddDialog
        isOpen={feedstockTypeDialog.isOpen}
        onClose={feedstockTypeDialog.close}
        onSuccess={handleFeedstockTypeCreated}
      />
    </div>
  );
}
