import { certifierProjects } from "@/db/schema";

export type CertifierProvider =
  (typeof certifierProjects.$inferSelect)["provider"];

export interface ApplicationCo2eStoredPreview {
  applicationId: string;
  applicationCode: string;
  co2eStoredTonnes: number | null;
  rawFDurable: number | null;
  fDurable: number | null;
  durabilityCapped: boolean;
  organicCarbonPercent: number | null;
  effectiveSoilTemperatureC: number | null;
  missingInputs: string[];
  warnings: string[];
}

export interface CreditBatchCo2eStoredPreview {
  provider: CertifierProvider | null;
  co2eStoredTonnes: number | null;
  componentKey: string | null;
  moduleVersion: string | null;
  formulaVersion: string | null;
  applicationResults: ApplicationCo2eStoredPreview[];
  missingInputs: string[];
  warnings: string[];
}
