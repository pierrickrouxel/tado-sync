import { describe, expect, it } from "vitest";
import { GrdfClient, toMeterIndexes, type GrdfReleve } from "../src/grdf.js";

const releve = (journeeGaziere: string, indexFin: number | null): GrdfReleve => ({
  journeeGaziere,
  indexDebut: null,
  indexFin,
  volumeBrutConsomme: null,
  energieConsomme: null,
});

describe("toMeterIndexes", () => {
  it("ignore les jours sans index et trie par date", () => {
    expect(toMeterIndexes([releve("2026-10-21", 12), releve("2026-10-20", 10), releve("2026-10-22", null)])).toEqual([
      { date: "2026-10-20", index: 10 },
      { date: "2026-10-21", index: 12 },
    ]);
  });
});

describe("GrdfClient", () => {
  it("se connecte puis récupère les relevés du PCE", async () => {
    const calls: Array<{ url: string; method: string; cookie: string | null; body?: string }> = [];
    const json = (body: unknown, headers: Record<string, string> = {}) =>
      new Response(JSON.stringify(body), { status: 200, headers: { "content-type": "application/json", ...headers } });

    const fetchFn = (async (input: URL | string, init: RequestInit = {}) => {
      const url = input.toString();
      const headers = new Headers(init.headers);
      calls.push({ url, method: init.method ?? "GET", cookie: headers.get("cookie"), body: init.body as string });
      if (url === "https://monespace.grdf.fr/") {
        return new Response(null, { status: 302, headers: { location: "https://connexion.grdf.fr/login" } });
      }
      if (url === "https://connexion.grdf.fr/login") {
        return new Response(`<script>var x = {"stateToken":"abc\\x2Ddef"};</script>`, {
          status: 200,
          headers: { "set-cookie": "DT=1; Path=/; Domain=.grdf.fr" },
        });
      }
      if (url.endsWith("/idp/idx/identify")) return json({ stateHandle: "handle" });
      if (url.endsWith("/idp/idx/challenge/answer")) return json({ success: { href: "https://monespace.grdf.fr/cb" } });
      if (url === "https://monespace.grdf.fr/cb") {
        return new Response("ok", { status: 200, headers: { "set-cookie": "auth_token=tok; Path=/" } });
      }
      if (url.includes("/consommation/informatives")) {
        return json({ "123": { releves: [releve("2026-10-20", 1003.5)] } });
      }
      return new Response("not found", { status: 404 });
    }) as typeof fetch;

    const client = new GrdfClient("me@example.com", "secret", "123", fetchFn);
    const indexes = await client.getMeterIndexes("2026-10-16", "2026-10-23");

    expect(indexes).toEqual([{ date: "2026-10-20", index: 1003.5 }]);
    const identify = calls.find((call) => call.url.endsWith("/identify"))!;
    expect(JSON.parse(identify.body!)).toEqual({ identifier: "me@example.com", stateHandle: "abc-def" });
    expect(identify.cookie).toContain("ln=me@example.com");
    expect(identify.cookie).toContain("DT=1");
    const data = calls.find((call) => call.url.includes("/informatives"))!;
    expect(data.cookie).toContain("auth_token=tok");
    expect(new URL(data.url).searchParams.get("pceList[]")).toBe("123");
  });
});
