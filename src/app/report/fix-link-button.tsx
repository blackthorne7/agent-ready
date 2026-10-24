"use client";

import { useState } from "react";

type State = { kind: "idle" } | { kind: "creating" } | { kind: "created"; href: string } | { kind: "error"; message: string };

/**
 * Creates a shareable fix plan (/fix/<slug>) from the site's latest saved audit. Enabled once the
 * agent has finished, so the plan includes the agent's results.
 */
export function FixLinkButton({ url, ready }: { url: string; ready: boolean }) {
  const [state, setState] = useState<State>({ kind: "idle" });
  const [copied, setCopied] = useState(false);

  async function create() {
    setState({ kind: "creating" });
    try {
      const res = await fetch("/api/fix-link", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ url }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body.error ?? `Request failed (${res.status})`);
      setState({ kind: "created", href: new URL(body.path, window.location.origin).toString() });
    } catch (err) {
      setState({ kind: "error", message: err instanceof Error ? err.message : String(err) });
    }
  }

  return (
    <section className="flex flex-col gap-4 rounded-3xl border border-border bg-card p-8">
      <h2 className="font-display text-[28px] font-bold tracking-[-0.02em]">Get your fix plan</h2>
      <p className="text-muted">
        One link with everything to change, most important first, plus instructions you can paste into your website builder&apos;s AI (Wix,
        Squarespace, Shopify, Lovable) or send to your web developer.
      </p>

      {state.kind === "created" ? (
        <div className="flex flex-wrap items-center gap-3">
          <a href={state.href} className="rounded-[10px] bg-accent px-[18px] py-2.5 font-semibold text-white no-underline hover:opacity-90">
            Open my fix plan
          </a>
          <button
            type="button"
            onClick={async () => {
              try {
                await navigator.clipboard.writeText(state.href);
                setCopied(true);
                setTimeout(() => setCopied(false), 2000);
              } catch {
                // Clipboard blocked; the link is still shown below.
              }
            }}
            className="rounded-[10px] border border-border-strong px-3.5 py-2 text-sm font-semibold hover:bg-band"
          >
            {copied ? "Copied" : "Copy link"}
          </button>
          <code className="font-mono text-sm break-all text-muted">{state.href}</code>
        </div>
      ) : (
        <div className="flex flex-wrap items-center gap-3">
          <button
            type="button"
            onClick={create}
            disabled={!ready || state.kind === "creating"}
            className="rounded-[10px] bg-accent px-[18px] py-2.5 font-semibold text-white hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {state.kind === "creating" ? "Creating your fix plan…" : "Get my fix link"}
          </button>
          {!ready && <span className="text-[15px] text-muted">Available once the AI agent above finishes.</span>}
        </div>
      )}

      {state.kind === "error" && (
        <p role="alert" className="text-bad">
          Couldn&apos;t create the fix plan: {state.message}
        </p>
      )}
    </section>
  );
}
