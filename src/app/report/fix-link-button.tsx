"use client";

import { useEffect, useRef, useState } from "react";

/** How long the "Link copied" message shows before the fix page opens. */
const OPEN_AFTER_MS = 2500;
const COPY_TIMEOUT_MS = 3000;

/** Which button started the action, so its result shows under that button only. */
type Source = "banner" | "repeat";

type State =
  | { kind: "idle" }
  | { kind: "creating"; from: Source; action: "copy" | "email" }
  | { kind: "copied"; from: Source; href: string; clipboard: boolean; staying: boolean }
  | { kind: "error"; from: Source; message: string };

async function createFixLink(url: string): Promise<string> {
  const res = await fetch("/api/fix-link", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ url }),
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(body.error ?? `Request failed (${res.status})`);
  return new URL(body.path, window.location.origin).toString();
}

// Safari only allows clipboard writes inside the click, so hand it a ClipboardItem that resolves
// once the link exists. Browsers without that fall back to writeText.
async function copyWhenReady(text: Promise<string>): Promise<boolean> {
  try {
    if (typeof ClipboardItem !== "undefined" && navigator.clipboard?.write) {
      await navigator.clipboard.write([new ClipboardItem({ "text/plain": text.then((t) => new Blob([t], { type: "text/plain" })) })]);
      return true;
    }
  } catch {
    // Fall through to writeText.
  }
  try {
    await navigator.clipboard.writeText(await text);
    return true;
  } catch {
    return false;
  }
}

export type FixLink = ReturnType<typeof useFixLink>;

/**
 * Creates the shareable fix plan (/fix/<slug>) from the saved final audit of `url`, copies its link
 * and opens it. `url` is the final report's URL, the one /api/agent saved under.
 */
