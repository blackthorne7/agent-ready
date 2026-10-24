import { lookup } from "node:dns/promises";
import { isIP } from "node:net";
import type { Fetched } from "./types";

export const USER_AGENT =
  "Mozilla/5.0 (compatible; AgentReady/1.0; +https://github.com/leoi137/agent-ready)";

const TIMEOUT_MS = 8000;
const MAX_BYTES = 2_000_000;
const MAX_REDIRECTS = 5;

function isPrivateAddress(ip: string): boolean {
  if (isIP(ip) === 6) {
    const v = ip.toLowerCase();
    if (v === "::1" || v === "::") return true;
    if (v.startsWith("fc") || v.startsWith("fd") || v.startsWith("fe80")) return true;
    const mapped = v.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/);
    return mapped ? isPrivateAddress(mapped[1]) : false;
  }
  const [a, b] = ip.split(".").map(Number);
  return (
    a === 10 ||
    a === 127 ||
    a === 0 ||
    (a === 169 && b === 254) ||
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && b === 168) ||
    (a === 100 && b >= 64 && b <= 127)
  );
}

/** Reject non-http(s) URLs and hosts that resolve to private networks (SSRF guard). */
export async function assertPublicUrl(raw: string): Promise<URL> {
  const url = new URL(raw);
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new Error("Only http and https URLs can be audited");
  }
  const host = url.hostname.replace(/^\[|\]$/g, "");
  if (host === "localhost" || host.endsWith(".local") || host.endsWith(".internal")) {
    throw new Error("Private hosts cannot be audited");
  }
  const addrs = isIP(host) ? [{ address: host }] : await lookup(host, { all: true });
  if (addrs.some((a) => isPrivateAddress(a.address))) {
    throw new Error("Private hosts cannot be audited");
  }
  return url;
}

async function readCapped(res: Response): Promise<string> {
  if (!res.body) return "";
  const reader = res.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  while (total < MAX_BYTES) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value);
    total += value.byteLength;
  }
  reader.cancel().catch(() => {});
  return new TextDecoder().decode(Buffer.concat(chunks));
}

export async function safeFetch(raw: string): Promise<Fetched> {
  let current = raw;
  const redirects: string[] = [];
  const started = Date.now();
  try {
    for (let i = 0; i <= MAX_REDIRECTS; i++) {
      await assertPublicUrl(current);
      const res = await fetch(current, {
        redirect: "manual",
        headers: { "user-agent": USER_AGENT, accept: "text/html,application/json,text/plain,*/*" },
        signal: AbortSignal.timeout(TIMEOUT_MS),
      });
      const location = res.headers.get("location");
      if (res.status >= 300 && res.status < 400 && location) {
        redirects.push(current);
        current = new URL(location, current).toString();
        continue;
      }
      return {
        url: current,
        status: res.status,
        ok: res.ok,
        contentType: res.headers.get("content-type") ?? "",
        body: await readCapped(res),
        redirects,
        setCookies: res.headers.getSetCookie(),
        headers: Object.fromEntries(res.headers),
        elapsedMs: Date.now() - started,
      };
    }
    throw new Error("Too many redirects");
  } catch (err) {
    return {
      url: current,
      status: 0,
      ok: false,
      contentType: "",
      body: "",
      redirects,
      setCookies: [],
      elapsedMs: Date.now() - started,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}
