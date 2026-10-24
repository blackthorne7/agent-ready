import type { CheerioAPI } from "cheerio";
import type { AuditContext, Check, Diagnostic, Fetched, Outcome, Rating, TaskRun } from "./types";

// Every item in evals/AGENT_CHECKS.md has an entry here. Checks without a
// run() need a real browser (Playwright) and are reported as unknown, which
// lowers coverage but never the score.

/** A parsed node, as accepted by $() and $.html(). */
type Node = Parameters<CheerioAPI["html"]>[0];

const AI_AGENTS = [
  "ClaudeBot",
  "Claude-User",
  "Claude-SearchBot",
  "GPTBot",
  "ChatGPT-User",
  "OAI-SearchBot",
  "PerplexityBot",
  "Google-Extended",
];

/** Every JSON-LD node on the page, including nested and @graph children. */
export function allNodes(ctx: AuditContext): Record<string, unknown>[] {
  const out: Record<string, unknown>[] = [];
  const walk = (v: unknown) => {
    if (Array.isArray(v)) v.forEach(walk);
    else if (v && typeof v === "object") {
      out.push(v as Record<string, unknown>);
      Object.values(v).forEach(walk);
    }
  };
  walk(ctx.jsonLd);
  return out;
}

export function typesOf(node: Record<string, unknown>): string[] {
  const t = node["@type"];
  return (Array.isArray(t) ? t : [t]).filter((x): x is string => typeof x === "string");
}

function findTyped(ctx: AuditContext, match: (type: string) => boolean) {
  return allNodes(ctx).filter((n) => typesOf(n).some(match));
}

const LOCAL_BUSINESS =
  /^(LocalBusiness|Restaurant|FoodEstablishment|CafeOrCoffeeShop|Bakery|BarOrPub|FastFoodRestaurant|Store|Organization|Corporation|Hotel|LodgingBusiness|MedicalBusiness|ProfessionalService|HealthAndBeautyBusiness|AutomotiveBusiness)$/;

