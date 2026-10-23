import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { TadoAuth, TadoClient } from "../src/tado.js";

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

async function tokenFile(content?: unknown): Promise<string> {
  const file = join(await mkdtemp(join(tmpdir(), "tado-sync-")), "token.json");
  if (content) await writeFile(file, JSON.stringify(content));
  return file;
}

describe("TadoAuth", () => {
  it("refreshes the token and saves the new refresh token", async () => {
    const file = await tokenFile({ refresh_token: "old" });
    let body: URLSearchParams | undefined;
    const fetchFn = (async (_url: URL | string, init: RequestInit = {}) => {
      body = init.body as URLSearchParams;
      return json({ access_token: "access", refresh_token: "new", expires_in: 600 });
    }) as typeof fetch;

    const auth = new TadoAuth(file, undefined, fetchFn);
    expect(await auth.getAccessToken()).toBe("access");
    expect(body?.get("grant_type")).toBe("refresh_token");
    expect(body?.get("refresh_token")).toBe("old");
    expect(JSON.parse(await readFile(file, "utf8")).refresh_token).toBe("new");
  });

  it("falls back to the device flow without a refresh token", async () => {
    const file = await tokenFile();
    let polls = 0;
    const fetchFn = (async (url: URL | string) => {
      if (url.toString().endsWith("/device_authorize")) {
        return json({
          device_code: "dev",
          user_code: "CODE",
          verification_uri: "https://login.tado.com/oauth2/device",
          verification_uri_complete: "https://login.tado.com/oauth2/device?user_code=CODE",
          expires_in: 300,
          interval: 5,
        });
      }
      polls++;
      return polls < 2
        ? json({ error: "authorization_pending" }, 400)
        : json({ access_token: "access", refresh_token: "r1", expires_in: 600 });
    }) as typeof fetch;

    const auth = new TadoAuth(file, undefined, fetchFn, async () => {});
    expect(await auth.getAccessToken()).toBe("access");
    expect(polls).toBe(2);
    expect(JSON.parse(await readFile(file, "utf8")).refresh_token).toBe("r1");
  });
});

describe("TadoClient", () => {
  it("posts an Energy IQ reading to the first home", async () => {
    const requests: Array<{ url: string; method?: string; body?: string; auth: string | null }> = [];
    const fetchFn = (async (url: URL | string, init: RequestInit = {}) => {
      requests.push({
        url: url.toString(),
        method: init.method,
        body: init.body as string,
        auth: new Headers(init.headers).get("authorization"),
      });
      if (url.toString().endsWith("/me")) return json({ homes: [{ id: 42, name: "Maison" }] });
      return json({});
    }) as typeof fetch;
    const auth = { getAccessToken: async () => "access" } as TadoAuth;

    await new TadoClient(auth, undefined, fetchFn).addMeterReading("2026-10-20", 1004);

    const post = requests.at(-1)!;
    expect(post.url).toBe("https://energy-insights.tado.com/api/homes/42/meterReadings");
    expect(post.method).toBe("POST");
    expect(JSON.parse(post.body!)).toEqual({ date: "2026-10-20", reading: 1004 });
    expect(post.auth).toBe("Bearer access");
  });
});
