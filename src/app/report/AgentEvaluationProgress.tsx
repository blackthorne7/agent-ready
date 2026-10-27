"use client";

import { useEffect, useState } from "react";

// What the visitor is waiting on: `checklist` while the server reads the site (loading.tsx, a few
// seconds), `agent` while /api/agent runs the AI agent (report-body.tsx, about a minute).
type Stage = "checklist" | "agent";

const MESSAGES: Record<Stage, string[]> = {
  checklist: ["Knock knock! Is your website home?", "Checking the front door...", "Reading your pages...", "Looking for your hours, menu and contact details..."],
  agent: [
    "Our AI agent is trying your site...",
    "Looking for your prices...",
    "Hunting for contact details...",
    "Trying the main action, like booking or ordering...",
    "Crunching the numbers...",
    "Your report is taking shape...",
  ],
};

/** The card shown while a report is being made. The messages rotate on a timer; they don't track real progress. */
export function AgentEvaluationProgress({ stage }: { stage: Stage }) {
  const [messageIndex, setMessageIndex] = useState(0);
  const messages = MESSAGES[stage];

  useEffect(() => {
    // Stops on the last message rather than looping back to the start.
    const timer = window.setInterval(() => setMessageIndex((current) => Math.min(current + 1, messages.length - 1)), 4800);
    return () => window.clearInterval(timer);
  }, [messages.length]);

  return (
    <section className="relative overflow-hidden rounded-3xl border border-border bg-card p-6 sm:p-8" aria-live="polite">
      <div className="flex flex-col gap-5">
        <div>
          <div className="mb-2 flex items-center gap-2 text-sm font-semibold text-accent-text">
            <span className="inline-block h-2 w-2 rounded-full bg-accent progress-live-dot" aria-hidden="true" />
            Live evaluation
          </div>
          <h2 className="font-display text-[28px] font-bold tracking-[-0.02em]">Working on it...</h2>
          <p className="mt-1 text-muted">We&apos;re checking how well AI agents can find, understand and use your website.</p>
        </div>

        <div className="rounded-2xl border border-accent/30 bg-accent-soft p-5">
          <div className="flex items-start gap-3">
            <span className="text-2xl progress-icon" aria-hidden="true">✦</span>
            <div className="min-w-0 flex-1">
              <p key={`${stage}-${messageIndex}`} className="text-xl font-semibold progress-message">{messages[messageIndex]}</p>
              <p className="mt-2 text-sm text-muted">
                {stage === "agent" ? "This takes about a minute. Your results appear here when it's done." : "This takes a few seconds."}
              </p>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
