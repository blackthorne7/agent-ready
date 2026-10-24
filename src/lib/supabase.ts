// Supabase clients. Tables: supabase/schema.sql
// publicDb: publishable key, read-only through RLS. adminDb: secret key, server-only writes.
// Missing or invalid env = null, so callers skip Supabase instead of failing.

import { createClient, type SupabaseClient } from "@supabase/supabase-js";

// `||` so an empty NEXT_PUBLIC_SUPABASE_URL= line from .env.example still falls back.
const url = process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL;

function make(key: string | undefined): SupabaseClient | null {
  if (!url || !key) return null;
  try {
    return createClient(url, key, { auth: { persistSession: false } });
  } catch (err) {
    console.error("[supabase] bad config:", err instanceof Error ? err.message : err);
    return null;
  }
}

let pub: SupabaseClient | null | undefined;
let admin: SupabaseClient | null | undefined;

export function publicDb() {
  if (pub === undefined) pub = make(process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY);
  return pub;
}

export function adminDb() {
  if (admin === undefined) admin = make(process.env.SUPABASE_SERVICE_ROLE_KEY);
  return admin;
}
