// Context.dev brand profiles (https://docs.context.dev/brand/overview.md): company description,
// address, socials and industry labels, used to fill in fix plans and to classify businesses.
// Not used to read pages for grading: Context.dev renders JavaScript and gets past bot walls,
// which would hide exactly the problems the audit measures.
//
// Env: CONTEXT_DEV_API_KEY (server-only), LOGOLINK_CLIENT_ID (public Logo Link client id).

const API = "https://api.context.dev/v1";

export interface Brand {
  domain: string;
  title?: string;
  description?: string;
  slogan?: string;
  address?: {
    street?: string;
    city?: string;
    state_province?: string;
    state_code?: string;
    postal_code?: string;
    country?: string;
    country_code?: string;
  };
  socials?: { type: string; url: string }[];
  logos?: { url: string; mode?: string; type?: string }[];
  links?: { contact?: string | null; pricing?: string | null; careers?: string | null };
  industries?: { eic?: { industry: string; subindustry: string }[] };
}

/** Looks up a brand profile by domain. Never throws: returns null on any failure or timeout. */
export async function getBrand(domain: string, timeoutMs = 30_000): Promise<Brand | null> {
  const key = process.env.CONTEXT_DEV_API_KEY;
  if (!key) return null;
  try {
    const res = await fetch(`${API}/brand/retrieve`, {
      method: "POST",
      headers: { authorization: `Bearer ${key}`, "content-type": "application/json" },
      body: JSON.stringify({
        type: "by_domain",
        domain,
        // Uncached domains can take up to a minute; take what's ready instead of failing.
        timeoutOpts: { milliseconds: timeoutMs, behavior: "return-partial" },
      }),
      signal: AbortSignal.timeout(timeoutMs + 5_000),
    });
    if (!res.ok) {
      console.warn(`[context.dev] ${domain}: HTTP ${res.status}`);
      return null;
    }
    const body = (await res.json()) as { brand?: Brand };
    return body.brand ?? null;
  } catch (err) {
    console.warn(`[context.dev] ${domain}:`, err instanceof Error ? err.message : err);
    return null;
  }
}

/** Logo image URL via Context.dev Logo Link, for a light tile. Embed directly; their terms don't allow storing the image. */
export function logoUrl(domain: string): string | null {
  const clientId = process.env.LOGOLINK_CLIENT_ID;
  if (!clientId) return null;
  return `https://logos.context.dev/?${new URLSearchParams({ publicClientId: clientId, domain, type: "icon", theme: "light" })}`;
}

// Context.dev's industry taxonomy (EIC) -> business_types slugs in supabase/schema.sql.
// Only clear matches: an unmapped label leaves the type to the keyword classifier.
const SUBINDUSTRY_TYPES: Record<string, string> = {
  "Restaurants & Food Service": "restaurant",
  "Aftermarket Parts & Services": "auto_shop",
  "Beauty & Personal Care": "salon",
  "Healthcare Providers & Services": "clinic",
  "Fitness & Wellness": "gym",
  "Home & Living": "retail",
  // Software that serves another industry is still a software company.
  "Restaurant Tech & Management": "tech",
  "Retail Tech & Point-of-Sale Systems": "tech",
  "E-commerce Enablement & Infrastructure": "tech",
  "Healthcare IT & EHR Systems": "tech",
  "Digital Health & Telemedicine": "tech",
  "Legal Tech & Automation": "tech",
  "Property Management Software": "tech",
  "Construction Management Software": "tech",
  "Hospitality Management Systems": "tech",
  "Education Management Systems (LMS/SIS)": "tech",
  "Advertising, Adtech & Media Buying": "tech",
  "Media Monitoring & Analytics": "tech",
  "Fashion Tech & Virtual Try-Ons": "tech",
  "Fintech Infrastructure": "tech",
  "Payments & Money Movement": "tech",
  "Financial Infrastructure & APIs": "tech",
  "Accounting, Tax & Financial Planning Tools": "tech",
  "Streaming Platforms (Video, Music, Audio)": "media",
  "Podcasting & Audio Media": "media",
};

const INDUSTRY_TYPES: Record<string, string> = {
  Technology: "tech",
  "Retail & E-commerce": "retail",
  "Luxury & Fashion": "retail",
  "News & Media": "media",
  "Government & Nonprofit": "government",
  "Construction & Built Environment": "home",
};

/** business_types slugs for each of a brand's industry labels that maps clearly, best first. */
export function businessTypesFromBrand(brand: Brand | null): string[] {
  const types = (brand?.industries?.eic ?? []).map(({ industry, subindustry }) => SUBINDUSTRY_TYPES[subindustry] ?? INDUSTRY_TYPES[industry]);
  return [...new Set(types.filter((t): t is string => !!t))];
}

/** Best business_types slug for a brand's industry labels, or undefined if none map clearly. */
export function businessTypeFromBrand(brand: Brand | null): string | undefined {
  return businessTypesFromBrand(brand)[0];
}
