import type { AuditContext, Check, Status } from "./types";

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

export const checks: Check[] = [
  // ---------- Access: can agents get in? ----------
  {
    id: "robots-ai-agents",
    category: "access",
    title: "AI agents allowed in robots.txt",
    weight: 3,
    async run(ctx) {
      const res = await ctx.fetchPath("/robots.txt");
      if (!res.ok || /html/i.test(res.contentType)) {
        return {
          status: "warn",
          score: 0.7,
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
        return { status: "pass", score: 1, detail: "robots.txt lets all major AI agents in." };
      }
      return {
        status: blocked.length >= AI_AGENTS.length / 2 ? "fail" : "warn",
        score: 1 - blocked.length / AI_AGENTS.length,
        detail: `robots.txt blocks: ${blocked.join(", ")}.`,
        fix: blocked.map((a) => `User-agent: ${a}\nAllow: /`).join("\n\n"),
      };
    },
  },
  {
    id: "no-bot-wall",
    category: "access",
    title: "No bot wall or CAPTCHA",
    weight: 3,
    async run(ctx) {
      const { page } = ctx;
      const html = page.body.toLowerCase();
      const challenge =
        [403, 429, 503].includes(page.status) &&
        /(just a moment|cf-challenge|challenge-platform|attention required|access denied|px-captcha|datadome)/.test(html);
      if (challenge || page.status === 403) {
        return {
          status: "fail",
          score: 0,
          detail: `The homepage returned ${page.status} to an automated client. Agents are being blocked by a bot wall.`,
          fix: "Allowlist verified AI agents in your WAF/CDN (e.g. Cloudflare's verified bots), or serve a lightweight agent-friendly path.",
        };
      }
      const captcha = /(recaptcha|hcaptcha|challenges\.cloudflare\.com\/turnstile)/.test(html);
      if (captcha) {
        return {
          status: "warn",
          score: 0.5,
          detail: "A CAPTCHA was detected on the page. Agents can read it but likely can't complete forms or checkout.",
          fix: "Offer an agent-friendly path for key actions (an API or MCP tool) instead of CAPTCHA-gated forms.",
        };
      }
      return { status: "pass", score: 1, detail: "The homepage loads for automated clients." };
    },
  },
  {
    id: "server-rendered",
    category: "access",
    title: "Content readable without JavaScript",
    weight: 2,
    async run(ctx) {
      const $ = ctx.$;
      const clone = $.root().clone();
      clone.find("script, style, noscript, svg, template").remove();
      const text = clone.text().replace(/\s+/g, " ").trim();
      if (text.length >= 500) {
        return { status: "pass", score: 1, detail: `${text.length.toLocaleString()} characters of text in the raw HTML.` };
      }
      return {
        status: text.length >= 150 ? "warn" : "fail",
        score: text.length >= 150 ? 0.5 : 0,
        detail: `Only ${text.length} characters of text without JavaScript. Many agents don't run JS and will see an empty page.`,
        fix: "Server-render (SSR/SSG) key content: hours, menu, products, prices, contact details.",
      };
    },
  },
  {
    id: "llms-txt",
    category: "access",
    title: "llms.txt published",
    weight: 1,
    async run(ctx) {
      const res = await ctx.fetchPath("/llms.txt");
      if (res.ok && !/html/i.test(res.contentType) && res.body.trim().length > 0) {
        return { status: "pass", score: 1, detail: "/llms.txt gives agents a concise map of the site." };
      }
      return {
        status: "warn",
        score: 0,
        detail: "No /llms.txt. It's an emerging convention that gives LLMs a short, curated guide to your site.",
        fix: "Run the generate_fixes tool to draft an llms.txt from this page.",
      };
    },
  },
  {
    id: "sitemap",
    category: "access",
    title: "Sitemap available",
    weight: 1,
    async run(ctx) {
      const robots = await ctx.fetchPath("/robots.txt");
      if (robots.ok && /^sitemap:/im.test(robots.body)) {
        return { status: "pass", score: 1, detail: "Sitemap is declared in robots.txt." };
      }
      const res = await ctx.fetchPath("/sitemap.xml");
      if (res.ok && /<(urlset|sitemapindex)/i.test(res.body)) {
        return { status: "pass", score: 1, detail: "/sitemap.xml found." };
      }
      return {
        status: "warn",
        score: 0,
        detail: "No sitemap found, so agents have to guess which pages exist.",
        fix: `Publish /sitemap.xml and add \`Sitemap: ${ctx.url.origin}/sitemap.xml\` to robots.txt.`,
      };
    },
  },

  // ---------- Understand: can agents make sense of it? ----------
  {
    id: "structured-data",
    category: "understand",
    title: "Structured data (schema.org JSON-LD)",
    weight: 3,
    async run(ctx) {
      const types = [...new Set(allNodes(ctx).flatMap(typesOf))];
      if (types.length === 0) {
        return {
          status: "fail",
          score: 0,
          detail: "No JSON-LD structured data. Agents have to guess at facts like hours, prices and location from prose.",
          fix: "Run the generate_fixes tool for a JSON-LD starter for this page.",
        };
      }
      return { status: "pass", score: 1, detail: `Found schema.org types: ${types.slice(0, 12).join(", ")}.` };
    },
  },
  {
    id: "business-info",
    category: "understand",
    title: "Business identity, location and hours",
    weight: 3,
    async run(ctx) {
      const biz = findTyped(ctx, (t) => LOCAL_BUSINESS.test(t));
      if (biz.length === 0) {
        return {
          status: "fail",
          score: 0,
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
      const status: Status = missing.length === 0 ? "pass" : present >= 3 ? "warn" : "fail";
      return {
        status,
        score: present / 5,
        detail: missing.length ? `Business entity is missing: ${missing.join(", ")}.` : "Name, address, phone, hours and URL are all machine-readable.",
        fix: missing.length ? `Add ${missing.join(", ")} to your ${typesOf(biz[0])[0]} JSON-LD.` : undefined,
      };
    },
  },
  {
    id: "offerings",
    category: "understand",
    title: "Menu, products or services described",
    weight: 2,
    async run(ctx) {
      const offers = findTyped(ctx, (t) => /^(Menu|MenuItem|MenuSection|Product|Offer|AggregateOffer|Service|Event|ItemList)$/.test(t));
      const hasMenuLink = allNodes(ctx).some((n) => n.hasMenu != null || n.menu != null);
      if (offers.length || hasMenuLink) {
        return { status: "pass", score: 1, detail: `${offers.length || 1} offering entities (menu/products/services) are machine-readable.` };
      }
      return {
        status: "warn",
        score: 0,
        detail: "Nothing you sell is described in structured data, so an agent can't answer \"what's on the menu?\" or \"how much is X?\" reliably.",
        fix: "Describe items with Menu/MenuItem (restaurants), Product/Offer (shops) or Service, including prices.",
      };
    },
  },
  {
    id: "contact",
    category: "understand",
    title: "Contact details are machine-readable",
    weight: 1,
    async run(ctx) {
      const $ = ctx.$;
      const tel = $('a[href^="tel:"]').length;
      const mail = $('a[href^="mailto:"]').length;
      const ld = allNodes(ctx).some((n) => n.telephone != null || n.email != null || n.contactPoint != null);
      if (ld || (tel && mail)) return { status: "pass", score: 1, detail: "Phone/email exposed as links or structured data." };
      if (tel || mail) return { status: "warn", score: 0.5, detail: `Only ${tel ? "phone" : "email"} is linked.`, fix: "Expose both tel: and mailto: links, or a contactPoint in JSON-LD." };
      return {
        status: "fail",
        score: 0,
        detail: "No tel:, mailto: or contactPoint found on this page.",
        fix: "Add tel: and mailto: links, and a contactPoint in your Organization JSON-LD.",
      };
    },
  },
  {
    id: "meta",
    category: "understand",
    title: "Title, description and language",
    weight: 1,
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
        status: missing.length === 0 ? "pass" : missing.length <= 2 ? "warn" : "fail",
        score: 1 - missing.length / 4,
        detail: missing.length ? `Missing: ${missing.join(", ")}.` : "Title, description, Open Graph and lang are set.",
        fix: missing.length ? `Add ${missing.join(", ")} to the <head>.` : undefined,
      };
    },
  },

  // ---------- Act: can agents do things? ----------
  {
    id: "agent-protocols",
    category: "act",
    title: "Agent endpoint (MCP, A2A or OpenAPI)",
    weight: 4,
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
        return { status: "pass", score: 1, detail: `Agents can act through: ${what.join(", ")}.` };
      }
      return {
        status: "fail",
        score: 0,
        detail: "No MCP server, A2A agent card or OpenAPI spec found. Agents have to click through your UI to get anything done.",
        fix: "Expose your key actions (check availability, order, book, contact) as an MCP server and advertise it at /.well-known/mcp.json.",
      };
    },
  },
  {
    id: "actions",
    category: "act",
    title: "Actions declared (order, reserve, search)",
    weight: 2,
    async run(ctx) {
      const actions = allNodes(ctx)
        .flatMap((n) => {
          const pa = n.potentialAction;
          return Array.isArray(pa) ? pa : pa ? [pa] : [];
        })
        .flatMap((a) => (a && typeof a === "object" ? typesOf(a as Record<string, unknown>) : []));
      const accepts = allNodes(ctx).some((n) => n.acceptsReservations != null);
      if (actions.length || accepts) {
        return { status: "pass", score: 1, detail: `Declared actions: ${[...new Set(actions)].join(", ") || "acceptsReservations"}.` };
      }
      return {
        status: "warn",
        score: 0,
        detail: "No potentialAction (OrderAction, ReserveAction, SearchAction) in structured data.",
        fix: "Add potentialAction entries pointing at your order/booking/search URLs.",
      };
    },
  },
  {
    id: "forms-labeled",
    category: "act",
    title: "Forms and buttons are labeled",
    weight: 2,
    async run(ctx) {
      const $ = ctx.$;
      const inputs = $("input, select, textarea").filter(
        (_, el) => !["hidden", "submit", "button", "image", "reset"].includes(($(el).attr("type") ?? "").toLowerCase()),
      );
      const buttons = $("button, [role=button], input[type=submit]");
      if (inputs.length + buttons.length === 0) {
        return { status: "warn", score: 0.5, detail: "No forms or buttons on this page, so there's nothing to evaluate for actions." };
      }
      let unlabeled = 0;
      inputs.each((_, el) => {
        const e = $(el);
        const id = e.attr("id");
        const labeled =
          e.attr("aria-label") || e.attr("aria-labelledby") || e.attr("title") || (id && $(`label[for="${id}"]`).length) || e.closest("label").length;
        if (!labeled) unlabeled++;
      });
      buttons.each((_, el) => {
        const e = $(el);
        if (!e.text().trim() && !e.attr("aria-label") && !e.attr("value") && !e.attr("title")) unlabeled++;
      });
      const total = inputs.length + buttons.length;
      const ratio = 1 - unlabeled / total;
      return {
        status: ratio >= 0.9 ? "pass" : ratio >= 0.6 ? "warn" : "fail",
        score: ratio,
        detail: unlabeled ? `${unlabeled} of ${total} inputs/buttons have no accessible label. Agents navigate by these labels.` : `All ${total} inputs/buttons are labeled.`,
        fix: unlabeled ? "Give every input a <label> or aria-label and every icon-only button an aria-label." : undefined,
      };
    },
  },
];
