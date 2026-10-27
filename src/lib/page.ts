// Page utilities used by the agent's tools (src/lib/agent/tools.ts).
// Real fetching goes through safeFetch (src/lib/audit/fetch.ts), which blocks private
// networks and caps redirects and response size. AGENT_FAKE_SITE=1 serves src/lib/page-fake.ts instead.

import * as cheerio from "cheerio";
import { safeFetch } from "./audit/fetch";
import * as fake from "./page-fake";
import type { FetchResult } from "./types";

export interface Link {
  text: string;
  href: string;
}

export interface FormField {
  name: string | null;
  type: string;
  /** From <label>, aria-label or aria-labelledby. Placeholder alone doesn't count. */
  label: string | null;
  placeholder: string | null;
  required: boolean;
}

export interface FormInfo {
  action: string | null;
  method: string;
  fields: FormField[];
  submitText: string | null;
  /** The form embeds a captcha widget, so submitting likely needs a human. */
  captcha?: boolean;
}

export interface FetchOptions {
  userAgent?: string;
  signal?: AbortSignal;
}

const fakeSite = () => process.env.AGENT_FAKE_SITE === "1";

const clean = (s: string) => s.replace(/\s+/g, " ").trim();

const CAPTCHA_WIDGET = /g-recaptcha|recaptcha\/api|hcaptcha\.com|h-captcha|cf-turnstile|challenges\.cloudflare\.com\/turnstile/i;

// Bot walls and challenge pages. Only trusted on short pages so articles that mention "captcha" don't trip it.
// `widget` markers are captcha widgets that sites also embed inside normal forms: those only count as a
// wall when the page has no form (a form with a captcha is reported per form instead, see extractForms).
const CHALLENGE_MARKERS: { re: RegExp; label: string; widget?: boolean }[] = [
  { re: /cf-challenge|Attention Required! \| Cloudflare|Just a moment\.\.\./i, label: "Cloudflare challenge page" },
  { re: /captcha-delivery\.com|datadome/i, label: "DataDome bot protection" },
  { re: /px-captcha|perimeterx/i, label: "PerimeterX/HUMAN bot protection" },
  { re: /Access Denied.*Reference #|akamai/i, label: "Akamai access denial" },
  { re: CAPTCHA_WIDGET, label: "captcha challenge", widget: true },
];

function detectBlock(status: number, html: string, textLength: number): string | undefined {
  if (status === 401) return "HTTP 401: login required";
  if (status === 403) return "HTTP 403: access forbidden to automated clients";
  if (status === 429) return "HTTP 429: rate limited";
  if (textLength < 1500) {
    const hasForm = /<form[\s>]/i.test(html);
    for (const m of CHALLENGE_MARKERS) {
      if (m.widget && hasForm) continue;
      if (m.re.test(html)) return `${m.label} (HTTP ${status})`;
    }
  }
  if (status === 503 && textLength < 1500) return "HTTP 503 with a near-empty page (possible bot challenge)";
  return undefined;
}

export async function fetchPage(url: string, opts: FetchOptions = {}): Promise<FetchResult> {
  if (fakeSite()) return fake.fetchPage(url, opts);

  const res = await safeFetch(url);
  if (res.error) throw new Error(`Could not fetch ${url}: ${res.error}`);

  const isHtml = /html|xml/i.test(res.contentType) || /^\s*</.test(res.body);
  if (!isHtml) {
    const text = clean(res.body);
    return { status: res.status, html: "", text, title: "", jsEmptyLikely: false, blocked: false };
  }

  const $ = cheerio.load(res.body);
  const title = clean($("title").first().text());
  const scriptCount = $("script[src], script:not([type]), script[type='module']").length;
  const emptyAppRoot = $("#root, #app, #__next, #__nuxt, #svelte, [data-reactroot]").filter((_, el) => !clean($(el).text())).length > 0;
  $("script, style, noscript, svg, template, iframe").remove();
  const main = $("main").first();
  const text = clean((main.length ? main : $("body")).text());

  const blockReason = detectBlock(res.status, res.body, text.length);
  return {
    status: res.status,
    html: res.body,
    text,
    title,
    // Very little readable text plus an empty app root or several scripts: probably rendered client-side.
    jsEmptyLikely: !blockReason && text.length < 200 && (emptyAppRoot || scriptCount >= 3),
    blocked: !!blockReason,
    blockReason,
  };
}

export function extractLinks(html: string, baseUrl: string): Link[] {
  if (fakeSite()) return fake.extractLinks(html, baseUrl);
  const $ = cheerio.load(html);
  const links: Link[] = [];
  $("a[href]").each((_, el) => {
    const a = $(el);
    const href = a.attr("href") ?? "";
    if (!href || href.startsWith("#") || /^(javascript|mailto|tel):/i.test(href)) return;
    const text = clean(a.text()) || a.attr("aria-label") || a.attr("title") || a.find("img[alt]").attr("alt") || "";
    try {
      const abs = new URL(href, baseUrl);
      abs.hash = "";
      links.push({ text: clean(text), href: abs.toString() });
    } catch {
      // malformed href
    }
  });
  return links;
}

export function extractForms(html: string): FormInfo[] {
  if (fakeSite()) return fake.extractForms(html);
  const $ = cheerio.load(html);
  const forms: FormInfo[] = [];

  $("form").each((_, formEl) => {
    const form = $(formEl);
    const fields: FormField[] = [];
    form.find("input, select, textarea").each((_, fieldEl) => {
      const f = $(fieldEl);
      const tag = fieldEl.tagName.toLowerCase();
      const type = tag === "input" ? (f.attr("type") ?? "text").toLowerCase() : tag;
      if (["hidden", "submit", "button", "image", "reset"].includes(type)) return;

      const id = f.attr("id");
      const labelledBy = f.attr("aria-labelledby");
      const label =
        (id && clean($(`label[for="${id}"]`).first().text())) ||
        clean(f.closest("label").text()) ||
        f.attr("aria-label") ||
        (labelledBy &&
          clean(
            labelledBy
              .split(/\s+/)
              .map((ref) => $(`#${ref}`).text())
              .join(" "),
          )) ||
        null;

      fields.push({
        name: f.attr("name") ?? null,
        type,
        label: label ? clean(label) : null,
        placeholder: f.attr("placeholder") ?? null,
        required: f.is("[required]") || f.attr("aria-required") === "true",
      });
    });

    const submit = form.find("button[type=submit], button:not([type]), input[type=submit]").first();
    const submitText = clean(submit.is("input") ? (submit.attr("value") ?? "") : submit.text()) || submit.attr("aria-label") || null;

    forms.push({
      action: form.attr("action") ?? null,
      method: (form.attr("method") ?? "get").toLowerCase(),
      fields,
      submitText,
      captcha: CAPTCHA_WIDGET.test($.html(form)),
    });
  });
  return forms;
}
