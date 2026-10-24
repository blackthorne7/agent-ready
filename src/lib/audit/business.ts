import { allNodes, typesOf } from "./checks";
import { businessTypesFromBrand, type Brand } from "../context-dev";
import { classifyByKeywords } from "./classify";
import type { AuditContext, BusinessInfo } from "./types";

// schema.org @type -> business_types slug (supabase/schema.sql). First match wins, so specific types come first.
const TYPE_RULES: [RegExp, string][] = [
  [/^(AutomotiveBusiness|AutoRepair|AutoDealer|AutoBodyShop|AutoPartsStore|AutoRental|AutoWash|GasStation|MotorcycleRepair|MotorcycleDealer)$/, "auto_shop"],
  [/^(CafeOrCoffeeShop|Bakery)$/, "cafe"],
  [/^(Restaurant|FoodEstablishment|FastFoodRestaurant|BarOrPub|Brewery|Winery|IceCreamShop)$/, "restaurant"],
  [/^(HealthAndBeautyBusiness|HairSalon|BeautySalon|NailSalon|DaySpa)$/, "salon"],
  [/^(MedicalBusiness|MedicalClinic|Dentist|Physician|Pharmacy|Optician|Hospital|VeterinaryCare)$/, "clinic"],
  [/^(ExerciseGym|HealthClub|SportsActivityLocation)$/, "gym"],
  [/^(HomeAndConstructionBusiness|Plumber|Electrician|HVACBusiness|RoofingContractor|HousePainter|Locksmith|MovingCompany|GeneralContractor)$/, "home"],
  [/(Store|^Florist)$/, "retail"],
  [/^(SoftwareApplication|WebApplication|MobileApplication)$/, "tech"],
];

const GENERIC_BUSINESS = /^(LocalBusiness|Organization|Corporation|OnlineBusiness|ProfessionalService)$/;

type Node = Record<string, unknown>;

const str = (v: unknown): string | undefined => {
  if (typeof v === "string") return v.trim() || undefined;
  if (v && typeof v === "object" && "name" in v) return str((v as { name: unknown }).name);
  return undefined;
};

const obj = (v: unknown): Node | undefined => {
  const first = Array.isArray(v) ? v[0] : v;
  return first && typeof first === "object" ? (first as Node) : undefined;
};

/** Best-effort business name, type and location from the page's JSON-LD, with a keyword fallback for the type. */
export function detectBusiness(ctx: AuditContext): BusinessInfo {
  const nodes = allNodes(ctx);
  const matchRule = (n: Node) => TYPE_RULES.find(([re]) => typesOf(n).some((t) => re.test(t)));

  // The business entity itself: a specific type first, then a generic one.
  const specific = nodes.find((n) => matchRule(n));
  const biz = specific ?? nodes.find((n) => typesOf(n).some((t) => GENERIC_BUSINESS.test(t)));
  // Structured data is the most reliable signal; fall back to keywords on the page.
  const businessType = specific ? matchRule(specific)?.[1] : classifyByKeywords(ctx.$, ctx.url).businessType;
  const businessTypeSource = businessType ? (specific ? "schema" : "keywords") : undefined;

  // Its own address (typed or not), else any PostalAddress on the page.
  const address =
    obj(biz?.address) ?? obj(obj(biz?.location)?.address) ?? nodes.find((n) => typesOf(n).includes("PostalAddress"));
  const name = str(biz?.name) ?? ctx.$('meta[property="og:site_name"]').attr("content")?.trim();

  return {
    name: name || undefined,
    businessType,
    businessTypeSource,
    city: str(address?.addressLocality),
    region: str(address?.addressRegion),
    country: country(str(address?.addressCountry)),
  };
}

/** Countries arrive as "US", "USA" or "United States"; store the two-letter code when we know it. */
function country(v: string | undefined): string | undefined {
  if (!v) return undefined;
  return /^(usa?|united states( of america)?)$/i.test(v) ? "US" : v.length === 2 ? v.toUpperCase() : v;
}

/**
 * Fills gaps from a Context.dev brand profile. Its industry label beats page keywords (unless they
 * agree with one of its labels) but not the site's own schema.org type; its address is used only
 * when the page had no location.
 */
export function applyBrand(info: BusinessInfo, brand: Brand | null): BusinessInfo {
  if (!brand) return info;
  const out = { ...info, name: info.name ?? brand.title };

  const brandTypes = businessTypesFromBrand(brand);
  const brandType = brandTypes[0];
  // Keep a keyword guess that matches any of the brand's labels (e.g. Wikipedia: Technology and
  // News & Media, keywords say media), and a keyword "cafe", which Context.dev files under restaurants.
  const keywordsAgree = info.businessTypeSource === "keywords" && brandTypes.includes(info.businessType ?? "");
  const cafe = brandType === "restaurant" && info.businessType === "cafe";
  if (brandType && info.businessTypeSource !== "schema" && !keywordsAgree && !cafe) {
    out.businessType = brandType;
    out.businessTypeSource = "brand";
  }

  const a = brand.address;
  if (!info.city && a?.city) {
    out.city = a.city;
    out.region = a.state_code ?? a.state_province;
    out.country = country(a.country_code ?? a.country);
  }
  return out;
}
