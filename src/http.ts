interface Cookie {
  name: string;
  value: string;
  domain: string;
  hostOnly: boolean;
}

/** Minimal cookie handling, enough to follow the GRDF login redirect chain. */
export class CookieJar {
  private cookies = new Map<string, Cookie>();

  set(name: string, value: string, domain: string, hostOnly = true): void {
    const normalized = domain.replace(/^\./, "").toLowerCase();
    this.cookies.set(`${normalized};${name}`, { name, value, domain: normalized, hostOnly });
  }

  store(url: URL, setCookieHeaders: string[]): void {
    for (const header of setCookieHeaders) {
      const [pair = "", ...attributes] = header.split(";");
      const index = pair.indexOf("=");
      if (index <= 0) continue;
      const name = pair.slice(0, index).trim();
      const value = pair.slice(index + 1).trim();
      let domain = url.hostname;
      let hostOnly = true;
      let expired = false;
      for (const attribute of attributes) {
        const [key = "", attrValue = ""] = attribute.split("=").map((part) => part.trim());
        if (key.toLowerCase() === "domain" && attrValue) {
          domain = attrValue;
          hostOnly = false;
        } else if (key.toLowerCase() === "max-age" && Number(attrValue) <= 0) {
          expired = true;
        } else if (key.toLowerCase() === "expires" && Date.parse(attrValue) < Date.now()) {
          expired = true;
        }
      }
      if (expired) {
        this.cookies.delete(`${domain.replace(/^\./, "").toLowerCase()};${name}`);
      } else {
        this.set(name, value, domain, hostOnly);
      }
    }
  }

  header(url: URL): string | undefined {
    const host = url.hostname.toLowerCase();
    const values = [...this.cookies.values()]
      .filter((cookie) => (cookie.hostOnly ? host === cookie.domain : host === cookie.domain || host.endsWith(`.${cookie.domain}`)))
      .map((cookie) => `${cookie.name}=${cookie.value}`);
    return values.length > 0 ? values.join("; ") : undefined;
  }
}

export type FetchFn = typeof fetch;

/** `fetch` that follows redirects manually to keep the cookies set at every hop. */
export async function fetchWithCookies(
  jar: CookieJar,
  input: string,
  init: RequestInit = {},
  fetchFn: FetchFn = fetch,
  maxRedirects = 20,
): Promise<Response> {
  let url = new URL(input);
  let options: RequestInit = { ...init };
  for (let hop = 0; hop <= maxRedirects; hop++) {
    const headers = new Headers(options.headers);
    const cookie = jar.header(url);
    if (cookie) headers.set("Cookie", cookie);
    const response = await fetchFn(url, { ...options, headers, redirect: "manual" });
    jar.store(url, response.headers.getSetCookie());
    const location = response.headers.get("location");
    if (response.status < 300 || response.status >= 400 || !location) return response;
    url = new URL(location, url);
    if (response.status !== 307 && response.status !== 308) {
      options = { ...options, method: "GET", body: undefined };
      const next = new Headers(options.headers);
      next.delete("Content-Type");
      options.headers = next;
    }
  }
  throw new Error(`Too many redirects while following ${input}`);
}
