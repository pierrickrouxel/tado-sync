import { describe, expect, it, vi } from "vitest";
import type { GrdfSource, MeterIndex } from "../src/grdf.js";
import { sync } from "../src/sync.js";
import type { TadoMeterReading, TadoTarget } from "../src/tado.js";

function fakes(indexes: MeterIndex[], readings: TadoMeterReading[]) {
  const grdf: GrdfSource = { getMeterIndexes: vi.fn(async () => indexes) };
  const tado: TadoTarget = {
    getMeterReadings: vi.fn(async () => readings),
    addMeterReading: vi.fn(async () => {}),
  };
  return { grdf, tado };
}

describe("sync", () => {
  const now = new Date("2026-10-23T08:00:00Z");

  it("interroge GRDF sur la période demandée", async () => {
    const { grdf, tado } = fakes([], []);
    await sync(grdf, tado, { lookbackDays: 7, now });
    expect(grdf.getMeterIndexes).toHaveBeenCalledWith("2026-10-16", "2026-10-23");
  });

  it("envoie uniquement les index postérieurs au dernier relevé Tado, arrondis", async () => {
    const { grdf, tado } = fakes(
      [
        { date: "2026-10-19", index: 1000.4 },
        { date: "2026-10-20", index: 1003.6 },
        { date: "2026-10-21", index: 1007.2 },
      ],
      [{ date: "2026-10-19", reading: 1000 }],
    );
    const result = await sync(grdf, tado, { lookbackDays: 7, now });
    expect(tado.addMeterReading).toHaveBeenCalledTimes(2);
    expect(tado.addMeterReading).toHaveBeenNthCalledWith(1, "2026-10-20", 1004);
    expect(tado.addMeterReading).toHaveBeenNthCalledWith(2, "2026-10-21", 1007);
    expect(result.skipped).toBe(1);
  });

  it("n'envoie rien en dry-run", async () => {
    const { grdf, tado } = fakes([{ date: "2026-10-20", index: 1003 }], []);
    const result = await sync(grdf, tado, { lookbackDays: 7, now, dryRun: true });
    expect(tado.addMeterReading).not.toHaveBeenCalled();
    expect(result.pushed).toEqual([{ date: "2026-10-20", reading: 1003 }]);
  });
});
