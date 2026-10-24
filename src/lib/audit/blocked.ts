// What a blocked report can still say honestly: which bot protection turned us away, how the owner
// lets AI assistants (and our checker) in, and what agents can read anyway. Blocked sites get no
// score (docs/one-final-score.md), and we never try to get around the block.

import { botChallenge, robotsBlockedAgents } from "./checks";
import type { Fetched } from "./types";

export type Blocker = "cloudflare" | "akamai" | "datadome" | "human" | "imperva" | "aws" | "vercel" | "sucuri";

/** Whether a file agents look for could be read, given the site blocks automated visitors. */
export type FileAccess = "found" | "missing" | "blocked";

export interface BlockedAccess {
  /** What the homepage returned, e.g. "HTTP 403" or "bot challenge page (HTTP 200)". */
  reason: string;
  /** The bot protection that blocked us, when we can tell. */
  blocker: Blocker | null;
  robots: FileAccess;
  /** AI agents robots.txt shuts out, when robots.txt could be read. */
  robotsBlocks: string[];
  llmsTxt: FileAccess;
  sitemap: FileAccess;
}

/** Every User-Agent we send contains this, so one allow rule covers the checklist and the AI agent. */
export const CHECKER_UA_TOKEN = "AgentReady";

export const BLOCKER_NAMES: Record<Blocker, string> = {
  cloudflare: "Cloudflare",
  akamai: "Akamai",
  datadome: "DataDome",
  human: "HUMAN (PerimeterX)",
  imperva: "Imperva",
  aws: "AWS WAF",
  vercel: "Vercel Firewall",
  sucuri: "Sucuri",
};

const allowChecker = `allow requests whose user agent contains "${CHECKER_UA_TOKEN}"`;

/** How to let AI assistants in, per bot protection, for whoever runs the site. */
export const UNBLOCK_STEPS: Record<Blocker | "unknown", string[]> = {
  cloudflare: [
    "In your Cloudflare dashboard, open the bot settings. Bot Fight Mode can't be bypassed with a rule, so turn it off while you check.",
    'Check the AI bot settings ("Block AI bots" and AI Crawl Control) and allow the AI assistants you want, such as ChatGPT-User, Claude-User and PerplexityBot.',
    `To let our checker in, add a WAF custom rule: when the user agent contains "${CHECKER_UA_TOKEN}", Skip the remaining custom rules and Super Bot Fight Mode.`,
  ],
  akamai: [
    "In Akamai Bot Manager, set the AI assistant and AI search bot categories you want to Allow instead of Deny or Challenge.",
    `To let our checker in, add a custom bot or exception that ${allowChecker}.`,
  ],
  datadome: [
    "In the DataDome dashboard, allow the AI assistant (LLM) bot categories you want instead of blocking them.",
    `To let our checker in, add a custom rule that ${allowChecker}.`,
  ],
  human: [
    "In the HUMAN (PerimeterX) console, allow the AI assistant bots you want instead of blocking them.",
    `To let our checker in, add an allow rule for requests whose user agent contains "${CHECKER_UA_TOKEN}".`,
  ],
  imperva: [
    "In Imperva's bot protection settings, allow good bots, including the AI assistants you want.",
    `To let our checker in, add a security rule exception that ${allowChecker}.`,
  ],
  aws: [
    "In your AWS WAF web ACL, check the Bot Control rule group: its AI and HTTP-library categories may be set to block.",
    `To let our checker in, add a higher-priority rule that ${allowChecker}.`,
  ],
  vercel: [
    "In your Vercel project's Firewall, check the bot protection and AI bots rules; set them to log instead of deny for the assistants you want.",
    `To let our checker in, add a custom rule that bypasses the firewall when the user agent contains "${CHECKER_UA_TOKEN}".`,
  ],
  sucuri: [
    "In the Sucuri firewall settings, allow the AI assistants you want, or lower the bot blocking level.",
    `To let our checker in, allowlist requests whose user agent contains "${CHECKER_UA_TOKEN}".`,
  ],
  unknown: [
    "Something in front of your site (your host, a CDN, or a security plugin such as Wordfence) is turning away automated visitors. Whoever runs your website can find it in the firewall or bot protection settings.",
    "Ask them to allow the AI assistants you want, such as ChatGPT-User, Claude-User and PerplexityBot.",
    `To let our checker in, ask them to ${allowChecker}.`,
  ],
};

/** Names the bot protection from the blocked response's headers, cookies and body. */
export function detectBlocker(page: Fetched): Blocker | null {
  const h = page.headers ?? {};
  const server = (h.server ?? "").toLowerCase();
  const cookies = page.setCookies.join("; ").toLowerCase();
  const body = page.body.toLowerCase();
  // Bot-management vendors first: they often sit behind a CDN (e.g. DataDome on Cloudflare).
  if (h["x-datadome"] || /\bdatadome=/.test(cookies) || body.includes("captcha-delivery.com")) return "datadome";
  if (/\b_px\w*=/.test(cookies) || /px-captcha|perimeterx/.test(body)) return "human";
  if (h["x-iinfo"] || /incap_ses_|visid_incap_/.test(cookies) || body.includes("incapsula")) return "imperva";
  if (h["x-amzn-waf-action"] || cookies.includes("aws-waf-token") || body.includes("awswaf")) return "aws";
  if (h["x-vercel-mitigated"] || body.includes("vercel security checkpoint")) return "vercel";
  if (h["x-sucuri-id"] || server.includes("sucuri")) return "sucuri";
  if (h["cf-ray"] || h["cf-mitigated"] || server.includes("cloudflare")) return "cloudflare";
  if (server.includes("akamaighost") || /\b(_abck|bm_sz)=/.test(cookies) || body.includes("errors.edgesuite.net")) return "akamai";
  return null;
}

function fileAccess(res: Fetched, looksRight: (res: Fetched) => boolean): FileAccess {
  if (botChallenge(res) != null) return "blocked";
  return res.ok && looksRight(res) ? "found" : "missing";
}

const plainText = (res: Fetched) => !/html/i.test(res.contentType) && res.body.trim().length > 0;

/** Describes a block for the report. `fetchPath` is the audit's cached fetch, so files are fetched once. */
export async function describeBlock(page: Fetched, fetchPath: (path: string) => Promise<Fetched>): Promise<BlockedAccess> {
  const [robots, llms, sitemap] = await Promise.all(["/robots.txt", "/llms.txt", "/sitemap.xml"].map(fetchPath));
  const robotsAccess = fileAccess(robots, plainText);
  return {
    reason: botChallenge(page) ?? `HTTP ${page.status}`,
    blocker: detectBlocker(page),
    robots: robotsAccess,
    robotsBlocks: robotsAccess === "found" ? robotsBlockedAgents(robots.body) : [],
    llmsTxt: fileAccess(llms, plainText),
    sitemap:
      robotsAccess === "found" && /^sitemap:/im.test(robots.body)
        ? "found"
        : fileAccess(sitemap, (r) => /<(urlset|sitemapindex)/i.test(r.body)),
  };
}
