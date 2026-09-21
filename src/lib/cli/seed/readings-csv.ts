import { CSV } from "./constants";

export const READINGS_PER_RUN = CSV.hours * CSV.minutesPerHour / CSV.intervalMinutes;

export function buildReadingsCsv(start: Date): Buffer {
  const rows = ["timestamp_utc,temperature_c,pressure_bar"];
  for (let index = 0; index < READINGS_PER_RUN; index++) {
    const timestamp = new Date(start.getTime() + index * CSV.intervalMinutes * CSV.millisecondsPerMinute);
    const wave = Math.sin(index / CSV.oscillationRows);
    rows.push([
      timestamp.toISOString(),
      (CSV.temperatureC + CSV.temperatureSwingC * wave).toFixed(2),
      (CSV.pressureBar + CSV.pressureSwingBar * wave).toFixed(3),
    ].join(","));
  }
  return Buffer.from(`${rows.join("\n")}\n`);
}

