import type { CheerioAPI } from "cheerio";

// Keyword classifier for business type, used when a site has no specific schema.org @type
// (see business.ts). Slugs are business_types in supabase/schema.sql.
//
// Each keyword counts at most once per source, weighted by how much that source says about
// the business: the title and description most, then headings, then navigation links, then body text.

const KEYWORDS: Record<string, string[]> = {
  restaurant: ["restaurant", "menu", "our menu", "order online", "reservations", "reserve a table", "takeout", "take-out", "dine-in", "catering", "happy hour", "brunch", "burgers", "pizza", "tacos", "burrito", "sushi", "grill", "kitchen"],
  cafe: ["cafe", "café", "coffee", "espresso", "latte", "bakery", "pastries", "croissant", "roastery", "roasters", "tea house"],
  auto_shop: ["auto repair", "car repair", "oil change", "tires", "tyres", "brakes", "mechanic", "auto service", "car wash", "alignment", "collision", "dealership", "transmission"],
  salon: ["salon", "barber", "barbershop", "haircut", "haircuts", "hair color", "stylist", "manicure", "pedicure", "nails", "blowout", "waxing", "lashes"],
  clinic: ["dentist", "dental", "clinic", "doctor", "physician", "patients", "urgent care", "pharmacy", "veterinary", "orthodontics", "optometry", "medical", "healthcare", "telehealth"],
  gym: ["gym", "fitness", "workout", "personal training", "personal trainer", "yoga", "pilates", "crossfit", "group classes", "strength training"],
  retail: ["shop now", "add to cart", "free shipping", "new arrivals", "store locator", "shop all", "checkout", "best sellers", "gift cards", "returns"],
  home: ["plumbing", "plumber", "electrician", "hvac", "roofing", "contractor", "remodeling", "cleaning services", "pest control", "landscaping", "handyman", "free estimate"],
  tech: ["pricing", "api", "docs", "documentation", "developers", "sign up", "free trial", "sdk", "platform", "software", "saas", "integrations", "dashboard", "open source", "analytics", "deploy", "changelog", "enterprise", "ai", "artificial intelligence", "machine learning", "llm"],
  media: ["news", "latest news", "breaking news", "headlines", "opinion", "editorial", "journalism", "newsletter", "podcast", "magazine", "encyclopedia", "articles", "reporters"],
  government: ["government", "department of", "ministry", "public services", "council", "nonprofit", "non-profit", "charity", "donate", "volunteer", "foundation", "our mission"],
};

const SOURCE_WEIGHTS = { title: 3, description: 3, headings: 2, nav: 1, body: 0.5 } as const;
type Source = keyof typeof SOURCE_WEIGHTS;

/** Minimum score to pick a type, and how far ahead of the runner-up it must be. */
const MIN_SCORE = 3;
const MIN_LEAD = 1.5;

// Government domains are a strong signal on their own.
const GOV_DOMAIN = /(\.gov|\.mil|\.gov\.[a-z]{2}|\.gouv\.[a-z]{2}|\.gc\.ca|\.europa\.eu)$/i;

const clean = (s: string) => s.replace(/\s+/g, " ").trim().toLowerCase();

const PATTERNS = Object.fromEntries(
  Object.entries(KEYWORDS).map(([type, words]) => [
    type,
    words.map((w) => ({ word: w, re: new RegExp(`(^|[^\\p{L}\\p{N}])${w.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}($|[^\\p{L}\\p{N}])`, "u") })),
  ]),
);

export interface Classification {
  businessType?: string;
  /** Matched keywords for the chosen type, for debugging and explanations. */
  matched: string[];
  scores: Record<string, number>;
}

export function classifyByKeywords($: CheerioAPI, url: URL): Classification {
  const sources: Record<Source, string> = {
    title: clean($("title").first().text()),
    description: clean(
      [$('meta[name="description"]').attr("content"), $('meta[property="og:description"]').attr("content")].filter(Boolean).join(" "),
    ),
    headings: clean($("h1, h2, h3").slice(0, 30).text()),
    nav: clean($("nav a, header a, footer a").slice(0, 150).map((_, el) => $(el).text()).get().join(" | ")),
    body: clean($("main").first().text() || $("body").text()).slice(0, 6000),
  };

  const scores: Record<string, number> = {};
  const matchedBy: Record<string, Set<string>> = {};
  for (const [type, patterns] of Object.entries(PATTERNS)) {
    scores[type] = 0;
    matchedBy[type] = new Set();
    for (const { word, re } of patterns) {
      for (const source of Object.keys(sources) as Source[]) {
        if (re.test(sources[source])) {
          scores[type] += SOURCE_WEIGHTS[source];
          matchedBy[type].add(word);
        }
      }
    }
  }
  if (GOV_DOMAIN.test(url.hostname)) {
    scores.government += 10;
    matchedBy.government.add(url.hostname);
  }

  const [best, second] = Object.entries(scores).sort((a, b) => b[1] - a[1]);
  const confident = best[1] >= MIN_SCORE && best[1] >= second[1] * MIN_LEAD;
  return {
    businessType: confident ? best[0] : undefined,
    matched: confident ? [...matchedBy[best[0]]] : [],
    scores,
  };
}
