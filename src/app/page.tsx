import { headers } from "next/headers";
import Link from "next/link";
import { AuditForm } from "./audit-form";
import { ScoreRing, SiteFooter, SiteHeader, StatusRow } from "./ui";

const questions = [
  {
    title: "Can it find you?",
    body: "Is your website open to AI assistants, or is something quietly blocking them?",
    icon: (
      <>
        <circle cx="11" cy="11" r="7" />
        <path d="M20 20l-3.5-3.5" />
      </>
    ),
  },
  {
    title: "Can it understand you?",
    body: "Can it read your hours, address, menu, services and prices, or are they stuck in pictures?",
    icon: <path d="M4 5h16M4 10h16M4 15h10M4 20h7" />,
  },
  {
    title: "Can it act for customers?",
    body: "Can it book the appointment, reserve the table or place the order without a phone call?",
    icon: (
      <>
        <rect x="3" y="5" width="18" height="16" rx="2" />
        <path d="M3 10h18M8 3v4M16 3v4M8 15l2.5 2.5L16 13" />
      </>
    ),
  },
];

const steps = [
  { title: "Get your score", body: "Enter your website and see what AI can and can’t do with it." },
  { title: "Copy your fix link", body: "One link with every change your site needs, written for AI website builders." },
  { title: "Paste it where you edit your site", body: "Your website builder’s AI applies the changes. Then check your new score." },
];

const tools = ["Wix", "Squarespace", "Lovable", "Bolt", "Claude", "Your web developer"];

const asks = [
  "Brunch spot open now with vegan options under $25",
  "Book an oil change this Saturday near me",
  "Barber with a walk-in slot after 5pm",
];

