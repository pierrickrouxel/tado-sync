export interface Config {
  grdf: {
    username: string;
    password: string;
    /** Point de comptage (PCE). Optionnel : le premier PCE du compte est utilisé sinon. */
    pce?: string;
  };
  tado: {
    /** Fichier où est conservé le refresh token Tado (il change à chaque rafraîchissement). */
    tokenFile: string;
    /** Refresh token initial, utilisé uniquement si le fichier de token n'existe pas encore. */
    refreshToken?: string;
    /** Identifiant du logement Tado. Optionnel : le premier logement du compte est utilisé sinon. */
    homeId?: number;
  };
  /** Expression cron de la tâche planifiée. */
  cron: string;
  timezone: string;
  /** Nombre de jours d'historique GRDF relus à chaque synchronisation. */
  lookbackDays: number;
  runOnStart: boolean;
  dryRun: boolean;
}

type Env = Record<string, string | undefined>;

function required(env: Env, name: string): string {
  const value = env[name]?.trim();
  if (!value) throw new Error(`La variable d'environnement ${name} est obligatoire`);
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
  throw new Error(`La variable d'environnement ${name} doit être un booléen (reçu "${value}")`);
}

function int(env: Env, name: string, fallback?: number): number | undefined {
  const value = optional(env, name);
  if (value === undefined) return fallback;
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed <= 0) {
    throw new Error(`La variable d'environnement ${name} doit être un entier positif (reçu "${value}")`);
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
