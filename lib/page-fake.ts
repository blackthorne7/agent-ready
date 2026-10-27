// Fake website for tests (AGENT_FAKE_SITE=1). lib/page.ts delegates here.
// Paths on any host:
//   /            homepage with nav + footer links
//   /pricing     static pricing content
//   /demo        "book a demo" form (one field has no label)
//   /signup      client-rendered shell (jsEmptyLikely)
//   /contact     simple, fully labelled contact form
// Any host containing "blocked" returns a 403 bot wall.

import type { FetchResult } from "./types";
import type { FetchOptions, FormField, FormInfo, Link } from "./page";

const NAV = `
<nav>
  <a href="/">Home</a>
  <a href="/pricing">Pricing</a>
  <a href="/demo">Book a demo</a>
  <a href="/signup">Sign up</a>
</nav>`;

const FOOTER = `
<footer>
  <a href="/contact">Contact</a>
  <a href="/about">About</a>
  <a href="https://twitter.com/acme">Twitter</a>
</footer>`;

const PAGES: Record<string, { title: string; body: string }> = {
  "/": {
    title: "Acme Analytics — Product analytics for teams",
    body: `<main><h1>Understand your users</h1>
      <p>Acme Analytics helps product teams see what users do. Trusted by 2,000 companies.</p>
      <a href="/demo">Talk to sales</a></main>`,
  },
  "/pricing": {
    title: "Pricing — Acme Analytics",
    body: `<main><h1>Pricing</h1>
      <p>Starter: $29/month for up to 10k events.</p>
      <p>Growth: $199/month for up to 1M events.</p>
      <p>Enterprise: contact sales.</p></main>`,
  },
  "/demo": {
    title: "Book a demo — Acme Analytics",
    body: `<main><h1>Book a demo</h1>
      <form action="/api/demo" method="post">
        <label for="name">Full name</label><input id="name" name="name" type="text" required>
        <label for="email">Work email</label><input id="email" name="email" type="email" required>
        <input name="company_size" type="text" placeholder="" required>
        <button type="submit">Request demo</button>
      </form></main>`,
  },
  "/signup": {
    title: "Sign up",
    body: `<div id="root"></div><script src="/static/app.js"></script>`,
  },
  "/contact": {
    title: "Contact — Acme Analytics",
    body: `<main><h1>Contact us</h1>
      <form action="/api/contact" method="post">
        <label for="c-email">Email</label><input id="c-email" name="email" type="email" required>
        <label for="c-msg">Message</label><textarea id="c-msg" name="message" required></textarea>
        <button type="submit">Send</button>
      </form></main>`,
  },
  "/about": {
    title: "About — Acme Analytics",
    body: `<main><h1>About</h1><p>We are a team of 40 based in Berlin.</p></main>`,
  },
};

function htmlToText(html: string): string {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export async function fetchPage(url: string, _opts?: FetchOptions): Promise<FetchResult> { // eslint-disable-line @typescript-eslint/no-unused-vars -- same signature as lib/page.ts
  await new Promise((r) => setTimeout(r, 150));
  const u = new URL(url);

  if (u.hostname.includes("blocked")) {
    const html = `<html><head><title>Access denied</title></head><body>Checking your browser… Please complete the captcha.</body></html>`;
    return {
      status: 403,
      html,
      text: htmlToText(html),
      title: "Access denied",
      jsEmptyLikely: false,
      blocked: true,
      blockReason: "403 with bot-protection challenge page (captcha)",
    };
  }

  const path = u.pathname.replace(/\/+$/, "") || "/";
  const page = PAGES[path];
  if (!page) {
    const html = `<html><head><title>Not found</title></head><body>${NAV}<p>Page not found</p>${FOOTER}</body></html>`;
    return { status: 404, html, text: htmlToText(html), title: "Not found", jsEmptyLikely: false, blocked: false };
  }

  const html = `<html><head><title>${page.title}</title></head><body>${NAV}${page.body}${FOOTER}</body></html>`;
  const mainText = htmlToText(page.body);
  return {
    status: 200,
    html,
    text: htmlToText(html),
    title: page.title,
    jsEmptyLikely: mainText.length < 20,
    blocked: false,
  };
}

export function extractLinks(html: string, baseUrl: string): Link[] {
  const links: Link[] = [];
  for (const m of html.matchAll(/<a\s[^>]*href="([^"]*)"[^>]*>([\s\S]*?)<\/a>/gi)) {
    try {
      links.push({ text: htmlToText(m[2]), href: new URL(m[1], baseUrl).toString() });
    } catch {
      // skip malformed hrefs
    }
  }
  return links;
}

export function extractForms(html: string): FormInfo[] {
  const forms: FormInfo[] = [];
  for (const fm of html.matchAll(/<form([^>]*)>([\s\S]*?)<\/form>/gi)) {
    const attrs = fm[1];
    const inner = fm[2];
    const labels = new Map<string, string>();
    for (const lm of inner.matchAll(/<label[^>]*for="([^"]+)"[^>]*>([\s\S]*?)<\/label>/gi)) {
      labels.set(lm[1], htmlToText(lm[2]));
    }
    const fields: FormField[] = [];
    for (const im of inner.matchAll(/<(input|textarea|select)([^>]*)>/gi)) {
      const a = im[2];
      const id = /\bid="([^"]+)"/.exec(a)?.[1];
      const type = im[1].toLowerCase() === "input" ? /\btype="([^"]+)"/.exec(a)?.[1] ?? "text" : im[1].toLowerCase();
      if (type === "hidden" || type === "submit") continue;
      fields.push({
        name: /\bname="([^"]+)"/.exec(a)?.[1] ?? null,
        type,
        label: (id && labels.get(id)) || null,
        placeholder: /\bplaceholder="([^"]*)"/.exec(a)?.[1] ?? null,
        required: /\brequired\b/.test(a),
      });
    }
    forms.push({
      action: /\baction="([^"]*)"/.exec(attrs)?.[1] ?? null,
      method: (/\bmethod="([^"]*)"/.exec(attrs)?.[1] ?? "get").toLowerCase(),
      fields,
      submitText: htmlToText(/<button[^>]*>([\s\S]*?)<\/button>/i.exec(inner)?.[1] ?? "") || null,
    });
  }
  return forms;
}
