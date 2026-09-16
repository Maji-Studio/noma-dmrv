/** September 2026 operator-entered demo facts. Masses are kilograms. */
export const MAFINGA_CODE = "FAC-MAFINGA";
export const TIME_ZONE = "Africa/Dar_es_Salaam";
export const FACILITY = {
  name: "Mafinga Facility", country: "Tanzania", location: "Mafinga, Iringa",
  address: "Mafinga, Iringa, Tanzania", gpsLatitude: -8.30, gpsLongitude: 35.28,
  timezone: TIME_ZONE,
};
export const FORESTRY = { name: "Forestry waste", category: "forestry", usage: "pyrolysis" } as const;
export const MANURE = { name: "Chicken manure", category: "amendment", usage: "blend" } as const;
export const SUPPLIERS = [
  { name: "Demo Mafinga Forestry Sawmill", distanceKm: 15 },
  { name: "Demo Mafinga Poultry Farm", distanceKm: 12 },
] as const;
export const SUPPLIER_LOCATION = {
  name: "Mafinga Airport source", country: "Tanzania", stateRegion: "Iringa", city: "Mafinga",
  gpsLatitude: -8.32, gpsLongitude: 35.29, isDefault: true, distanceSource: "manual",
} as const;
export const CUSTOMER = { name: "Demo Mbeya Coffee Farm", cropType: "Coffee" };
export const CUSTOMER_LOCATION = {
  name: "Demo coffee field", country: "Tanzania", stateRegion: "Mbeya", city: "Mbeya",
  gpsLatitude: -8.91, gpsLongitude: 33.46, distanceFromFacilityKm: 240,
  distanceSource: "manual", isDefault: true,
} as const;
export const FORMULATION = { name: "Chicken manure 50/50", biocharPercent: 50, ingredientPercent: 50 };
export const DELIVERIES = [
  { date: "2026-09-02", material: "forestry", massKg: 2000, moisture: 20, distanceKm: 15 },
  { date: "2026-09-04", material: "manure", massKg: 1000, moisture: 30, distanceKm: 12 },
  { date: "2026-09-05", material: "forestry", massKg: 2000, moisture: 20, distanceKm: 18 },
] as const;
export const RUN_DATES = ["2026-09-08", "2026-09-10", "2026-09-12"] as const;
export const RUN = {
  startTime: "08:00", endTime: "16:00", wetMassKg: 1000, moisturePercent: 20,
  biocharOutputKg: 300, biocharMoisturePercent: 10, feedingRateKgHr: 125,
  residenceTimeMinutes: 30, dieselOperationLiters: 8, dieselGensetLiters: 4,
  preprocessingFuelLiters: 2, electricityKwh: 24,
};
export const SAMPLE_DATES = ["2026-09-13", "2026-09-14", "2026-09-15"] as const;
export const SAMPLE = {
  totalCarbonPercent: 78, organicCarbonPercent: 76, inorganicCarbonPercent: 2,
  totalHydrogenPercent: 2, totalNitrogenPercent: 1, totalOxygenPercent: 9,
  ashContentPercent: 10, moistureContentPercent: 10, ph: 9,
  randomReflectanceR0Percent: 2.5, sReflectanceFraction: 0.9,
  residualCarbonPercent: 90, r0MeasurementCount: 100,
};
export const PRODUCT_DATES = ["2026-09-15", "2026-09-18"] as const;
export const PRODUCT = { biocharWetKg: 300, ingredientWetKg: 300, moisturePercent: 10, waterAddedKg: 0 };
export const ORDER = { date: "2026-09-20", quantityKg: 1000, packaging: "loose", currency: "TZS" } as const;
export const SHIPMENT = { date: "2026-09-22", wetMassKg: 1000, moisturePercent: 20 };
export const EQUIPMENT = {
  reactor: { identifier: "Mafinga reactor 1", reactorType: "batch", nominalThroughputTph: 0.125 },
  driver: { name: "Demo driver" }, operator: { name: "Demo operator" },
  vehicle: { name: "Demo truck", identifier: "DEMO-MAFINGA", vehicleType: "truck", fuelType: "diesel", fuelConsumptionLPerKm: 0.3 },
} as const;
export const PERIOD = { start: "2026-09-01", end: "2026-09-30" };
export const CSV = { intervalMinutes: 5, minutesPerHour: 60, hours: 8, millisecondsPerMinute: 60_000, temperatureC: 550, temperatureSwingC: 15, pressureBar: 1.02, pressureSwingBar: 0.01, oscillationRows: 6 };
