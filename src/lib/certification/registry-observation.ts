export type RegistryObservationStatus =
  | "available"
  | "pending"
  | "unavailable";

export type RegistryObservation<T> =
  | {
      status: "available";
      value: T;
      message: string;
    }
  | {
      status: "pending" | "unavailable";
      value: null;
      message: string;
    };

export function classifyRegistryObservation(input: {
  hasExternalId: boolean;
  readFailed: boolean;
  complete: boolean;
}): RegistryObservationStatus {
  if (!input.hasExternalId) return "pending";
  if (input.readFailed) return "unavailable";
  return input.complete ? "available" : "pending";
}
