// Reads the leaderboard view (supabase/schema.sql) with the publishable key.

import { publicDb } from "./supabase";

export interface LeaderboardRow {
  rank: number;
  domain: string;
  name: string | null;
  business_type: string;
  city: string | null;
  region: string | null;
  country: string | null;
  score: number;
  grade: string;
  access_score: number;
  understand_score: number;
  act_score: number;
  audited_at: string;
}

export interface Place {
  /** "city|region|country", the value used in ?place= */
  key: string;
  label: string;
}

export interface Filters {
  types: { slug: string; label: string }[];
  places: Place[];
}

export function placeLabel(p: { city: string | null; region: string | null; country: string | null }) {
  return [p.city, p.region, p.country].filter(Boolean).join(", ");
}

/** Every type, and every city that has at least one listed business. */
export async function getFilters(): Promise<Filters> {
  const db = publicDb();
  if (!db) return { types: [], places: [] };
  const [types, places] = await Promise.all([
    db.from("business_types").select("slug, label").order("label"),
    db.from("businesses").select("city, region, country").not("city", "is", null),
  ]);
  const seen = new Map<string, Place>();
  for (const p of places.data ?? []) {
    const key = [p.city, p.region ?? "", p.country ?? ""].join("|");
    if (!seen.has(key)) seen.set(key, { key, label: placeLabel(p) });
  }
  return {
    types: types.data ?? [],
    places: [...seen.values()].sort((a, b) => a.label.localeCompare(b.label)),
  };
}

/** "city|region|country" -> parts. No city means no place filter. */
export function parsePlace(place: string | undefined) {
  const [city, region, country] = (place ?? "").split("|");
  return city ? { city, region: region || null, country: country || null } : null;
}

/** Ranked rows. The rank column follows the filters: global, by type, local, or local by type. */
export async function getLeaderboard({ type, place }: { type?: string; place?: string }, limit = 50): Promise<LeaderboardRow[] | null> {
  const db = publicDb();
  if (!db) return null;

  const p = parsePlace(place);
  const rankColumn = type && p ? "local_type_rank" : p ? "local_rank" : type ? "type_rank" : "global_rank";

  // Blocked sites have no score or rank; getBlocked lists them.
  let q = db.from("leaderboard").select("*").not("score", "is", null);
  if (type) q = q.eq("business_type", type);
  if (p) {
    q = q.eq("city", p.city);
    q = p.region ? q.eq("region", p.region) : q.is("region", null);
    q = p.country ? q.eq("country", p.country) : q.is("country", null);
  }
  const { data, error } = await q.order(rankColumn).order("domain").limit(limit);
  if (error) {
    console.error("[leaderboard]", error.message);
    return null;
  }
  return data.map((r) => ({ ...r, rank: r[rankColumn] }));
}

export interface BlockedRow {
  domain: string;
  name: string | null;
  business_type: string;
  audited_at: string;
}

/** Sites whose latest check hit a bot wall: listed, but not ranked (we can't score what we can't see). */
export async function getBlocked({ type }: { type?: string }, limit = 50): Promise<BlockedRow[]> {
  const db = publicDb();
  if (!db) return [];
  let q = db.from("leaderboard").select("domain, name, business_type, audited_at").is("score", null);
  if (type) q = q.eq("business_type", type);
  const { data, error } = await q.order("audited_at", { ascending: false }).limit(limit);
  if (error) {
    console.error("[leaderboard blocked]", error.message);
    return [];
  }
  return data;
}
