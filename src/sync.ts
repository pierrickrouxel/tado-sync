import type { GrdfSource } from "./grdf.js";
import { logger } from "./logger.js";
import type { TadoTarget } from "./tado.js";

export interface SyncOptions {
  lookbackDays: number;
  dryRun?: boolean;
  now?: Date;
}

export interface SyncResult {
  pushed: Array<{ date: string; reading: number }>;
  skipped: number;
}

export function formatDate(date: Date): string {
  return date.toISOString().slice(0, 10);
}

/**
 * Fetches the GRDF indexes of the last days and pushes to Tado those newer than the latest
 * reading Tado already knows. Tado only accepts integer readings.
 */
export async function sync(grdf: GrdfSource, tado: TadoTarget, options: SyncOptions): Promise<SyncResult> {
  const now = options.now ?? new Date();
  const start = new Date(now.getTime() - options.lookbackDays * 24 * 3600 * 1000);
  const indexes = await grdf.getMeterIndexes(formatDate(start), formatDate(now));
  logger.info(`GRDF: fetched ${indexes.length} index(es) from ${formatDate(start)} to ${formatDate(now)}`);

  const existing = await tado.getMeterReadings();
  const existingDates = new Set(existing.map((reading) => reading.date.slice(0, 10)));
  const lastDate = [...existingDates].sort().at(-1) ?? "";

  const result: SyncResult = { pushed: [], skipped: 0 };
  for (const { date, index } of indexes) {
    if (existingDates.has(date) || date <= lastDate) {
      result.skipped++;
      continue;
    }
    const reading = Math.round(index);
    if (options.dryRun) {
      logger.info(`[dry-run] Tado: reading ${reading} m³ for ${date} not sent`);
    } else {
      await tado.addMeterReading(date, reading);
      logger.info(`Tado: reading ${reading} m³ for ${date} sent`);
    }
    result.pushed.push({ date, reading });
  }

  logger.info(`Sync done: ${result.pushed.length} reading(s) sent, ${result.skipped} skipped (already known by Tado)`);
  return result;
}
