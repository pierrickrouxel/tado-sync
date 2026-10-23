import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import type { FetchFn } from "./http.js";
import { logger } from "./logger.js";

const CLIENT_ID = "1bb50063-6b0c-4d11-bd99-387f4a91cc46";
const DEVICE_AUTHORIZE_URL = "https://login.tado.com/oauth2/device_authorize";
const TOKEN_URL = "https://login.tado.com/oauth2/token";
const TADO_API_URL = "https://my.tado.com/api/v2";
const EIQ_API_URL = "https://energy-insights.tado.com/api";

interface TokenResponse {
  access_token: string;
  refresh_token: string;
  expires_in: number;
}

interface DeviceAuthorizeResponse {
  device_code: string;
  user_code: string;
  verification_uri: string;
  verification_uri_complete?: string;
  expires_in: number;
  interval?: number;
}

export interface TadoMeterReading {
  id?: string;
  date: string;
  reading: number;
}

export interface TadoTarget {
  getMeterReadings(): Promise<TadoMeterReading[]>;
  addMeterReading(date: string, reading: number): Promise<void>;
}

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

/**
 * Authentification OAuth2 Tado (device code flow). Tado fait tourner le refresh token à chaque
 * utilisation : il est donc enregistré dans un fichier persistant après chaque rafraîchissement.
 */
export class TadoAuth {
  private accessToken?: string;
  private expiresAt = 0;

  constructor(
    private readonly tokenFile: string,
    private readonly initialRefreshToken?: string,
    private readonly fetchFn: FetchFn = fetch,
    private readonly wait: (ms: number) => Promise<void> = sleep,
  ) {}

  private async readRefreshToken(): Promise<string | undefined> {
    try {
      const content = JSON.parse(await readFile(this.tokenFile, "utf8")) as { refresh_token?: string };
      if (content.refresh_token) return content.refresh_token;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    }
    return this.initialRefreshToken;
  }

  private async saveTokens(tokens: TokenResponse): Promise<void> {
    await mkdir(dirname(this.tokenFile), { recursive: true });
    const tmp = `${this.tokenFile}.tmp`;
    await writeFile(tmp, JSON.stringify({ refresh_token: tokens.refresh_token, updated_at: new Date().toISOString() }), {
      mode: 0o600,
    });
    await rename(tmp, this.tokenFile);
    this.accessToken = tokens.access_token;
    this.expiresAt = Date.now() + (tokens.expires_in - 30) * 1000;
  }

  private async tokenRequest(params: Record<string, string>): Promise<Response> {
    return this.fetchFn(TOKEN_URL, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ client_id: CLIENT_ID, ...params }),
    });
  }

  private async refresh(refreshToken: string): Promise<boolean> {
    const response = await this.tokenRequest({ grant_type: "refresh_token", refresh_token: refreshToken });
    if (!response.ok) {
      logger.warn(`Tado : refresh token refusé (HTTP ${response.status}), nouvelle autorisation nécessaire`);
      return false;
    }
    await this.saveTokens((await response.json()) as TokenResponse);
    return true;
  }

  /** Lance le device code flow : affiche un lien à ouvrir puis attend la validation de l'utilisateur. */
  async deviceLogin(): Promise<void> {
    for (;;) {
      const response = await this.fetchFn(DEVICE_AUTHORIZE_URL, {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({ client_id: CLIENT_ID, scope: "offline_access" }),
      });
      if (!response.ok) throw new Error(`Tado : impossible de démarrer l'autorisation (HTTP ${response.status})`);
      const device = (await response.json()) as DeviceAuthorizeResponse;
      const url = device.verification_uri_complete ?? `${device.verification_uri}?user_code=${device.user_code}`;
      logger.warn(`Tado : ouvrez ${url} pour autoriser tado-sync (code ${device.user_code})`);

      const deadline = Date.now() + device.expires_in * 1000;
      const interval = Math.max(device.interval ?? 5, 1) * 1000;
      while (Date.now() < deadline) {
        await this.wait(interval);
        const poll = await this.tokenRequest({
          grant_type: "urn:ietf:params:oauth:grant-type:device_code",
          device_code: device.device_code,
        });
        if (poll.ok) {
          await this.saveTokens((await poll.json()) as TokenResponse);
          logger.info("Tado : autorisation accordée");
          return;
        }
        const { error } = (await poll.json().catch(() => ({}))) as { error?: string };
        if (error !== "authorization_pending" && error !== "slow_down") {
          throw new Error(`Tado : autorisation refusée (${error ?? `HTTP ${poll.status}`})`);
        }
      }
      logger.warn("Tado : le lien d'autorisation a expiré, génération d'un nouveau lien");
    }
  }

  async getAccessToken(): Promise<string> {
    if (this.accessToken && Date.now() < this.expiresAt) return this.accessToken;
    const refreshToken = await this.readRefreshToken();
    if (!refreshToken || !(await this.refresh(refreshToken))) await this.deviceLogin();
    return this.accessToken!;
  }
}

export class TadoClient implements TadoTarget {
  constructor(
    private readonly auth: TadoAuth,
    private homeId?: number,
    private readonly fetchFn: FetchFn = fetch,
  ) {}

  private async request<T>(url: string, init: RequestInit = {}): Promise<T> {
    const headers = new Headers(init.headers);
    headers.set("Authorization", `Bearer ${await this.auth.getAccessToken()}`);
    headers.set("Accept", "application/json");
    const response = await this.fetchFn(url, { ...init, headers });
    const text = await response.text();
    if (!response.ok) throw new Error(`Tado : erreur sur ${url} (HTTP ${response.status}) ${text}`.trim());
    return (text ? JSON.parse(text) : undefined) as T;
  }

  async getHomeId(): Promise<number> {
    if (this.homeId) return this.homeId;
    const me = await this.request<{ homes?: Array<{ id: number; name?: string }> }>(`${TADO_API_URL}/me`);
    const home = me.homes?.[0];
    if (!home) throw new Error("Tado : aucun logement trouvé sur le compte");
    logger.info(`Tado : logement ${home.name ?? ""} (${home.id}) utilisé`.replace("  ", " "));
    this.homeId = home.id;
    return home.id;
  }

  async getMeterReadings(): Promise<TadoMeterReading[]> {
    const homeId = await this.getHomeId();
    const data = await this.request<{ readings?: TadoMeterReading[] }>(`${EIQ_API_URL}/homes/${homeId}/meterReadings`);
    return data?.readings ?? [];
  }

  async addMeterReading(date: string, reading: number): Promise<void> {
    const homeId = await this.getHomeId();
    await this.request(`${EIQ_API_URL}/homes/${homeId}/meterReadings`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ date, reading }),
    });
  }
}
