// Fix links: a short, shareable /fix/<slug> page for a business owner (table fix_links in
// supabase/schema.sql). Each link points at the site's latest saved audit and stores the drafted
// files from generateFixes, so the page stays the same even if the site is audited again.

import { randomBytes } from "node:crypto";
import { generateFixes } from "./audit/fixes";
import type { CheckResult } from "./audit/types";
import { getBrand } from "./context-dev";
import { adminDb, publicDb } from "./supabase";

const SLUG_ALPHABET = "abcdefghjkmnpqrstuvwxyz23456789"; // no look-alikes (i/l/1, o/0)

function newSlug(length = 8): string {
  return [...randomBytes(length)].map((b) => SLUG_ALPHABET[b % SLUG_ALPHABET.length]).join("");
}

export class FixLinkError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
  }
}

/** Creates a fix link for the latest saved audit of `siteUrl` (the report's exact URL). */
export async function createFixLink(siteUrl: string): Promise<string> {
  const db = adminDb();
  if (!db) throw new FixLinkError("Fix links aren't set up on this server (Supabase isn't configured).", 503);

  // Brand details (address, description, socials) fill in the drafted files; looked up meanwhile.
  const brand = getBrand(new URL(siteUrl).hostname.replace(/^www\./, ""), 20_000);
  const { data: audit, error } = await db
    .from("audits")
    .select("id")
    .eq("url", siteUrl)
    .order("audited_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (!audit) throw new FixLinkError("No saved audit for this site yet. Run the check first.", 404);

  const fixes = await generateFixes(siteUrl, await brand);
  const slug = newSlug();
  const { error: insertError } = await db.from("fix_links").insert({
    slug,
    audit_id: audit.id,
    llms_txt: fixes.llmsTxt,
    json_ld: fixes.jsonLd,
    robots_txt: fixes.robotsTxt,
    mcp_manifest: fixes.mcpManifest,
  });
  if (insertError) throw new Error(insertError.message);
  return slug;
}

export interface FixLink {
  slug: string;
  createdAt: string;
  llmsTxt: string;
  jsonLd: string;
  robotsTxt: string;
  mcpManifest: string;
  audit: { url: string; score: number; grade: string; auditedAt: string; checks: CheckResult[] };
}

export async function getFixLink(slug: string): Promise<FixLink | null> {
  const db = adminDb() ?? publicDb();
  if (!db || !/^[a-z0-9]{4,32}$/.test(slug)) return null;
  const { data, error } = await db
    .from("fix_links")
    .select("slug, created_at, llms_txt, json_ld, robots_txt, mcp_manifest, audits(url, score, grade, audited_at, checks)")
    .eq("slug", slug)
    .maybeSingle();
  if (error) {
    console.error(`[fix-links] ${slug}:`, error.message);
    return null;
  }
  const audit = Array.isArray(data?.audits) ? data.audits[0] : data?.audits;
  if (!data || !audit) return null;
  return {
    slug: data.slug,
    createdAt: data.created_at,
    llmsTxt: data.llms_txt ?? "",
    jsonLd: data.json_ld ?? "",
    robotsTxt: data.robots_txt ?? "",
    mcpManifest: data.mcp_manifest ?? "",
    audit: { url: audit.url, score: audit.score, grade: audit.grade, auditedAt: audit.audited_at, checks: audit.checks },
  };
}
