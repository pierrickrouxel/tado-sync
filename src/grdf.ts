import { CookieJar, fetchWithCookies, type FetchFn } from "./http.js";
import { logger } from "./logger.js";

const START_URL = "https://monespace.grdf.fr/";
const IDENTIFY_URL = "https://connexion.grdf.fr/idp/idx/identify";
const CHALLENGE_URL = "https://connexion.grdf.fr/idp/idx/challenge/answer";
const API_BASE_URL = "https://monespace.grdf.fr/api";
const USER_AGENT = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko)";
const OKTA_HEADERS = { Accept: "application/json; okta-version=1.0.0", "Content-Type": "application/json" };

/** Un relevé journalier tel que renvoyé par l'espace client GRDF. */
export interface GrdfReleve {
  journeeGaziere: string;
  dateDebutReleve?: string;
  dateFinReleve?: string;
  indexDebut: number | null;
  indexFin: number | null;
  volumeBrutConsomme: number | null;
  energieConsomme: number | null;
  qualificationReleve?: string | null;
}

/** Index de compteur relevé à la fin d'une journée gazière. */
export interface MeterIndex {
  /** Date au format AAAA-MM-JJ. */
  date: string;
  /** Index du compteur en m³. */
  index: number;
}

export interface GrdfSource {
  getMeterIndexes(start: string, end: string): Promise<MeterIndex[]>;
}

export class GrdfClient implements GrdfSource {
  private jar = new CookieJar();
  private loggedIn = false;

  constructor(
    private readonly username: string,
    private readonly password: string,
    private pce?: string,
    private readonly fetchFn: FetchFn = fetch,
  ) {}

  private request(url: string, init: RequestInit = {}): Promise<Response> {
    const headers = new Headers(init.headers);
    headers.set("User-Agent", USER_AGENT);
    return fetchWithCookies(this.jar, url, { ...init, headers }, this.fetchFn);
  }

  async login(): Promise<void> {
    this.jar = new CookieJar();

    const start = await this.request(START_URL);
    if (!start.ok) throw new Error(`GRDF : page de connexion inaccessible (HTTP ${start.status})`);
    const html = await start.text();
    const match = /"stateToken"\s*:\s*"([^"]+)"/.exec(html);
    if (!match?.[1]) throw new Error("GRDF : stateToken introuvable dans la page de connexion");
    const stateToken = match[1].replace(/\\x2D/g, "-");

    this.jar.set("ln", this.username, "connexion.grdf.fr");
    const identify = await this.request(IDENTIFY_URL, {
      method: "POST",
      headers: OKTA_HEADERS,
      body: JSON.stringify({ identifier: this.username, stateHandle: stateToken }),
    });
    if (!identify.ok) throw new Error(`GRDF : identifiant refusé (HTTP ${identify.status})`);
    const { stateHandle } = (await identify.json()) as { stateHandle?: string };
    if (!stateHandle) throw new Error("GRDF : stateHandle absent de la réponse d'identification");

    const challenge = await this.request(CHALLENGE_URL, {
      method: "POST",
      headers: OKTA_HEADERS,
      body: JSON.stringify({ credentials: { passcode: this.password }, stateHandle }),
    });
    if (!challenge.ok) throw new Error(`GRDF : mot de passe refusé (HTTP ${challenge.status})`);
    const successUrl = ((await challenge.json()) as { success?: { href?: string } }).success?.href;
    if (!successUrl) throw new Error("GRDF : connexion incomplète (authentification à deux facteurs activée ?)");

    const redirect = await this.request(successUrl);
    if (!redirect.ok) throw new Error(`GRDF : échec de la redirection après connexion (HTTP ${redirect.status})`);

    this.loggedIn = true;
    logger.info("GRDF : connecté");
  }

  private async api<T>(path: string, params: Record<string, string>): Promise<T> {
    if (!this.loggedIn) await this.login();
    const url = new URL(`${API_BASE_URL}${path}`);
    for (const [key, value] of Object.entries(params)) url.searchParams.set(key, value);
    const response = await this.request(url.toString(), { headers: { Accept: "application/json" } });
    const contentType = response.headers.get("content-type") ?? "";
    if (!response.ok || !contentType.includes("json")) {
      throw new Error(`GRDF : erreur sur ${path} (HTTP ${response.status}, ${contentType || "sans type"})`);
    }
    return (await response.json()) as T;
  }

  async getPce(): Promise<string> {
    if (this.pce) return this.pce;
    const list = await this.api<Array<{ idObject?: string; pce?: string }>>("/e-conso/pce", { details: "false" });
    const pce = list[0]?.idObject ?? list[0]?.pce;
    if (!pce) throw new Error("GRDF : aucun PCE trouvé sur le compte, renseignez GRDF_PCE");
    logger.info(`GRDF : PCE ${pce} utilisé`);
    this.pce = pce;
    return pce;
  }

  async getReleves(start: string, end: string): Promise<GrdfReleve[]> {
    const pce = await this.getPce();
    const data = await this.api<Record<string, { releves?: GrdfReleve[] }> | []>(
      "/e-conso/pce/consommation/informatives",
      { dateDebut: start, dateFin: end, "pceList[]": pce },
    );
    if (Array.isArray(data)) return [];
    return data[pce]?.releves ?? [];
  }

  async getMeterIndexes(start: string, end: string): Promise<MeterIndex[]> {
    return toMeterIndexes(await this.getReleves(start, end));
  }
}

export function toMeterIndexes(releves: GrdfReleve[]): MeterIndex[] {
  const byDate = new Map<string, number>();
  for (const releve of releves) {
    if (releve.indexFin === null || releve.indexFin === undefined || !releve.journeeGaziere) continue;
    byDate.set(releve.journeeGaziere.slice(0, 10), releve.indexFin);
  }
  return [...byDate.entries()]
    .map(([date, index]) => ({ date, index }))
    .sort((a, b) => a.date.localeCompare(b.date));
}
