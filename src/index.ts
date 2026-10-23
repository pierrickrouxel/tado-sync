import { Cron } from "croner";
import { loadConfig } from "./config.js";
import { GrdfClient } from "./grdf.js";
import { logger } from "./logger.js";
import { sync } from "./sync.js";
import { TadoAuth, TadoClient } from "./tado.js";

async function main(): Promise<void> {
  const args = new Set(process.argv.slice(2));
  const config = loadConfig();
  const auth = new TadoAuth(config.tado.tokenFile, config.tado.refreshToken);
  const tado = new TadoClient(auth, config.tado.homeId);

  // Check (or obtain) the Tado authorization at startup so the login link is shown right away.
  await auth.getAccessToken();
  if (args.has("--auth")) return;

  const run = async () => {
    const grdf = new GrdfClient(config.grdf.username, config.grdf.password, config.grdf.pce);
    await sync(grdf, tado, { lookbackDays: config.lookbackDays, dryRun: config.dryRun });
  };

  if (args.has("--once")) {
    await run();
    return;
  }

  const job = new Cron(config.cron, { timezone: config.timezone, protect: true }, async () => {
    try {
      await run();
    } catch (error) {
      logger.error("Sync failed:", error instanceof Error ? error.message : error);
    }
  });
  logger.info(`Scheduled job "${config.cron}" (${config.timezone}), next run: ${job.nextRun()?.toISOString()}`);
  if (config.runOnStart) await job.trigger();

  const stop = () => {
    job.stop();
    process.exit(0);
  };
  process.on("SIGTERM", stop);
  process.on("SIGINT", stop);
}

main().catch((error: unknown) => {
  logger.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
