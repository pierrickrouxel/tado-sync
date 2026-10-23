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
 * Récupère les index GRDF des derniers jours et envoie à Tado ceux qui sont postérieurs au dernier
 * relevé déjà connu de Tado. Tado n'accepte que des index entiers.
 */
export async function sync(grdf: GrdfSource, tado: TadoTarget, options: SyncOptions): Promise<SyncResult> {
  const now = options.now ?? new Date();
  const start = new Date(now.getTime() - options.lookbackDays * 24 * 3600 * 1000);
  const indexes = await grdf.getMeterIndexes(formatDate(start), formatDate(now));
  logger.info(`GRDF : ${indexes.length} index récupéré(s) du ${formatDate(start)} au ${formatDate(now)}`);

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
      logger.info(`[dry-run] Tado : relevé ${reading} m³ du ${date} non envoyé`);
    } else {
      await tado.addMeterReading(date, reading);
      logger.info(`Tado : relevé ${reading} m³ du ${date} envoyé`);
    }
    result.pushed.push({ date, reading });
  }

  logger.info(`Synchronisation terminée : ${result.pushed.length} relevé(s) envoyé(s), ${result.skipped} ignoré(s) (déjà connus de Tado)`);
  return result;
}
