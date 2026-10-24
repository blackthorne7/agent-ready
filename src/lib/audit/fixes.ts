import * as cheerio from "cheerio";
import type { Brand } from "../context-dev";
import { normalizeUrl } from ".";
import { assertPublicUrl, safeFetch } from "./fetch";

export interface Fixes {
  url: string;
  llmsTxt: string;
  jsonLd: string;
  robotsTxt: string;
  mcpManifest: string;
}

export interface FixOptions {
  /** Context.dev profile: fills in details the page doesn't state (description, address, socials, contact page). */
  brand?: Brand | null;
  /** business_types slug (supabase/schema.sql), picks the schema.org type. */
  businessType?: string | null;
}

/** Draft copy-paste fixes from what's already on the page. */
export async function generateFixes(input: string, opts: FixOptions = {}): Promise<Fixes> {
  const url = await assertPublicUrl(normalizeUrl(input));
  const page = await safeFetch(url.toString());
  return { url: url.toString(), ...draftFixes(cheerio.load(page.body), url, opts) };
}

// Businesses customers visit in person get a specific LocalBusiness type, with address and hours.
// Everything else is an Organization: no storefront, so no address or opening hours to invent.
const LOCAL_TYPES: Record<string, string> = {
  restaurant: "Restaurant",
  cafe: "CafeOrCoffeeShop",
  auto_shop: "AutoRepair",
  salon: "HairSalon",
  clinic: "MedicalClinic",
  gym: "ExerciseGym",
  home: "HomeAndConstructionBusiness",
};

/** Cloudflare's email protection replaces addresses with a hex string XORed with its first byte. */
export function decodeCloudflareEmail(hex: string): string | undefined {
  if (!/^[0-9a-f]{4,}$/i.test(hex) || hex.length % 2) return undefined;
  const key = parseInt(hex.slice(0, 2), 16);
  let out = "";
  for (let i = 2; i < hex.length; i += 2) out += String.fromCharCode(parseInt(hex.slice(i, i + 2), 16) ^ key);
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(out) ? out : undefined;
}

/** The site's own search, as a schema.org target like https://site/search?q={query}, if it has one. */
function searchTarget($: cheerio.CheerioAPI, url: URL): string | undefined {
  for (const form of $("form").toArray()) {
    const method = ($(form).attr("method") ?? "get").toLowerCase();
    if (method !== "get") continue;
    const input = $(form)
      .find('input[type="search"], input[name="q"], input[name="query"], input[name="s"], input[name="search"], input[name="keyword"], input[name="term"]')
      .first();
    const name = input.attr("name");
    if (!name) continue;
    try {
      const action = new URL($(form).attr("action") || url.pathname, url);
      if (action.origin !== url.origin) continue;
      return `${action.origin}${action.pathname}?${encodeURIComponent(name)}={query}`;
    } catch {
      // Unparseable action.
    }
  }
  return undefined;
}

