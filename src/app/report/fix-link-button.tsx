"use client";

import { useCallback, useEffect, useRef, useState } from "react";

/** How long the "Link copied" message shows before the fix page opens. */
const OPEN_AFTER_MS = 2500;
const COPY_TIMEOUT_MS = 3000;

/** Which button started the action, so its result shows under that button only. */
type Source = "banner" | "repeat";

type State =
  | { kind: "idle" }
  | { kind: "creating"; from: Source; action: "copy" | "email" | "pay" }
  | { kind: "copied"; from: Source; href: string; clipboard: boolean; staying: boolean }
  | { kind: "error"; from: Source; message: string };

/** Whether exporting needs payment, and the paid Stripe Checkout Session if the visitor just came back from one. */
export interface Payment {
  required: boolean;
  priceLabel: string;
  /** ?checkout=<session id> from Stripe's return URL. */
  checkout?: string;
}

class PaymentRequired extends Error {
  constructor(
    message: string,
    /** Paid for an earlier report of this site; it changed since, so this report needs a new payment. */
    readonly newReport: boolean,
  ) {
    super(message);
  }
}

async function createFixLink(url: string, checkout: string | undefined): Promise<string> {
  const res = await fetch("/api/fix-link", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ url, checkout }),
  });
  const body = await res.json().catch(() => ({}));
  if (res.status === 402) throw new PaymentRequired(body.error ?? "Payment required", !!body.newReport);
  if (!res.ok) throw new Error(body.error ?? `Request failed (${res.status})`);
  return new URL(body.path, window.location.origin).toString();
}

async function startCheckout(url: string): Promise<void> {
  const res = await fetch("/api/checkout", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ url }),
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok || !body.checkoutUrl) throw new Error(body.error ?? `Request failed (${res.status})`);
  window.location.assign(body.checkoutUrl);
}

/** "Already paid?": the paid session for this site bought with `email`, looked up in Stripe. */
async function restorePayment(url: string, email: string): Promise<string> {
  const res = await fetch("/api/checkout/restore", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ url, email }),
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok || !body.checkout) throw new Error(body.error ?? `Request failed (${res.status})`);
  return body.checkout;
}

/** Whether a stored payment still covers this site's current report. */
async function paymentStatus(url: string, checkout: string): Promise<"paid" | "new-report" | "unpaid"> {
  const res = await fetch("/api/checkout/status", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ url, checkout }),
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(body.error ?? `Request failed (${res.status})`);
  return body.status;
}

// A paid session is remembered per site in this browser, so a reload or a later visit doesn't ask again.
const paidKey = (url: string) => `agentready:fix-paid:${new URL(url).hostname.replace(/^www\./, "")}`;

function readPaid(url: string): string | undefined {
  try {
    return localStorage.getItem(paidKey(url)) ?? undefined;
  } catch {
    return undefined;
  }
}

function writePaid(url: string, session: string | null) {
  try {
    if (session) localStorage.setItem(paidKey(url), session);
    else localStorage.removeItem(paidKey(url));
  } catch {
    // Private mode or blocked storage: the visitor just pays per visit.
  }
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
export function useFixLink(url: string, payment: Payment = { required: false, priceLabel: "" }) {
  const [state, setState] = useState<State>({ kind: "idle" });
  const [paidSession, setPaidSession] = useState<string | undefined>(payment.checkout);
  // The stored payment was for an earlier report: the site changed since, so this one needs a new payment.
  const [newReport, setNewReport] = useState(false);
  const pending = useRef<{ url: string; href: Promise<string> } | null>(null);
  const busy = state.kind === "creating";
  const locked = payment.required && !paidSession;

  // Remember a session Stripe just returned, or pick up one paid earlier, and drop ?checkout= from the address bar.
  useEffect(() => {
    if (!payment.required) return;
    if (payment.checkout) {
      writePaid(url, payment.checkout);
      const clean = new URL(window.location.href);
      clean.searchParams.delete("checkout");
      window.history.replaceState(null, "", clean);
    } else {
      setPaidSession(readPaid(url));
    }
  }, [url, payment.required, payment.checkout]);

  const forget = useCallback(
    (changed: boolean) => {
      writePaid(url, null);
      setPaidSession(undefined);
      setNewReport(changed);
    },
    [url],
  );

  /** Re-checks a stored payment against this report, so "Paid" never shows for a report it doesn't cover. */
  const verify = useCallback(async () => {
    if (!payment.required || !paidSession) return;
    try {
      const status = await paymentStatus(url, paidSession);
      if (status !== "paid") forget(status === "new-report");
    } catch {
      // Can't tell right now; /api/fix-link checks again before exporting.
    }
  }, [url, payment.required, paidSession, forget]);

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
      const href = createFixLink(url, paidSession).catch((err) => {
        pending.current = null;
        // A stored session that no longer covers this report: forget it and lock again.
        if (err instanceof PaymentRequired) forget(err.newReport);
        throw err;
      });
      pending.current = { url, href };
    }
    return pending.current!.href;
  }

  const fail = (from: Source, err: unknown) => setState({ kind: "error", from, message: err instanceof Error ? err.message : String(err) });

  async function pay(from: Source) {
    setState({ kind: "creating", from, action: "pay" });
    try {
      await startCheckout(url);
    } catch (err) {
      fail(from, err);
    }
  }

  async function copyAndOpen(from: Source) {
    if (locked) return pay(from);
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
    if (locked) return pay(from);
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

  /** Unlocks this browser again for a buyer who cleared storage or switched device. Throws with a message to show. */
  async function restore(email: string) {
    const session = await restorePayment(url, email);
    writePaid(url, session);
    setPaidSession(session);
    setNewReport(false);
    pending.current = null;
  }

  return { state, busy, locked, restore, verify, newReport, paid: payment.required && !!paidSession, priceLabel: payment.priceLabel, copyAndOpen, email, stay };
}

