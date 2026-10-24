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

/**
 * Draft copy-paste fixes from what's already on the page. A Context.dev brand profile, when given,
 * fills in details the page doesn't state (description, address, social profiles, contact page).
 */
export async function generateFixes(input: string, brand?: Brand | null): Promise<Fixes> {
  const url = await assertPublicUrl(normalizeUrl(input));
  const page = await safeFetch(url.toString());
  const $ = cheerio.load(page.body);
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
  const email = $('a[href^="mailto:"]').first().attr("href")?.slice(7).split("?")[0];

  const links = new Map<string, string>();
  $("nav a[href], header a[href], footer a[href]").each((_, el) => {
    const text = $(el).text().replace(/\s+/g, " ").trim();
    try {
      const href = new URL($(el).attr("href")!, origin);
      if (href.origin === origin && text && text.length < 60 && !links.has(href.toString())) links.set(href.toString(), text);
    } catch {
      // Skip unparseable hrefs.
    }
  });

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
      "@type": "LocalBusiness",
      name,
      url: origin,
      description: description || undefined,
      telephone: phone || "TODO",
      email: email || undefined,
      address: {
        "@type": "PostalAddress",
        streetAddress: address?.street ?? "TODO",
        addressLocality: address?.city ?? "TODO",
        ...(address?.state_code || address?.state_province ? { addressRegion: address.state_code ?? address.state_province } : {}),
        postalCode: address?.postal_code ?? "TODO",
        addressCountry: address?.country_code ?? address?.country ?? "TODO",
      },
      sameAs: socials.length ? socials : undefined,
      openingHoursSpecification: [
        // TODO rather than example hours: pasted as-is, made-up hours would be repeated to customers as fact.
        { "@type": "OpeningHoursSpecification", dayOfWeek: "TODO", opens: "TODO", closes: "TODO" },
      ],
      potentialAction: { "@type": "SearchAction", target: `${origin}/search?q={query}`, "query-input": "required name=query" },
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

  const mcpManifest = JSON.stringify(
    {
      name,
      description: description || `MCP server for ${name}`,
      endpoint: `${origin}/api/mcp`,
      transport: "streamable-http",
      tools: ["get_hours", "get_menu_or_catalog", "check_availability", "place_order", "contact"],
    },
    null,
    2,
  );

  return { url: url.toString(), llmsTxt, jsonLd, robotsTxt, mcpManifest };
}
