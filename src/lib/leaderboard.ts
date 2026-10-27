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

export interface Filters {
  types: { slug: string; label: string }[];
}

/** Every business type, for the filter. */
export async function getFilters(): Promise<Filters> {
  const db = publicDb();
  if (!db) return { types: [] };
  const { data } = await db.from("business_types").select("slug, label").order("label");
  return { types: data ?? [] };
}

/** Ranked rows, overall or within one business type. */
export async function getLeaderboard({ type }: { type?: string }, limit = 50): Promise<LeaderboardRow[] | null> {
  const db = publicDb();
  if (!db) return null;

  const rankColumn = type ? "type_rank" : "global_rank";

  // Blocked sites have no score or rank; getBlocked lists them.
  let q = db.from("leaderboard").select("*").not("score", "is", null);
  if (type) q = q.eq("business_type", type);
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