export default async function Home() {
  const host = (await headers()).get("host") ?? "localhost:3000";
  const origin = `${host.startsWith("localhost") ? "http" : "https"}://${host}`;

  return (
    <div className="text-[17px] leading-[1.55]">
      <SiteHeader />

      <main>
        <section id="top" className="mx-auto flex max-w-[1040px] flex-col items-center gap-6 px-6 pt-[88px] pb-16 text-center">
          <p className="rounded-full bg-accent-soft px-3.5 py-1.5 text-sm font-semibold text-accent-text">Like a Google score, but for AI assistants</p>
          <h1 className="font-display text-[40px] leading-[1.04] font-bold tracking-[-0.03em] sm:text-[64px]">
            Your next customer is asking AI where to go. <span className="text-accent">Can it read your website?</span>
          </h1>
          <p className="max-w-[720px] text-[21px] text-muted">
            Get a free score out of 100 that shows whether AI assistants can find your business, understand what you sell, and book or order for your
            customers.
          </p>
          <div id="check" className="flex w-full max-w-[640px] flex-col gap-2">
            <AuditForm />
            <p className="text-left text-[15px] text-muted">Free. Under a minute. You don’t need to know anything technical.</p>
          </div>
        </section>

        <section className="mx-auto max-w-[1040px] px-6 pb-24">
          <div className="flex flex-wrap items-center gap-10 rounded-3xl border border-border bg-card p-8">
            <ScoreRing score={38} caption="Example report" />
            <div className="flex min-w-0 flex-[1_1_420px] flex-col gap-4">
              <div>
                <h2 className="font-display text-[28px] font-bold">Bella Cucina</h2>
                <p className="text-[15px] text-muted">Italian restaurant · fictional example</p>
              </div>
              <div className="flex flex-col gap-3">
                <StatusRow title="Can AI find you?" detail="Yes, nothing blocks it." tone="good" />
                <StatusRow title="Can AI understand you?" detail="It can’t read your menu, prices or hours." tone="warn" />
                <StatusRow title="Can AI book for customers?" detail="No way to reserve or order." tone="bad" />
              </div>
              <Link href="#steps" className="self-start font-semibold text-accent hover:text-accent-text">
                See how to fix this →
              </Link>
            </div>
          </div>
        </section>

        <section id="score" className="mx-auto flex max-w-[1200px] flex-col gap-10 px-6 py-24">
          <div className="flex max-w-[720px] flex-col gap-3">
            <h2 className="font-display text-[36px] leading-[1.05] font-bold tracking-[-0.02em] sm:text-[44px]">Your score answers three questions</h2>
            <p className="text-[19px] text-muted">These are the same questions an AI assistant asks before it recommends a business.</p>
          </div>
          <div className="grid grid-cols-[repeat(auto-fit,minmax(280px,1fr))] gap-6">
            {questions.map((q) => (
              <div key={q.title} className="flex flex-col gap-3 rounded-[20px] border border-border bg-card p-7">
                <svg
                  width="36"
                  height="36"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="var(--accent)"
                  strokeWidth="2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  aria-hidden="true"
                >
                  {q.icon}
                </svg>
                <h3 className="text-[22px] font-semibold">{q.title}</h3>
                <p className="text-muted">{q.body}</p>
              </div>
            ))}
          </div>
        </section>

        <section id="steps" className="border-y border-card bg-band">
          <div className="mx-auto flex max-w-[1200px] flex-col gap-12 px-6 py-24">
            <h2 className="max-w-[760px] font-display text-[36px] leading-[1.05] font-bold tracking-[-0.02em] sm:text-[44px]">
              From low score to fixed, without writing a line of code
            </h2>
            <div className="grid grid-cols-[repeat(auto-fit,minmax(260px,1fr))] gap-5">
              {steps.map((s, i) => (
                <div key={s.title} className="flex flex-col gap-2.5 rounded-[20px] border border-border bg-card p-7">
                  <span className="font-display font-bold text-accent">Step {i + 1}</span>
                  <h3 className="text-[22px] font-semibold">{s.title}</h3>
                  <p className="text-muted">{s.body}</p>
                </div>
              ))}
            </div>
            <div className="flex flex-col gap-3.5">
              <p className="text-muted">Works with the tools you already use</p>
              <ul className="flex flex-wrap gap-2.5">
                {tools.map((t) => (
                  <li key={t} className="rounded-full border border-border-strong px-4 py-2.5">
                    {t}
                  </li>
                ))}
              </ul>
            </div>
          </div>
        </section>

        <section className="mx-auto flex max-w-[1200px] flex-wrap items-center gap-12 px-6 py-24">
          <div className="flex min-w-0 flex-[1_1_420px] flex-col gap-3.5">
            <h2 className="font-display text-[34px] leading-[1.05] font-bold tracking-[-0.02em] sm:text-[40px]">Why it matters now</h2>
            <p className="text-[19px] text-muted">
              More people are asking AI assistants to pick a restaurant, find a mechanic or book a haircut. The assistant recommends the businesses it can
              read, and skips the ones it can’t.
            </p>
            <p className="text-[19px] text-muted">Being readable by AI is becoming what being on Google was twenty years ago.</p>
          </div>
          <div className="flex min-w-0 flex-[1_1_420px] flex-col gap-3 rounded-[20px] bg-card p-7">
            <p className="font-semibold">Things customers ask AI that you want to show up for</p>
            {asks.map((a) => (
              <p key={a} className="max-w-[90%] self-end rounded-[18px_18px_4px_18px] bg-accent px-4 py-3 text-white">
                {a}
              </p>
            ))}
          </div>
        </section>

        <section className="border-t border-card bg-band">
          <div className="mx-auto flex max-w-[900px] flex-col items-center gap-5 px-6 py-[88px] text-center">
            <h2 className="font-display text-[40px] leading-[1.05] font-bold tracking-[-0.02em] sm:text-[48px]">What’s your score?</h2>
            <p className="text-[19px] text-muted">Find out in under a minute. Free, no sign-up.</p>
            <Link href="#check" className="rounded-xl bg-accent px-7 py-4 text-[19px] font-bold text-white hover:brightness-110">
              Get my score
            </Link>
          </div>
        </section>
      </main>

      <SiteFooter origin={origin} />
    </div>
  );
}
