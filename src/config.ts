export interface Config {
  grdf: {
    username: string;
    password: string;
    /** Metering point (PCE). Optional: defaults to the account's first PCE. */
    pce?: string;
  };
  tado: {
    /** File storing the Tado refresh token (it rotates on every refresh). */
    tokenFile: string;
    /** Initial refresh token, only used while the token file does not exist yet. */
    refreshToken?: string;
    /** Tado home id. Optional: defaults to the account's first home. */
    homeId?: number;
  };
  /** Cron expression of the scheduled job. */
  cron: string;
  timezone: string;
  /** Number of days of GRDF history fetched on every sync. */
  lookbackDays: number;
  runOnStart: boolean;
  dryRun: boolean;
}

type Env = Record<string, string | undefined>;

function required(env: Env, name: string): string {
  const value = env[name]?.trim();
  if (!value) throw new Error(`Environment variable ${name} is required`);
  return value;
}

function optional(env: Env, name: string): string | undefined {
  const value = env[name]?.trim();
  return value ? value : undefined;
}

function bool(env: Env, name: string, fallback: boolean): boolean {
  const value = optional(env, name);
  if (value === undefined) return fallback;
  if (/^(1|true|yes|on)$/i.test(value)) return true;
  if (/^(0|false|no|off)$/i.test(value)) return false;
  throw new Error(`Environment variable ${name} must be a boolean (got "${value}")`);
}

function int(env: Env, name: string, fallback?: number): number | undefined {
  const value = optional(env, name);
  if (value === undefined) return fallback;
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed <= 0) {
    throw new Error(`Environment variable ${name} must be a positive integer (got "${value}")`);
  }
  return parsed;
}

export function loadConfig(env: Env = process.env): Config {
  return {
    grdf: {
      username: required(env, "GRDF_USERNAME"),
      password: required(env, "GRDF_PASSWORD"),
      pce: optional(env, "GRDF_PCE"),
    },
    tado: {
      tokenFile: optional(env, "TADO_TOKEN_FILE") ?? "./data/tado-token.json",
      refreshToken: optional(env, "TADO_REFRESH_TOKEN"),
      homeId: int(env, "TADO_HOME_ID"),
    },
    cron: optional(env, "CRON") ?? "0 10 * * *",
    timezone: optional(env, "TZ") ?? "Europe/Paris",
    lookbackDays: int(env, "LOOKBACK_DAYS", 30)!,
    runOnStart: bool(env, "RUN_ON_START", true),
    dryRun: bool(env, "DRY_RUN", false),
  };
}