export function useFixLink(url: string) {
  const [state, setState] = useState<State>({ kind: "idle" });
  const pending = useRef<{ url: string; href: Promise<string> } | null>(null);
  const busy = state.kind === "creating";

  useEffect(() => {
    if (state.kind !== "copied" || state.staying) return;
    const timer = setTimeout(() => window.location.assign(state.href), OPEN_AFTER_MS);
    return () => clearTimeout(timer);
  }, [state]);

  // Coming Back from the fix page can restore this page as it was; don't leave it saying "Opening…".
  useEffect(() => {
    const reset = (e: PageTransitionEvent) => e.persisted && setState({ kind: "idle" });
    window.addEventListener("pageshow", reset);
    return () => window.removeEventListener("pageshow", reset);
  }, []);

  function link(): Promise<string> {
    if (pending.current?.url !== url) {
      const href = createFixLink(url).catch((err) => {
        pending.current = null;
        throw err;
      });
      pending.current = { url, href };
    }
    return pending.current!.href;
  }

  const fail = (from: Source, err: unknown) => setState({ kind: "error", from, message: err instanceof Error ? err.message : String(err) });

  async function copyAndOpen(from: Source) {
    setState({ kind: "creating", from, action: "copy" });
    const href = link();
    // A clipboard write can hang (no focus or user gesture), so stop waiting and show the link instead.
    const copied = Promise.race([copyWhenReady(href), new Promise<boolean>((r) => setTimeout(() => r(false), COPY_TIMEOUT_MS))]);
    try {
      const h = await href;
      setState({ kind: "copied", from, href: h, clipboard: await copied, staying: false });
    } catch (err) {
      fail(from, err);
    }
  }

  async function email(from: Source) {
    setState({ kind: "creating", from, action: "email" });
    try {
      const h = await link();
      const subject = "Please apply these website fixes";
      const body = `Hi,\n\nAI assistants have trouble reading and using our website. This link explains what to change, most important first:\n\n${h}\n\nThanks!`;
      setState({ kind: "idle" });
      window.location.href = `mailto:?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;
    } catch (err) {
      fail(from, err);
    }
  }

  const stay = () => setState((s) => (s.kind === "copied" ? { ...s, staying: true } : s));

  return { state, busy, copyAndOpen, email, stay };
}

function copyLabel({ state }: FixLink): string {
  if (state.kind === "creating" && state.action === "copy") return "Creating your link…";
  if (state.kind === "copied") return state.clipboard ? "Copied ✓" : "Link ready";
  return "Copy my fix link";
}

function Status({ fix, from }: { fix: FixLink; from: Source }) {
  const { state } = fix;
  if (state.kind === "idle" || state.from !== from) return null;
  if (state.kind === "creating") {
    return state.action === "email" ? (
      <p role="status" className="text-[15px] text-[#eaf1ff]">
        Creating your link for the email…
      </p>
    ) : null;
  }
  if (state.kind === "error") {
    return (
      <p role="alert" className="rounded-2xl bg-white px-5 py-4 text-[#9f1239]">
        Couldn&apos;t create your fix link: {state.message}
      </p>
    );
  }
  return (
    <div role="status" className="flex items-start gap-3.5 rounded-2xl bg-white px-5 py-4 text-[#0b1220]">
      <span aria-hidden="true" className="flex h-8 w-8 flex-none items-center justify-center rounded-full bg-[#16a34a]">
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
          <path d="M5 12l5 5L20 7" />
        </svg>
      </span>
      <div className="flex flex-col gap-2">
        <strong className="text-lg">{state.clipboard ? "Link copied" : "Your fix link is ready"}</strong>
        <span className="text-[#334155]">
          {state.clipboard
            ? "Now open your website builder, paste the link into its AI chat and send. It reads the link and makes the changes."
            : "We couldn't copy it automatically. Use “Copy link to this page” on the fix page."}
          {state.staying ? "" : " Opening your fix page…"}
        </span>
        <div className="flex flex-wrap gap-4">
          <a href={state.href} className="font-semibold text-[#1d4ed8]">
            Open my fix page
          </a>
          {!state.staying && (
            <button type="button" onClick={fix.stay} className="font-semibold text-[#334155] underline-offset-4 hover:underline">
              Stay on this page
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

/** The report's main call to action. */
export function FixLinkBanner({ fix, count }: { fix: FixLink; count: number }) {
  return (
    <section aria-labelledby="fix-link-title" className="flex flex-col gap-5 rounded-3xl bg-accent-strong p-7 text-white sm:p-9">
      <div className="flex flex-wrap items-center justify-between gap-6">
        <div className="flex min-w-0 flex-[1_1_380px] flex-col gap-2">
          <h2 id="fix-link-title" className="font-display text-[28px] leading-tight font-bold sm:text-[30px]">
            {count === 1 ? "Your fix is in your fix link." : `All ${count} fixes are in your fix link.`}
          </h2>
          <p className="text-lg text-[#eaf1ff]">
            Paste it into your website builder&apos;s AI (Wix, Squarespace, Lovable, Bolt or Claude) and it makes the changes for you.
          </p>
        </div>
        <div className="flex flex-wrap gap-2.5">
          <button
            type="button"
            onClick={() => fix.copyAndOpen("banner")}
            disabled={fix.busy}
            className="min-h-[52px] min-w-[200px] rounded-xl bg-white px-[22px] text-lg font-bold text-black hover:bg-[#eaf1ff] disabled:cursor-wait disabled:opacity-80"
          >
            {copyLabel(fix)}
          </button>
          <button
            type="button"
            onClick={() => fix.email("banner")}
            disabled={fix.busy}
            className="min-h-[52px] rounded-xl border-2 border-white px-5 text-lg font-bold text-white hover:bg-white/10 disabled:cursor-wait disabled:opacity-60"
          >
            Send to my web person
          </button>
        </div>
      </div>
      <Status fix={fix} from="banner" />
    </section>
  );
}

/** A smaller repeat of the call to action, after the top fixes. */
export function FixLinkRepeat({ fix, count }: { fix: FixLink; count: number }) {
  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center gap-3">
        <button
          type="button"
          onClick={() => fix.copyAndOpen("repeat")}
          disabled={fix.busy}
          className="min-h-[52px] min-w-[200px] rounded-xl bg-accent-strong px-[22px] text-lg font-bold text-white hover:opacity-90 disabled:cursor-wait disabled:opacity-60"
        >
          {copyLabel(fix)}
        </button>
        <span className="text-muted">{count === 1 ? "Your fix" : `All ${count} fixes`}, ready to paste into your website builder.</span>
      </div>
      <Status fix={fix} from="repeat" />
    </div>
  );
}