/** Parse robots.txt into user-agent groups of disallow rules. */
function parseRobots(txt: string): Map<string, string[]> {
  const groups = new Map<string, string[]>();
  let agents: string[] = [];
  let lastWasAgent = false;
  for (const raw of txt.split(/\r?\n/)) {
    const line = raw.replace(/#.*/, "").trim();
    const m = line.match(/^([\w-]+)\s*:\s*(.*)$/);
    if (!m) continue;
    const key = m[1].toLowerCase();
    const value = m[2].trim();
    if (key === "user-agent") {
      if (!lastWasAgent) agents = [];
      agents.push(value.toLowerCase());
      if (!groups.has(value.toLowerCase())) groups.set(value.toLowerCase(), []);
      lastWasAgent = true;
    } else {
      lastWasAgent = false;
      if (key === "disallow") agents.forEach((a) => groups.get(a)!.push(value));
      if (key === "allow" && value === "/") agents.forEach((a) => groups.get(a)!.push("!allow-root"));
    }
  }
  return groups;
}

function blocksRoot(rules: string[] | undefined): boolean {
  if (!rules) return false;
  return rules.includes("/") && !rules.includes("!allow-root");
}

/** Map a 0..1 share of "good" items onto the 0-4 rating scale. */
function fromRatio(r: number): Rating {
  if (r >= 0.95) return 4;
  if (r >= 0.8) return 3;
  if (r >= 0.5) return 2;
  if (r > 0) return 1;
  return 0;
}

/** Short, single-line HTML snippet for evidence. */
function snippet($: CheerioAPI, el: Node): string {
  const html = ($.html(el) ?? "").replace(/\s+/g, " ").trim();
  return html.length > 160 ? `${html.slice(0, 157)}...` : html;
}

function visibleText(e: { text(): string }): string {
  return e.text().replace(/\s+/g, " ").trim();
}

/** Accessible name from the attributes and content a static parser can see. */
function accessibleName($: CheerioAPI, el: Node): string {
  const e = $(el);
  const labelledBy = e.attr("aria-labelledby");
  const fromIds = labelledBy
    ? labelledBy
        .split(/\s+/)
        .map((id) => visibleText($(`[id="${id}"]`)))
        .join(" ")
        .trim()
    : "";
  return (
    e.attr("aria-label")?.trim() ||
    fromIds ||
    visibleText(e) ||
    e.find("img[alt]").first().attr("alt")?.trim() ||
    e.attr("value")?.trim() ||
    e.attr("title")?.trim() ||
    ""
  );
}

function fieldInputs($: CheerioAPI) {
  return $("input, select, textarea").filter(
    (_, el) => !["hidden", "submit", "button", "image", "reset"].includes(($(el).attr("type") ?? "").toLowerCase()),
  );
}

function internalLinks(ctx: AuditContext): { el: Node; href: URL }[] {
  const out: { el: Node; href: URL }[] = [];
  ctx.$("a[href]").each((_, el) => {
    const raw = ctx.$(el).attr("href")!;
    if (/^(javascript|mailto|tel):/i.test(raw)) return;
    try {
      const href = new URL(raw, ctx.url);
      if (href.origin === ctx.url.origin) out.push({ el, href });
    } catch {
      // Skip unparseable hrefs.
    }
  });
  return out;
}

/** A bot-protection or "are you human" interstitial instead of the real page. */
export function botChallenge(page: Fetched): string | null {
  const html = page.body.toLowerCase();
  if (page.status === 403) return "HTTP 403";
  if (page.status === 429) return "HTTP 429 rate limit";
  if (/(cf-challenge|challenge-platform|px-captcha|datadome|verify (that )?you('|’)?re not a robot|verify you are (a )?human|checking (if the site connection is secure|your browser)|enable javascript and cookies to continue|<title>just a moment)/.test(html)) {
    return `bot challenge page (HTTP ${page.status})`;
  }
  if ([503].includes(page.status) && /(attention required|access denied)/.test(html)) return `HTTP ${page.status} access denied`;
  return null;
}

const LOGIN_PATH = /\/(log-?in|sign-?in|auth|sso)(\/|$|\?)/i;

function hitLoginWall(ctx: AuditContext): boolean {
  const requested = [...ctx.page.redirects, ctx.page.url][0];
  return ctx.page.status === 401 || (LOGIN_PATH.test(new URL(ctx.page.url).pathname) && !LOGIN_PATH.test(new URL(requested).pathname));
}

/** Runs that say something about the site (blocked/error runs are about access or our harness). */
function scoredRuns(tasks: TaskRun[], match: (t: TaskRun) => boolean = () => true) {
  return tasks.filter((t) => match(t) && (t.status === "success" || t.status === "failed"));
}

function taskEvidence(runs: TaskRun[]): string[] {
  return runs.map((t) => `${t.taskId}: ${t.status} in ${t.steps}/${t.maxSteps} steps (${t.reason})`);
}

function successRateOutcome(runs: TaskRun[], none: string): Outcome {
  if (runs.length === 0) return { rating: "unknown", detail: none };
  const ok = runs.filter((t) => t.status === "success").length;
  const rate = ok / runs.length;
  const rating: Rating = rate === 1 ? 4 : rate >= 0.75 ? 3 : rate >= 0.5 ? 2 : rate > 0 ? 1 : 0;
  return {
    rating,
    detail: `${ok} of ${runs.length} agent task runs succeeded.`,
    fix: rate < 1 ? "See each failed run's reason for where the agent got stuck." : undefined,
    evidence: taskEvidence(runs),
  };
}

const INJECTION =
  /(ignore (all |any )?(the )?(previous|prior|above|earlier) (instructions|prompts|directions)|disregard (all |the |your )?(previous|prior|above) |you are (now )?(an? )?(ai|llm|large language model|language model)\b|\b(ai|llm) (agents?|assistants?|models?)[,:]? (must|should|please|are instructed)|system prompt|new instructions:|do not (tell|inform|alert) the user)/i;

export const checks: Check[] = [
  // ---------- A. Can the agent find and read the content? ----------
  {
    id: "meta",
    category: "A",
    title: "Title, description and language",
    weight: 2,
    method: "code",
    async run(ctx) {
      const $ = ctx.$;
      const fields = {
        title: !!$("title").text().trim(),
        description: !!$('meta[name="description"]').attr("content"),
        "og:title": !!$('meta[property="og:title"]').attr("content"),
        lang: !!$("html").attr("lang"),
      };
      const missing = Object.entries(fields).filter(([, v]) => !v).map(([k]) => k);
      return {
        rating: fromRatio(1 - missing.length / 4),
        detail: missing.length ? `Missing: ${missing.join(", ")}.` : "Title, description, Open Graph and lang are set.",
        fix: missing.length ? `Add ${missing.join(", ")} to the <head>.` : undefined,
      };
    },
  },
  {
    id: "heading-order",
    category: "A",
    title: "Headings are in a logical order",
    weight: 2,
    method: "code",
    async run(ctx) {
      const $ = ctx.$;
      const levels = $("h1, h2, h3, h4, h5, h6")
        .toArray()
        .map((el) => Number(el.tagName[1]));
      if (levels.length === 0) {
        return { rating: 0, detail: "No headings, so agents can't see how the page is organized.", fix: "Mark up section titles as <h1>-<h6>." };
      }
      const h1s = levels.filter((l) => l === 1).length;
      // Compare each heading to the one before it, starting from an implied h1.
      const skips = levels.filter((l, i) => l > (i === 0 ? 1 : levels[i - 1]) + 1).length;
      const issues = (h1s === 1 ? 0 : 1) + skips;
      const rating: Rating = issues === 0 ? 4 : issues === 1 ? 3 : issues <= 3 ? 2 : 1;
      return {
        rating,
        detail: issues
          ? `${h1s} <h1> element${h1s === 1 ? "" : "s"} and ${skips} skipped heading level${skips === 1 ? "" : "s"}.`
          : `One <h1> and ${levels.length} headings in order.`,
        fix: issues ? "Use exactly one <h1> and don't skip levels (h2 → h4)." : undefined,
        evidence: [`Heading sequence: ${levels.slice(0, 30).map((l) => `h${l}`).join(" ")}`],
      };
    },
  },
  {
    id: "structured-data",
    category: "A",
    title: "Structured data (schema.org JSON-LD)",
    weight: 3,
    method: "code",
    async run(ctx) {
      const types = [...new Set(allNodes(ctx).flatMap(typesOf))];
      if (types.length === 0) {
        return {
          rating: 0,
          detail: "No JSON-LD structured data. Agents have to guess at facts like hours, prices and location from prose.",
          fix: "Run the generate_fixes tool for a JSON-LD starter for this page.",
        };
      }
      return { rating: 4, detail: `Found schema.org types: ${types.slice(0, 12).join(", ")}.` };
    },
  },
  {
    id: "robots-ai-agents",
    category: "A",
    title: "AI agents allowed in robots.txt",
    weight: 3,
    method: "code",
    async run(ctx) {
      const res = await ctx.fetchPath("/robots.txt");
      if (!res.ok || /html/i.test(res.contentType)) {
        return {
          rating: 3,
          detail: "No robots.txt found. Agents are allowed by default, but you aren't stating a policy.",
          fix: `User-agent: *\nAllow: /\n\nSitemap: ${ctx.url.origin}/sitemap.xml`,
        };
      }
      const groups = parseRobots(res.body);
      const wildcardBlocked = blocksRoot(groups.get("*"));
      const blocked = AI_AGENTS.filter((a) => {
        const rules = groups.get(a.toLowerCase());
        return rules ? blocksRoot(rules) : wildcardBlocked;
      });
      if (blocked.length === 0) {
        return { rating: 4, detail: "robots.txt lets all major AI agents in." };
      }
      return {
        rating: fromRatio(1 - blocked.length / AI_AGENTS.length),
        detail: `robots.txt blocks: ${blocked.join(", ")}.`,
        fix: blocked.map((a) => `User-agent: ${a}\nAllow: /`).join("\n\n"),
      };
    },
  },
  {
    id: "sitemap",
    category: "A",
    title: "Sitemap available",
    weight: 1,
    method: "code",
    async run(ctx) {
      const robots = await ctx.fetchPath("/robots.txt");
      if (robots.ok && /^sitemap:/im.test(robots.body)) {
        return { rating: 4, detail: "Sitemap is declared in robots.txt." };
      }
      const res = await ctx.fetchPath("/sitemap.xml");
      if (res.ok && /<(urlset|sitemapindex)/i.test(res.body)) {
        return { rating: 4, detail: "/sitemap.xml found." };
      }
      return {
        rating: 0,
        detail: "No sitemap found, so agents have to guess which pages exist.",
        fix: `Publish /sitemap.xml and add \`Sitemap: ${ctx.url.origin}/sitemap.xml\` to robots.txt.`,
      };
    },
  },
  {
    id: "llms-txt",
    category: "A",
    title: "llms.txt published",
    weight: 1,
    method: "code",
    async run(ctx) {
      const res = await ctx.fetchPath("/llms.txt");
      if (res.ok && !/html/i.test(res.contentType) && res.body.trim().length > 0) {
        return { rating: 4, detail: "/llms.txt gives agents a concise map of the site." };
      }
      // Bonus signal, not a requirement, so missing is partial rather than failing.
      return {
        rating: 2,
        detail: "No /llms.txt. It's an emerging convention that gives LLMs a short, curated guide to your site.",
        fix: "Run the generate_fixes tool to draft an llms.txt from this page.",
      };
    },
  },
  {
    id: "feeds",
    category: "A",
    title: "RSS/Atom feed where it makes sense",
    weight: 1,
    method: "code",
    async run(ctx) {
      const feeds = ctx.$('link[rel="alternate"][type*="rss"], link[rel="alternate"][type*="atom"]');
      if (feeds.length) return { rating: 4, detail: `${feeds.length} feed${feeds.length === 1 ? "" : "s"} advertised in <head>.` };
      // Feeds only matter for news/blog sites; without site-category detection we can't tell if one is expected.
      return { rating: "unknown", detail: "No feed advertised. Whether one is expected depends on the site type, which isn't detected yet." };
    },
  },
  {
    id: "server-rendered",
    category: "A",
    title: "Content readable without JavaScript",
    weight: 3,
    method: "code",
    async run(ctx) {
      const $ = ctx.$;
      const clone = $.root().clone();
      clone.find("script, style, noscript, svg, template").remove();
      const text = clone.text().replace(/\s+/g, " ").trim();
      if (text.length >= 500) {
        return { rating: 4, detail: `${text.length.toLocaleString()} characters of text in the raw HTML.` };
      }
      return {
        rating: text.length >= 150 ? 2 : 0,
        detail: `Only ${text.length} characters of text without JavaScript. Many agents don't run JS and will see an empty page.`,
        fix: "Server-render (SSR/SSG) key content: hours, menu, products, prices, contact details.",
      };
    },
  },
  {
    id: "nav-real-links",
    category: "A",
    title: "Navigation links are real, followable links",
    weight: 2,
    method: "code",
    async run(ctx) {
      const $ = ctx.$;
      const nav = $("nav, header, [role=navigation]");
      if (nav.length === 0) {
        return { rating: 2, detail: "No <nav>, <header> or role=navigation region, so the main navigation is hard to pick out.", fix: "Wrap the main menu in a <nav> element." };
      }
      const clickable = nav.find("a, button, [onclick], [role=link]");
      const fake = clickable.filter((_, el) => {
        const href = $(el).attr("href");
        return el.tagName !== "button" && (!href || href === "#" || /^javascript:/i.test(href));
      });
      if (clickable.length === 0) return { rating: 1, detail: "The navigation region contains no links." };
      return {
        rating: fromRatio(1 - fake.length / clickable.length),
        detail: fake.length
          ? `${fake.length} of ${clickable.length} navigation items have no real href, so an agent can't follow them without running JavaScript.`
          : `All ${clickable.length} navigation items are real links or buttons.`,
        fix: fake.length ? "Use <a href=\"/path\"> for navigation instead of click handlers." : undefined,
        evidence: fake.toArray().slice(0, 5).map((el) => snippet($, el)),
      };
    },
  },
  {
    id: "business-info",
    category: "A",
    title: "Business identity, location and hours",
    weight: 2,
    method: "code",
    async run(ctx) {
      const biz = findTyped(ctx, (t) => LOCAL_BUSINESS.test(t));
      if (biz.length === 0) {
        return {
          rating: 0,
          detail: "No Organization/LocalBusiness entity, so an agent can't confirm who you are, where you are, or when you're open.",
          fix: "Add LocalBusiness (or Restaurant, Store, …) JSON-LD with name, address, telephone and openingHoursSpecification.",
        };
      }
      const has = (k: string) => biz.some((b) => b[k] != null);
      const fields = {
        name: has("name"),
        address: has("address") || has("location"),
        telephone: has("telephone") || has("contactPoint"),
        hours: has("openingHoursSpecification") || has("openingHours"),
        url: has("url"),
      };
      const present = Object.values(fields).filter(Boolean).length;
      const missing = Object.entries(fields).filter(([, v]) => !v).map(([k]) => k);
      return {
        rating: fromRatio(present / 5),
        detail: missing.length ? `Business entity is missing: ${missing.join(", ")}.` : "Name, address, phone, hours and URL are all machine-readable.",
        fix: missing.length ? `Add ${missing.join(", ")} to your ${typesOf(biz[0])[0]} JSON-LD.` : undefined,
      };
    },
  },
  {
    id: "offerings",
    category: "A",
    title: "Menu, products or services described",
    weight: 2,
    method: "code",
    async run(ctx) {
      const offers = findTyped(ctx, (t) => /^(Menu|MenuItem|MenuSection|Product|Offer|AggregateOffer|Service|Event|ItemList)$/.test(t));
      const hasMenuLink = allNodes(ctx).some((n) => n.hasMenu != null || n.menu != null);
      if (offers.length || hasMenuLink) {
        return { rating: 4, detail: `${offers.length || 1} offering entities (menu/products/services) are machine-readable.` };
      }
      return {
        rating: 0,
        detail: "Nothing you sell is described in structured data, so an agent can't answer \"what's on the menu?\" or \"how much is X?\" reliably.",
        fix: "Describe items with Menu/MenuItem (restaurants), Product/Offer (shops) or Service, including prices.",
      };
    },
  },
  {
    id: "contact",
    category: "A",
    title: "Contact details are machine-readable",
    weight: 1,
    method: "code",
    async run(ctx) {
      const $ = ctx.$;
      const tel = $('a[href^="tel:"]').length;
      const mail = $('a[href^="mailto:"]').length;
      const ld = allNodes(ctx).some((n) => n.telephone != null || n.email != null || n.contactPoint != null);
      if (ld || (tel && mail)) return { rating: 4, detail: "Phone/email exposed as links or structured data." };
      if (tel || mail) return { rating: 2, detail: `Only ${tel ? "phone" : "email"} is linked.`, fix: "Expose both tel: and mailto: links, or a contactPoint in JSON-LD." };
      return {
        rating: 0,
        detail: "No tel:, mailto: or contactPoint found on this page.",
        fix: "Add tel: and mailto: links, and a contactPoint in your Organization JSON-LD.",
      };
    },
  },

  // ---------- B. Can the agent understand the controls? ----------
  {
    id: "controls-named",
    category: "B",
    title: "Buttons and links have readable names",
    weight: 4,
    method: "code",
    async run(ctx) {
      const $ = ctx.$;
      const controls = $('a[href], button, [role=button], input[type=submit], input[type=button], input[type=image]');
      if (controls.length === 0) return { rating: "na", detail: "No links or buttons on this page." };
      const unnamed = controls.filter((_, el) => !accessibleName($, el) && !(el.tagName === "input" && $(el).attr("alt")));
      return {
        rating: fromRatio(1 - unnamed.length / controls.length),
        detail: unnamed.length
          ? `${unnamed.length} of ${controls.length} links/buttons have no readable name (often icon-only). Agents pick controls by name.`
          : `All ${controls.length} links and buttons have a readable name.`,
        fix: unnamed.length ? "Give icon-only links and buttons an aria-label." : undefined,
        evidence: unnamed.toArray().slice(0, 5).map((el) => snippet($, el)),
      };
    },
  },
  {
    id: "forms-labeled",
    category: "B",
    title: "Form fields have labels",
    weight: 4,
    method: "code",
    async run(ctx) {
      const $ = ctx.$;
      const inputs = fieldInputs($);
      if (inputs.length === 0) return { rating: "na", detail: "No form fields on this page." };
      const unlabeled = inputs.filter((_, el) => {
        const e = $(el);
        const id = e.attr("id");
        return !(
          e.attr("aria-label") ||
          e.attr("aria-labelledby") ||
          e.attr("title") ||
          (id && $(`label[for="${id}"]`).length) ||
          e.closest("label").length
        );
      });
      return {
        rating: fromRatio(1 - unlabeled.length / inputs.length),
        detail: unlabeled.length
          ? `${unlabeled.length} of ${inputs.length} form fields have no label. Agents fill forms by these labels.`
          : `All ${inputs.length} form fields are labeled.`,
        fix: unlabeled.length ? "Give every input a <label for> or aria-label." : undefined,
        evidence: unlabeled.toArray().slice(0, 5).map((el) => snippet($, el)),
      };
    },
  },
  {
    id: "input-types",
    category: "B",
    title: "Form fields use the right input type",
    weight: 2,
    method: "code",
    async run(ctx) {
      const $ = ctx.$;
      const inputs = fieldInputs($);
      if (inputs.length === 0) return { rating: "na", detail: "No form fields on this page." };
      const expected: [RegExp, string][] = [
        [/e-?mail/i, "email"],
        [/phone|mobile|\btel\b/i, "tel"],
        [/\b(date|dob|birth)/i, "date"],
        [/website|\burl\b/i, "url"],
      ];
      const wrong: string[] = [];
      let hinted = 0;
      inputs.each((_, el) => {
        const e = $(el);
        if (el.tagName !== "input") return;
        const type = (e.attr("type") ?? "text").toLowerCase();
        const hint = [e.attr("name"), e.attr("id"), e.attr("placeholder"), e.attr("aria-label"), e.attr("autocomplete")].join(" ");
        const want = expected.find(([re]) => re.test(hint));
        if (!want) return;
        hinted++;
        if (type === "text") wrong.push(`${snippet($, el)} → expected type="${want[1]}"`);
      });
      if (hinted === 0) return { rating: 4, detail: "No fields where a specific input type was obviously expected." };
      return {
        rating: fromRatio(1 - wrong.length / hinted),
        detail: wrong.length ? `${wrong.length} of ${hinted} email/phone/date/URL fields are plain text inputs.` : `All ${hinted} email/phone/date/URL fields use a matching type.`,
        fix: wrong.length ? 'Use type="email", "tel", "date" or "url" so agents know what format to enter.' : undefined,
        evidence: wrong.slice(0, 5),
      };
    },
  },
  {
    id: "native-controls",
    category: "B",
    title: "Real buttons and links, not clickable <div>s",
    weight: 3,
    method: "code",
    async run(ctx) {
      const $ = ctx.$;
      const fake = $("div[onclick], span[onclick], li[onclick], img[onclick], td[onclick], div[role=button], span[role=button]");
      const native = $("a[href], button, input[type=submit], input[type=button]").length;
      const total = native + fake.length;
      if (total === 0) return { rating: "na", detail: "No interactive controls on this page." };
      return {
        rating: fromRatio(1 - fake.length / total),
        detail: fake.length
          ? `${fake.length} clickable non-button elements found. Click handlers attached by JavaScript can't be seen without a browser.`
          : "No inline clickable <div>/<span> elements. (Handlers attached by JavaScript need a browser to detect.)",
        fix: fake.length ? "Use <button> for actions and <a href> for navigation." : undefined,
        evidence: fake.toArray().slice(0, 5).map((el) => snippet($, el)),
      };
    },
  },
  {
    id: "aria-widget-states",
    category: "B",
    title: "Custom widgets expose roles and states",
    weight: 2,
    method: "code",
    async run(ctx) {
      const $ = ctx.$;
      const required: Record<string, string> = {
        tab: "aria-selected",
        combobox: "aria-expanded",
        checkbox: "aria-checked",
        switch: "aria-checked",
        radio: "aria-checked",
        menuitemcheckbox: "aria-checked",
        slider: "aria-valuenow",
      };
      const widgets = $(Object.keys(required).map((r) => `[role=${r}]`).join(", "));
      if (widgets.length === 0) {
        return { rating: "unknown", detail: "No ARIA widgets in the raw HTML. Custom widgets built by JavaScript need a browser to inspect." };
      }
      const missing = widgets.filter((_, el) => {
        const e = $(el);
        // Native inputs carry their own checked state.
        if (e.is("input")) return false;
        return e.attr(required[e.attr("role")!]) == null;
      });
      return {
        rating: fromRatio(1 - missing.length / widgets.length),
        detail: missing.length ? `${missing.length} of ${widgets.length} ARIA widgets are missing their state attribute.` : `All ${widgets.length} ARIA widgets expose their state.`,
        fix: missing.length ? "Add aria-selected / aria-expanded / aria-checked so agents know each widget's state." : undefined,
        evidence: missing.toArray().slice(0, 5).map((el) => snippet($, el)),
      };
    },
  },
  {
    id: "distinct-labels",
    category: "B",
    title: "Similar controls can be told apart",
    weight: 3,
    method: "code",
    async run(ctx) {
      const $ = ctx.$;
      const byText = new Map<string, Set<string>>();
      const links = internalLinks(ctx);
      for (const { el, href } of links) {
        const text = accessibleName($, el).toLowerCase();
        if (!text) continue;
        href.hash = "";
        if (!byText.has(text)) byText.set(text, new Set());
        byText.get(text)!.add(href.toString());
      }
      if (links.length === 0) return { rating: "na", detail: "No internal links on this page." };
      const ambiguous = [...byText].filter(([, hrefs]) => hrefs.size > 1);
      const affected = ambiguous.reduce((s, [, hrefs]) => s + hrefs.size, 0);
      return {
        rating: fromRatio(1 - affected / links.length),
        detail: ambiguous.length
          ? `${ambiguous.length} link label${ambiguous.length === 1 ? "" : "s"} point to different pages (${affected} links). An agent can't tell which is which.`
          : "Every link label points to one destination.",
        fix: ambiguous.length ? 'Make labels specific ("Pricing details" instead of "Learn more"), or add an aria-label.' : undefined,
        evidence: ambiguous.slice(0, 5).map(([text, hrefs]) => `"${text}" → ${hrefs.size} different pages`),
      };
    },
  },
  {
    id: "images-alt",
    category: "B",
    title: "Key content is text, not only images",
    weight: 2,
    method: "code",
    async run(ctx) {
      const $ = ctx.$;
      const imgs = $("img");
      const canvases = $("canvas").length;
      if (imgs.length === 0 && canvases === 0) return { rating: "na", detail: "No images or canvas on this page." };
      const noAlt = imgs.filter((_, el) => $(el).attr("alt") == null);
      const base = imgs.length ? fromRatio(1 - noAlt.length / imgs.length) : 4;
      const rating = (canvases ? Math.min(base, 2) : base) as Rating;
      return {
        rating,
        detail: [
          imgs.length ? `${noAlt.length} of ${imgs.length} images have no alt attribute.` : "",
          canvases ? `${canvases} <canvas> element${canvases === 1 ? "" : "s"}: anything drawn there is invisible to agents.` : "",
        ]
          .filter(Boolean)
          .join(" "),
        fix: noAlt.length || canvases ? 'Add alt text to meaningful images (alt="" for decorative ones) and keep key info out of <canvas>.' : undefined,
        evidence: noAlt.toArray().slice(0, 5).map((el) => snippet($, el)),
      };
    },
  },
  {
    id: "no-hidden-dom",
    category: "B",
    title: "Content isn't hidden in shadow DOM or cross-origin iframes",
    weight: 2,
    method: "code",
    async run(ctx) {
      const $ = ctx.$;
      const crossFrames = $("iframe[src]").filter((_, el) => {
        try {
          return new URL($(el).attr("src")!, ctx.url).origin !== ctx.url.origin;
        } catch {
          return false;
        }
      });
      const shadowRoots = $("template[shadowrootmode], template[shadowroot]").length;
      const customEls = new Set(
        $("*")
          .toArray()
          .map((el) => ("tagName" in el ? el.tagName : ""))
          .filter((t) => t.includes("-")),
      );
      let rating = 4;
      if (crossFrames.length) rating--;
      if (shadowRoots) rating--;
      if (customEls.size > 10) rating--;
      return {
        rating: rating as Rating,
        detail:
          `${crossFrames.length} cross-origin iframe${crossFrames.length === 1 ? "" : "s"}, ${shadowRoots} declarative shadow root${shadowRoots === 1 ? "" : "s"}, ` +
          `${customEls.size} custom element type${customEls.size === 1 ? "" : "s"}. Shadow roots created by JavaScript need a browser to detect.`,
        fix: rating < 4 ? "Keep key content and controls in the main document, not inside iframes or closed shadow roots." : undefined,
        evidence: [...crossFrames.toArray().slice(0, 3).map((el) => snippet($, el)), ...[...customEls].slice(0, 5).map((t) => `<${t}>`)],
      };
    },
  },
  {
    id: "consent-buttons-labeled",
    category: "B",
    group: "cookies",
    title: "Cookie banner's Accept/Reject/Preferences are labeled and findable",
    weight: 1,
    method: "browser",
  },

  // ---------- C. Can the agent actually complete tasks? ----------
  {
    id: "tasks-completed",
    category: "C",
    title: "Agent completes tasks correctly",
    weight: 6,
    method: "task",
    async run(ctx) {
      return successRateOutcome(scoredRuns(ctx.tasks), "No agent tasks were run (or every run was blocked/errored). Run `pnpm evaluate <url>` to include them.");
    },
  },
  {
    id: "search-works",
    category: "C",
    title: "Site search returns relevant results",
    weight: 2,
    method: "task",
    async run(ctx) {
      return successRateOutcome(scoredRuns(ctx.tasks, (t) => t.taskId.startsWith("search")), "No search task was run.");
    },
  },
  {
    id: "filters-work",
    category: "C",
    title: "Filters and sorting give correct results",
    weight: 2,
    method: "browser",
  },
  {
    id: "multistep-predictable",
    category: "C",
    title: "Multi-step flows behave predictably",
    weight: 2,
    method: "task",
    async run(ctx) {
      return successRateOutcome(scoredRuns(ctx.tasks, (t) => t.taskId.startsWith("multistep")), "No multi-step task was run.");
    },
  },
  {
    id: "outcome-detectable",
    category: "C",
    title: "Success and error messages can be detected",
    weight: 2,
    method: "browser",
  },
  {
    id: "recovery",
    category: "C",
    title: "Agent can recover after a wrong click or error",
    weight: 2,
    method: "browser",
  },
  {
    id: "state-across-pages",
    category: "C",
    group: "cookies",
    title: "State (cart, filters, input, language) is kept between pages",
    weight: 2,
    method: "browser",
  },
  {
    id: "repeatable",
    category: "C",
    title: "Same task gives the same result across runs",
    weight: 2,
    method: "task",
    async run(ctx) {
      const byTask = new Map<string, TaskRun[]>();
      for (const t of scoredRuns(ctx.tasks)) byTask.set(t.taskId, [...(byTask.get(t.taskId) ?? []), t]);
      const repeated = [...byTask].filter(([, runs]) => runs.length >= 2);
      if (repeated.length === 0) return { rating: "unknown", detail: "No task was run more than once. Use `--runs 2` or more." };
      const consistent = repeated.filter(([, runs]) => runs.every((r) => r.status === runs[0].status));
      return {
        rating: fromRatio(consistent.length / repeated.length),
        detail: `${consistent.length} of ${repeated.length} repeated tasks gave the same outcome every run.`,
        evidence: repeated.map(([id, runs]) => `${id}: ${runs.map((r) => r.status).join(", ")}`),
      };
    },
  },
  {
    id: "reject-cookies-usable",
    category: "C",
    group: "cookies",
    title: "Rejecting optional cookies still lets the agent use the site",
    weight: 1,
    method: "browser",
  },
  {
    id: "consent-remembered",
    category: "C",
    group: "cookies",
    title: "Cookie choice is remembered across pages",
    weight: 1,
    method: "browser",
  },
  {
    id: "no-login-redirect",
    category: "C",
    group: "cookies",
    title: "No unexpected redirect to a login page",
    weight: 1,
    method: "code",
    async run(ctx) {
      if (hitLoginWall(ctx)) {
        return {
          rating: 1,
          detail: `The page sent the agent to a login wall (${ctx.page.status === 401 ? "HTTP 401" : new URL(ctx.page.url).pathname}).`,
          fix: "Keep public information reachable without logging in.",
          evidence: [...ctx.page.redirects, ctx.page.url],
        };
      }
      return { rating: 4, detail: "The page loads without redirecting to a login." };
    },
  },
  {
    id: "return-after-login",
    category: "C",
    group: "cookies",
    title: "After login, the agent is returned to where it was",
    weight: 1,
    method: "browser",
  },
  {
    id: "session-timeout",
    category: "C",
    group: "cookies",
    title: "Session timeout doesn't silently wipe progress",
    weight: 1,
    method: "browser",
  },

  // ---------- D. Can the agent access it programmatically? ----------
  {
    id: "agent-protocols",
    category: "D",
    title: "Agent endpoint (MCP, A2A or OpenAPI)",
    weight: 4,
    method: "code",
    async run(ctx) {
      const candidates = [
        "/.well-known/mcp.json",
        "/.well-known/mcp",
        "/.well-known/agent-card.json",
        "/.well-known/agent.json",
        "/openapi.json",
        "/.well-known/openapi.json",
        "/.well-known/ai-plugin.json",
      ];
      const found: string[] = [];
      await Promise.all(
        candidates.map(async (p) => {
          const res = await ctx.fetchPath(p);
          if (res.ok && /json/i.test(res.contentType + res.body.slice(0, 1))) found.push(p);
        }),
      );
      const linked = ctx.$('link[rel="mcp"], link[rel="service-desc"], link[rel="api"]').length > 0;
      const webMcp = /navigator\.modelContext/.test(ctx.page.body);
      if (found.length || linked || webMcp) {
        const what = [...found, linked ? "<link> to API/MCP" : "", webMcp ? "WebMCP (navigator.modelContext)" : ""].filter(Boolean);
        return { rating: 4, detail: `Agents can act through: ${what.join(", ")}.` };
      }
      return {
        rating: 0,
        detail: "No MCP server, A2A agent card or OpenAPI spec found. Agents have to click through your UI to get anything done.",
        fix: "Expose your key actions (check availability, order, book, contact) as an MCP server and advertise it at /.well-known/mcp.json.",
      };
    },
  },
  {
    id: "actions",
    category: "D",
    title: "Actions declared (order, reserve, search)",
    weight: 2,
    method: "code",
    async run(ctx) {
      const actions = allNodes(ctx)
        .flatMap((n) => {
          const pa = n.potentialAction;
          return Array.isArray(pa) ? pa : pa ? [pa] : [];
        })
        .flatMap((a) => (a && typeof a === "object" ? typesOf(a as Record<string, unknown>) : []));
      const accepts = allNodes(ctx).some((n) => n.acceptsReservations != null);
      if (actions.length || accepts) {
        return { rating: 4, detail: `Declared actions: ${[...new Set(actions)].join(", ") || "acceptsReservations"}.` };
      }
      return {
        rating: 0,
        detail: "No potentialAction (OrderAction, ReserveAction, SearchAction) in structured data.",
        fix: "Add potentialAction entries pointing at your order/booking/search URLs.",
      };
    },
  },
  {
    id: "readable-urls",
    category: "D",
    title: "URLs are stable and readable",
    weight: 2,
    method: "code",
    async run(ctx) {
      const links = internalLinks(ctx);
      if (links.length === 0) return { rating: "unknown", detail: "No internal links to inspect." };
      const bad = links.filter(({ href }) => /(jsessionid|phpsessid|sessionid|[?&;]sid)=/i.test(href.toString()) || /[A-Za-z0-9_-]{32,}/.test(href.pathname));
      return {
        rating: fromRatio(1 - bad.length / links.length),
        detail: bad.length ? `${bad.length} of ${links.length} internal links contain session IDs or long random tokens.` : `All ${links.length} internal links have readable, stable paths.`,
        fix: bad.length ? "Keep session state in cookies, not URLs, and use readable slugs." : undefined,
        evidence: bad.slice(0, 5).map(({ href }) => href.toString()),
      };
    },
  },
  {
    id: "search-in-url",
    category: "D",
    title: "Search/filter state appears in the URL",
    weight: 2,
    method: "code",
    async run(ctx) {
      const $ = ctx.$;
      const forms = $("form").filter(
        (_, el) =>
          $(el).attr("role") === "search" ||
          $(el).find('input[type=search], input[name=q], input[name=query], input[name=s], input[name=search], input[name=keyword]').length > 0,
      );
      const searchAction = allNodes(ctx).some((n) => typesOf(n).includes("SearchAction"));
      if (forms.length === 0 && !searchAction) {
        return { rating: "unknown", detail: "No search form in the raw HTML. JavaScript-only search needs a browser to inspect." };
      }
      const post = forms.filter((_, el) => ($(el).attr("method") ?? "get").toLowerCase() === "post");
      if (post.length === forms.length && forms.length > 0) {
        return {
          rating: 1,
          detail: "Search submits with POST, so results can't be linked to or revisited by URL.",
          fix: 'Use <form method="get"> so searches produce URLs like /search?q=term.',
          evidence: post.toArray().slice(0, 2).map((el) => snippet($, el)),
        };
      }
      return { rating: 4, detail: searchAction ? "SearchAction declares a URL template for search." : "Search uses GET, so results have a linkable URL." };
    },
  },
  {
    id: "pagination",
    category: "D",
    title: "Pagination is predictable (not only infinite scroll)",
    weight: 1,
    method: "code",
    async run(ctx) {
      const $ = ctx.$;
      const paged = $('link[rel=next], a[rel=next], a[href*="page="], a[href*="/page/"]');
      if (paged.length) return { rating: 4, detail: "Pagination uses real links/URLs.", evidence: paged.toArray().slice(0, 3).map((el) => snippet($, el)) };
      return { rating: "unknown", detail: "No paginated links found. Either the page doesn't paginate or it uses infinite scroll (needs a browser to tell)." };
    },
  },
  {
    id: "login-clarity",
    category: "D",
    group: "cookies",
    title: "It's clear when login is required",
    weight: 1,
    method: "code",
    async run(ctx) {
      const $ = ctx.$;
      const login = $("a, button").filter((_, el) => /\b(log ?in|sign ?in|my account)\b/i.test(accessibleName($, el)));
      if (login.length || hitLoginWall(ctx)) return { rating: 4, detail: "Login entry point is clearly labeled." };
      return { rating: "unknown", detail: "No login link found. The site may not have accounts." };
    },
  },

  // ---------- E. Is it robust and efficient? ----------
  {
    id: "task-efficiency",
    category: "E",
    title: "Tasks don't need an excessive number of actions",
    weight: 3,
    method: "task",
    async run(ctx) {
      const ok = ctx.tasks.filter((t) => t.status === "success");
      if (ok.length === 0) return { rating: "unknown", detail: "No successful agent task runs to measure." };
      const share = ok.reduce((s, t) => s + t.steps / t.maxSteps, 0) / ok.length;
      const rating: Rating = share <= 0.4 ? 4 : share <= 0.6 ? 3 : share <= 0.8 ? 2 : 1;
      return {
        rating,
        detail: `Successful runs used on average ${Math.round(share * 100)}% of their step budget.`,
        evidence: taskEvidence(ok),
      };
    },
  },
  {
    id: "loading-detectable",
    category: "E",
    title: "Loading states are detectable",
    weight: 1,
    method: "browser",
  },
  {
    id: "layout-stable",
    category: "E",
    title: "Elements don't jump around while loading",
    weight: 1,
    method: "browser",
  },
  {
    id: "stable-selectors",
    category: "E",
    title: "Element IDs/classes are stable between loads",
    weight: 1,
    method: "code",
    async run(ctx) {
      const $ = ctx.$;
      const tokens = $("[class]")
        .toArray()
        .flatMap((el) => ($(el).attr("class") ?? "").split(/\s+/).filter(Boolean));
      if (tokens.length === 0) return { rating: "unknown", detail: "No class names to inspect." };
      const hashed = tokens.filter((t) => /^(css|sc|jsx|emotion|styled|e)-[a-z0-9]{4,}$/i.test(t) || /__[A-Za-z0-9_-]{5,}$/.test(t));
      const share = hashed.length / tokens.length;
      return {
        rating: share < 0.1 ? 4 : share < 0.3 ? 3 : share < 0.6 ? 2 : 1,
        detail: `${Math.round(share * 100)}% of class names look auto-generated (CSS-in-JS / CSS-module hashes), which change between deploys.`,
        fix: share >= 0.1 ? "Expose stable hooks: readable ids, name attributes, aria-labels or data-testid on key controls." : undefined,
        evidence: [...new Set(hashed)].slice(0, 5),
      };
    },
  },
  {
    id: "menus-not-hover-only",
    category: "E",
    title: "Menus work by click/focus, not only hover",
    weight: 1,
    method: "browser",
  },
  {
    id: "overlays-dismissable",
    category: "E",
    title: "Popups, cookie banners and modals can be dismissed",
    weight: 1,
    method: "browser",
  },
  {
    id: "no-new-tabs",
    category: "E",
    title: "Links don't unexpectedly open new tabs",
    weight: 1,
    method: "code",
    async run(ctx) {
      const links = internalLinks(ctx);
      if (links.length === 0) return { rating: "na", detail: "No internal links on this page." };
      const blank = links.filter(({ el }) => ctx.$(el).attr("target") === "_blank");
      return {
        rating: fromRatio(1 - blank.length / links.length),
        detail: blank.length ? `${blank.length} of ${links.length} internal links open a new tab, which breaks an agent's flow.` : "Internal links open in the same tab.",
        fix: blank.length ? 'Drop target="_blank" from links within your own site.' : undefined,
        evidence: blank.slice(0, 5).map(({ el }) => snippet(ctx.$, el)),
      };
    },
  },
  {
    id: "reload-works",
    category: "E",
    group: "cookies",
    title: "Page and state survive a reload",
    weight: 1,
    method: "browser",
  },
  {
    id: "response-time",
    category: "E",
    title: "Pages load in reasonable time",
    weight: 2,
    method: "code",
    async run(ctx) {
      const ms = ctx.page.elapsedMs;
      const rating: Rating = ms < 800 ? 4 : ms < 1500 ? 3 : ms < 3000 ? 2 : ms < 6000 ? 1 : 0;
      return {
        rating,
        detail: `The HTML took ${ms.toLocaleString()} ms to arrive (server response only, not full render).`,
        fix: rating < 3 ? "Speed up the server response (caching, CDN) so agents don't time out." : undefined,
      };
    },
  },
  {
    id: "no-bot-wall",
    category: "E",
    title: "No bot wall, CAPTCHA or rate limiting",
    weight: 3,
    method: "code",
    async run(ctx) {
      const { page } = ctx;
      const html = page.body.toLowerCase();
      const challenge = botChallenge(page);
      if (challenge) {
        return {
          rating: 0,
          detail: `The homepage returned a ${challenge} to an automated client. Agents are being blocked or rate limited.`,
          fix: "Allowlist verified AI agents in your WAF/CDN (e.g. Cloudflare's verified bots), or serve a lightweight agent-friendly path.",
        };
      }
      const captcha = /(recaptcha|hcaptcha|challenges\.cloudflare\.com\/turnstile)/.test(html);
      if (captcha) {
        return {
          rating: 2,
          detail: "A CAPTCHA was detected on the page. Agents can read it but likely can't complete forms or checkout.",
          fix: "Offer an agent-friendly path for key actions (an API or MCP tool) instead of CAPTCHA-gated forms.",
        };
      }
      return { rating: 4, detail: "The homepage loads for automated clients." };
    },
  },
  {
    id: "cookie-banner-not-blocking",
    category: "E",
    group: "cookies",
    title: "Cookie banner doesn't block the main content",
    weight: 1,
    method: "browser",
  },
  {
    id: "banner-not-reappearing",
    category: "E",
    group: "cookies",
    title: "Cookie banner doesn't reappear after a choice",
    weight: 1,
    method: "browser",
  },
  {
    id: "works-without-3p-cookies",
    category: "E",
    group: "cookies",
    title: "Site works when third-party cookies are blocked",
    weight: 1,
    method: "browser",
  },

  // ---------- F. Is it safe for an agent? ----------
  {
    id: "no-hidden-instructions",
    category: "F",
    title: "No hidden instructions aimed at AI agents",
    weight: 4,
    method: "code",
    async run(ctx) {
      const $ = ctx.$;
      const hits: string[] = [];
      const test = (where: string, text: string | undefined) => {
        const m = text?.match(INJECTION);
        if (m) hits.push(`${where}: "...${text!.slice(Math.max(0, m.index! - 40), m.index! + m[0].length + 40).replace(/\s+/g, " ").trim()}..."`);
      };
      $("*")
        .contents()
        .each((_, node) => {
          if (node.type === "comment") test("HTML comment", node.data);
        });
      $('[hidden], [aria-hidden=true], [style*="display:none"], [style*="display: none"], [style*="visibility:hidden"], [style*="font-size:0"], [style*="opacity:0"]').each((_, el) =>
        test(`hidden <${el.tagName}>`, $(el).text()),
      );
      $("[alt], [title], [aria-label], meta[content]").each((_, el) =>
        test(`<${el.tagName}> attribute`, [$(el).attr("alt"), $(el).attr("title"), $(el).attr("aria-label"), $(el).attr("content")].join(" ")),
      );
      const clone = $.root().clone();
      clone.find("script, style").remove();
      test("page text", clone.text());
      if (hits.length) {
        return {
          rating: 0,
          detail: `${hits.length} piece${hits.length === 1 ? "" : "s"} of text look like instructions aimed at AI agents (possible prompt injection).`,
          fix: "Remove text that addresses AI agents or tells them to ignore their instructions.",
          evidence: hits.slice(0, 5),
        };
      }
      return { rating: 4, detail: "No agent-targeted instructions found in comments, hidden elements, attributes or text. (Pattern-based; not exhaustive.)" };
    },
  },
  {
    id: "risky-actions-confirmed",
    category: "F",
    title: "Risky actions (buy, delete, send) have a clear confirmation step",
    weight: 2,
    method: "browser",
  },
  {
    id: "permissions-clear",
    category: "F",
    title: "Login and permission requirements are clear",
    weight: 1,
    method: "browser",
  },
  {
    id: "no-exposed-secrets",
    category: "F",
    title: "Sensitive data isn't exposed in URLs or page source",
    weight: 2,
    method: "code",
    async run(ctx) {
      const body = ctx.page.body;
      const secrets: [string, RegExp][] = [
        ["Stripe live secret key", /sk_live_[0-9a-zA-Z]{10,}/],
        ["AWS access key", /AKIA[0-9A-Z]{16}/],
        ["GitHub token", /gh[pousr]_[A-Za-z0-9]{36}/],
        ["Slack token", /xox[baprs]-[A-Za-z0-9-]{10,}/],
        ["Private key", /-----BEGIN (RSA |EC |OPENSSH )?PRIVATE KEY-----/],
      ];
      const found = secrets.filter(([, re]) => re.test(body)).map(([name]) => name);
      if (found.length) {
        // Name the kind only; never copy the secret into the report.
        return { rating: 0, detail: `Page source contains what looks like a ${found.join(", ")}.`, fix: "Revoke the credential and move it server-side.", evidence: found };
      }
      const leaky = ctx.$("a[href], form[action]").filter((_, el) =>
        /[?&](token|access_token|password|pwd|session|sessionid|api_?key)=/i.test(ctx.$(el).attr("href") ?? ctx.$(el).attr("action") ?? ""),
      );
      if (leaky.length) {
        return {
          rating: 2,
          detail: `${leaky.length} link${leaky.length === 1 ? "" : "s"} put tokens, passwords or session IDs in the URL.`,
          fix: "Pass credentials in headers or POST bodies, never query strings.",
          evidence: leaky.toArray().slice(0, 3).map((el) => (ctx.$(el).attr("href") ?? ctx.$(el).attr("action") ?? "").replace(/=([^&]+)/g, "=REDACTED")),
        };
      }
      return { rating: 4, detail: "No credentials or tokens found in the page source or link URLs." };
    },
  },
  {
    id: "reject-as-easy",
    category: "F",
    group: "cookies",
    title: "Rejecting cookies takes the same effort as accepting",
    weight: 1,
    method: "browser",
  },
  {
    id: "no-tracking-before-consent",
    category: "F",
    group: "cookies",
    title: "No tracking before consent or after rejecting",
    weight: 1,
    method: "browser",
  },
  {
    id: "cookie-security",
    category: "F",
    group: "cookies",
    title: "Session cookies have Secure, HttpOnly and SameSite set",
    weight: 1,
    method: "code",
    async run(ctx) {
      const cookies = ctx.page.setCookies;
      if (cookies.length === 0) return { rating: "unknown", detail: "No cookies set by the server on first load. Cookies set by JavaScript need a browser." };
      const https = ctx.url.protocol === "https:";
      const problems: string[] = [];
      for (const c of cookies) {
        const name = c.split("=")[0].trim();
        const attrs = c.toLowerCase();
        const missing = [
          https && !/;\s*secure/.test(attrs) ? "Secure" : "",
          !/;\s*samesite=/.test(attrs) ? "SameSite" : "",
          /sess|sid|auth|token|login/i.test(name) && !/;\s*httponly/.test(attrs) ? "HttpOnly" : "",
        ].filter(Boolean);
        // Cookie names only; values may be personal data.
        if (missing.length) problems.push(`${name}: missing ${missing.join(", ")}`);
      }
      return {
        rating: fromRatio(1 - problems.length / cookies.length),
        detail: problems.length ? `${problems.length} of ${cookies.length} cookies are missing security attributes.` : `All ${cookies.length} cookies set the expected security attributes.`,
        fix: problems.length ? "Set Secure and SameSite on every cookie, and HttpOnly on session cookies." : undefined,
        evidence: problems.slice(0, 5),
      };
    },
  },
];

/** Browser behaviors from the checklist's "record what happens" list. Reported, never scored. */
export function collectDiagnostics(ctx: AuditContext): Diagnostic[] {
  const $ = ctx.$;
  const { page } = ctx;
  const out: Diagnostic[] = [];
  const requested = page.redirects[0] ?? page.url;
  out.push({
    id: "redirects",
    title: "Redirects",
    detail: page.redirects.length ? `${[...page.redirects, page.url].join(" → ")}` : "No redirects.",
  });
  const from = new URL(requested);
  const to = new URL(page.url);
  if (from.hostname !== to.hostname || /^\/[a-z]{2}([-_][a-z]{2})?(\/|$)/i.test(to.pathname) !== /^\/[a-z]{2}([-_][a-z]{2})?(\/|$)/i.test(from.pathname)) {
    out.push({ id: "region-redirect", title: "Region or language redirect", detail: `Requested ${from.host}${from.pathname}, landed on ${to.host}${to.pathname}.` });
  }
  if (page.status === 429) out.push({ id: "rate-limited", title: "Rate limiting", detail: "The site returned HTTP 429 Too Many Requests." });
  if (/(recaptcha|hcaptcha|challenges\.cloudflare\.com\/turnstile|cf-challenge|px-captcha|datadome)/i.test(page.body)) {
    out.push({ id: "captcha", title: "CAPTCHA / bot protection", detail: "A CAPTCHA or bot-protection script is on the page. Recorded only; never bypassed." });
  }
  const scripts = $("script[src]").length + $("script:not([src])").length;
  const clone = $.root().clone();
  clone.find("script, style, noscript, svg, template").remove();
  if (clone.text().replace(/\s+/g, " ").trim().length < 150 && scripts > 0) {
    out.push({ id: "js-required", title: "JavaScript required", detail: "Almost no text without JavaScript; the page is likely rendered client-side." });
  }
  const newTabs = $('a[target="_blank"]').length;
  if (newTabs) out.push({ id: "new-tabs", title: "Popups / new tabs", detail: `${newTabs} link${newTabs === 1 ? "" : "s"} open a new tab.` });
  const downloads = $("a[download], a[href]").filter((_, el) => $(el).attr("download") != null || /\.(pdf|zip|exe|dmg|docx?|xlsx?|csv)(\?|$)/i.test($(el).attr("href") ?? "")).length;
  if (downloads) out.push({ id: "downloads", title: "File downloads", detail: `${downloads} download link${downloads === 1 ? "" : "s"}.` });
  if (/Notification\.requestPermission|geolocation\.(getCurrentPosition|watchPosition)/.test(page.body)) {
    out.push({ id: "permission-prompts", title: "Permission prompts", detail: "Inline script asks for notification or location permission. Whether it fires on load needs a browser." });
  }
  return out;
}