/** The drafted files for a parsed page. Pure, so it's testable without the network. */
export function draftFixes($: cheerio.CheerioAPI, url: URL, { brand, businessType }: FixOptions = {}): Omit<Fixes, "url"> {
  const origin = url.origin;
  const name =
    $('meta[property="og:site_name"]').attr("content") ||
    brand?.title ||
    $("title").text().split(/[|\-–—]/)[0].trim() ||
    url.hostname;
  const description =
    $('meta[name="description"]').attr("content") || $('meta[property="og:description"]').attr("content") || brand?.description || "";
  const address = brand?.address;
  const socials = (brand?.socials ?? []).map((s) => s.url).filter(Boolean);
  const contactPage = brand?.links?.contact ?? undefined;
  const phone = $('a[href^="tel:"]').first().attr("href")?.slice(4);
  const cloudflareEmail = $("[data-cfemail]").first().attr("data-cfemail") ?? $('a[href*="/cdn-cgi/l/email-protection#"]').first().attr("href")?.split("#")[1];
  const email = $('a[href^="mailto:"]').first().attr("href")?.slice(7).split("?")[0] || (cloudflareEmail && decodeCloudflareEmail(cloudflareEmail));

  const links = new Map<string, string>();
  $("nav a[href], header a[href], footer a[href]").each((_, el) => {
    const text = $(el).text().replace(/\s+/g, " ").trim();
    try {
      const href = new URL($(el).attr("href")!, origin);
      // Skip Cloudflare's obfuscated email links (/cdn-cgi/l/email-protection, text "[email protected]").
      if (href.pathname.startsWith("/cdn-cgi/") || text.includes("[email")) return;
      if (href.origin === origin && text && text.length < 60 && !links.has(href.toString())) links.set(href.toString(), text);
    } catch {
      // Skip unparseable hrefs.
    }
  });

  const localType = businessType ? LOCAL_TYPES[businessType] : undefined;
  const search = searchTarget($, url);
  const postalAddress =
    localType || address?.street
      ? {
          "@type": "PostalAddress",
          streetAddress: address?.street ?? "TODO",
          addressLocality: address?.city ?? "TODO",
          ...(address?.state_code || address?.state_province ? { addressRegion: address.state_code ?? address.state_province } : {}),
          postalCode: address?.postal_code ?? "TODO",
          addressCountry: address?.country_code ?? address?.country ?? "TODO",
        }
      : undefined;

  const llmsTxt = [
    `# ${name}`,
    "",
    description ? `> ${description}` : `> TODO: one-sentence description of ${name}.`,
    "",
    "## Key pages",
    "",
    ...[...links].slice(0, 15).map(([href, text]) => `- [${text}](${href})`),
    "",
    "## Contact",
    "",
    phone ? `- Phone: ${phone}` : "- Phone: TODO",
    email ? `- Email: ${email}` : "- Email: TODO",
    ...(contactPage ? [`- Contact page: ${contactPage}`] : []),
    ...(address?.street ? [`- Address: ${[address.street, address.city, address.state_code ?? address.state_province, address.postal_code].filter(Boolean).join(", ")}`] : []),
    "",
  ].join("\n");

  const jsonLd = JSON.stringify(
    {
      "@context": "https://schema.org",
      "@type": localType ?? "Organization",
      name,
      url: origin,
      description: description || undefined,
      ...(localType
        ? {
            telephone: phone || "TODO",
            email: email || undefined,
            address: postalAddress,
            // TODO rather than example hours: pasted as-is, made-up hours would be repeated to customers as fact.
            openingHoursSpecification: [{ "@type": "OpeningHoursSpecification", dayOfWeek: "TODO", opens: "TODO", closes: "TODO" }],
          }
        : {
            address: postalAddress,
            contactPoint:
              email || phone || contactPage
                ? { "@type": "ContactPoint", contactType: "customer support", email: email || undefined, telephone: phone || undefined, url: contactPage }
                : undefined,
          }),
      sameAs: socials.length ? socials : undefined,
      // Only the site's real search form: an action pointing at a page that doesn't exist misleads agents.
      potentialAction: search ? { "@type": "SearchAction", target: search, "query-input": "required name=query" } : undefined,
    },
    null,
    2,
  );

  const robotsTxt = [
    "User-agent: *",
    "Allow: /",
    "",
    "# Explicitly welcome AI agents acting for users",
    ...["ClaudeBot", "Claude-User", "GPTBot", "ChatGPT-User", "OAI-SearchBot", "PerplexityBot"].flatMap((a) => [`User-agent: ${a}`, "Allow: /", ""]),
    `Sitemap: ${origin}/sitemap.xml`,
    "",
  ].join("\n");

  // For a developer, and only worth publishing if the site really runs an MCP server.
  const mcpManifest = JSON.stringify(
    {
      name,
      description: description || `MCP server for ${name}`,
      endpoint: "TODO: the URL of your MCP server. Only publish this file if you run one.",
      transport: "streamable-http",
      tools: ["TODO: the tools your server offers, e.g. get_hours, check_availability, place_order, contact"],
    },
    null,
    2,
  );

  return { llmsTxt, jsonLd, robotsTxt, mcpManifest };
}