function copyLabel({ state, locked, priceLabel }: FixLink): string {
  if (state.kind === "creating" && state.action === "pay") return "Opening checkout…";
  if (locked) return `Get my fix link · ${priceLabel}`;
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
        Couldn&apos;t {fix.locked ? "start checkout" : "create your fix link"}: {state.message}
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

/** Price and demo card while locked; a receipt line once paid. Nothing when there's no paywall. */
function PaymentNote({ fix, className }: { fix: FixLink; className: string }) {
  if (fix.paid) return <p className={className}>Paid ✓ Your fix link for this report is unlocked.</p>;
  if (!fix.locked) return null;
  return (
    <p className={className}>
      {fix.newReport && <strong>Your site changed since you paid, so this is a new report. </strong>}
      {fix.priceLabel} for this report&apos;s fix link; the report itself stays free. Re-checking without changes stays unlocked; a new report after
      changes is {fix.priceLabel} again. Demo checkout (Stripe test mode): pay with card <span className="font-mono">4242 4242 4242 4242</span>, any
      future date and any CVC. No real money is charged.
    </p>
  );
}

/** "Already paid? Restore with your email", for a buyer whose browser forgot the payment. */
function RestorePayment({ fix }: { fix: FixLink }) {
  const [open, setOpen] = useState(false);
  const [email, setEmail] = useState("");
  const [status, setStatus] = useState<{ kind: "idle" | "checking" } | { kind: "error"; message: string }>({ kind: "idle" });
  if (!fix.locked) return null;
  if (!open) {
    return (
      <button type="button" onClick={() => setOpen(true)} className="self-start text-[15px] font-semibold text-white underline underline-offset-4">
        Already paid? Restore with your email
      </button>
    );
  }
  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setStatus({ kind: "checking" });
    try {
      await fix.restore(email);
    } catch (err) {
      setStatus({ kind: "error", message: err instanceof Error ? err.message : String(err) });
    }
  }
  return (
    <form onSubmit={submit} className="flex flex-col gap-2">
      <label htmlFor="restore-email" className="text-[15px] text-[#eaf1ff]">
        The email you used at checkout
      </label>
      <div className="flex flex-wrap gap-2.5">
        <input
          id="restore-email"
          type="email"
          required
          autoComplete="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          className="min-h-[48px] min-w-0 flex-[1_1_240px] rounded-xl px-4 text-lg text-black"
        />
        <button
          type="submit"
          disabled={status.kind === "checking"}
          className="min-h-[48px] rounded-xl border-2 border-white px-5 text-lg font-bold text-white hover:bg-white/10 disabled:cursor-wait disabled:opacity-60"
        >
          {status.kind === "checking" ? "Checking…" : "Restore"}
        </button>
      </div>
      {status.kind === "error" && (
        <p role="alert" className="rounded-xl bg-white px-4 py-2.5 text-[#9f1239]">
          {status.message}
        </p>
      )}
    </form>
  );
}

/** The report's main call to action. */
export function FixLinkBanner({ fix, count }: { fix: FixLink; count: number }) {
  // The banner shows with the final, saved report, so this is when a stored payment can be checked against it.
  const { verify } = fix;
  useEffect(() => {
    void verify();
  }, [verify]);
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
      <PaymentNote fix={fix} className="text-[15px] text-[#eaf1ff]" />
      <RestorePayment fix={fix} />
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
      <PaymentNote fix={fix} className="text-[15px] text-muted" />
      <Status fix={fix} from="repeat" />
    </div>
  );
}
