import { describe, expect, it } from "vitest";
import {
  inspectReactorDayCsv,
  parseReactorDayCsv,
} from "./reactor-day-csv";

describe("parseReactorDayCsv", () => {
  it("converts reactor-day rows to UTC readings inside the run window", () => {
    const csv = [
      "Time,Carbonization Outlet Temperature,Drying Drum Pressure,Main Gas Flow",
      "00:00:00,500,0.12,7.5",
      "00:01:00,---,0.13,",
      "00:02:00,510,0.14,8.1",
      ",,,",
    ].join("\n");

    const result = parseReactorDayCsv({
      fileName: "TZ001B 2026-04-02 Data Evaluation.csv",
      csvText: csv,
      timezone: "Africa/Nairobi",
      runWindowStart: new Date("2026-04-01T21:00:00.000Z"),
      runWindowEnd: new Date("2026-04-01T21:02:00.000Z"),
      mapping: {
        temperature: "Carbonization Outlet Temperature",
        pressure: "Drying Drum Pressure",
        gasFlow: "Main Gas Flow",
      },
    });

    expect(result.fileReactorCode).toBe("TZ001B");
    expect(result.fileDate).toBe("2026-04-02");
    expect(result.parsedRows).toBe(3);
    expect(result.inWindowRows).toBe(2);
    expect(result.droppedRows).toBe(1);
    expect(result.readings).toEqual([
      {
        timestamp: new Date("2026-04-01T21:00:00.000Z"),
        temperatureC: 500,
        pressureBar: 0.12,
        gasFlowRate: 7.5,
      },
      {
        timestamp: new Date("2026-04-01T21:01:00.000Z"),
        temperatureC: null,
        pressureBar: 0.13,
        gasFlowRate: null,
      },
    ]);
  });

  it("requires channel alignment when the saved header signature drifts", () => {
    const csv = [
      "Time,Carbonization Outlet Temperature,Drying Drum Pressure,Main Gas Flow",
      "00:00:00,500,0.12,7.5",
    ].join("\n");

    const result = inspectReactorDayCsv({
      fileName: "TZ001B 2026-04-02 Data Evaluation.csv",
      csvText: csv,
      runReactorCode: "TZ001B",
      storedMapping: {
        headerSignature: "old-header",
        temperature: "Old Temperature",
        pressure: "Old Pressure",
        gasFlow: null,
      },
    });

    expect(result.requiresMapping).toBe(true);
    expect(result.headerSignature).not.toBe("old-header");
    expect(result.suggestedMapping).toEqual({
      temperature: "Carbonization Outlet Temperature",
      pressure: "Drying Drum Pressure",
      gasFlow: "Main Gas Flow",
    });
    expect(result.warnings).toEqual([]);
  });

  it("suggests the production channels from the reactor-day export header", () => {
    const headers = [
      "Time",
      "Real - time current 136",
      "Real - time current 125",
      "Real - time current 129",
      "Real - time current 115",
      "Real - time current 141",
      "Real - time current 145",
      "Real - time current 111",
      "Real - time current 114",
      "Real - time current 123",
      "Real - time current 130",
      "Real-time opening degree 120A",
      "Real-time opening degree 120B",
      "Real-time opening degree 121A",
      "Real-time opening degree 121B",
      "Real-time opening degree 122A",
      "Real-time opening degree 122B",
      "Real-time frequency 136",
      "Real-time frequency 125",
      "Real-time frequency 129",
      "Real-time frequency 115",
      "Real-time frequency 141",
      "Real-time frequency 111",
      "Real-time frequency 114",
      "Real-time frequency 123",
      "Real-time frequency 130",
      "Bag Filter Temperature",
      "Drum Outlet Temperature",
      "Drum Inlet Temperature",
      "Combustion Chamber Temperature",
      "Carbonization Outlet Temperature",
      "Drying Drum Pressure",
      "Carbonization Pressure",
      "Instantaneous flow rate 140",
      "Instantaneous flow rate 104",
      "Cumulative flow 140",
      "Cumulative flow 104",
    ];
    const csv = [
      headers.join(","),
      "00:00:00,0,0,0,0,0,0,0,0,0,0,100,0,93,0,26,1,0,0,0,0,0,0,0,0,0,20,24,33,24,22,0,0,0,---,14626,---",
    ].join("\n");

    const result = inspectReactorDayCsv({
      fileName: "TZ001B 2026-04-02 Data Evaluation.csv",
      csvText: csv,
      runReactorCode: "TZ001B",
    });

    expect(result.suggestedMapping).toEqual({
      temperature: "Carbonization Outlet Temperature",
      pressure: "Drying Drum Pressure",
      gasFlow: "Instantaneous flow rate 140",
    });
  });
});
