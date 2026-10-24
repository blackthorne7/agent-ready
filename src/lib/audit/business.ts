import { allNodes, typesOf } from "./checks";
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

/** Best-effort business name, type and location from the page's JSON-LD. */
export function detectBusiness(ctx: AuditContext): BusinessInfo {
  const nodes = allNodes(ctx);
  const matchRule = (n: Node) => TYPE_RULES.find(([re]) => typesOf(n).some((t) => re.test(t)));

  // The business entity itself: a specific type first, then a generic one.
  const specific = nodes.find((n) => matchRule(n));
  const biz = specific ?? nodes.find((n) => typesOf(n).some((t) => GENERIC_BUSINESS.test(t)));
  const businessType = specific ? matchRule(specific)?.[1] : undefined;

  // Its own address (typed or not), else any PostalAddress on the page.
  const address =
    obj(biz?.address) ?? obj(obj(biz?.location)?.address) ?? nodes.find((n) => typesOf(n).includes("PostalAddress"));
  const name = str(biz?.name) ?? ctx.$('meta[property="og:site_name"]').attr("content")?.trim();

  return {
    name: name || undefined,
    businessType,
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
