"use client";

import { useEffect, useMemo, useState } from "react";

export type EvaluationStageStatus = "pending" | "active" | "complete" | "error";

export type EvaluationStage = {
  id: string;
  title: string;
  status: EvaluationStageStatus;
  /** Technical information supplied by the backend. */
  detail?: string;
};

type StageCopy = { message: string; rotating: string[] };

const STAGE_COPY: Record<string, StageCopy> = {
  connecting: { message: "Waking up your AI agent...", rotating: ["Booting up the brain...", "Getting things ready...", "Your agent is almost online..."] },
  connection: { message: "Knock knock! Anybody home?", rotating: ["Checking the front door...", "Seeing if the website answers...", "Making contact..."] },
  preparing: { message: "Cooking up some brain teasers...", rotating: ["Planning a few challenges...", "Setting the test bench...", "Preparing the questions..."] },
  running: { message: "Let's see what you've got!", rotating: ["Time for some brain gymnastics!", "Giving your agent a little challenge...", "Putting its skills to the test!"] },
  reasoning: { message: "Putting those brain cells to work...", rotating: ["Following the logic...", "Checking how it thinks...", "Looking for clever answers..."] },
  tools: { message: "Testing your agent's superpowers...", rotating: ["Trying its tools...", "Checking what it can actually do...", "Seeing if it can take action..."] },
  analyzing: { message: "Looking under the hood...", rotating: ["Reading between the lines...", "Comparing the answers...", "Spotting strengths and gaps..."] },
  reliability: { message: "Can your agent handle the pressure?", rotating: ["Trying a few curveballs...", "Checking consistency...", "Making sure it doesn't panic..."] },
  scoring: { message: "Crunching the numbers...", rotating: ["Adding everything up...", "Turning answers into insights...", "Finalizing the evaluation..."] },
  report: { message: "The verdict is almost ready!", rotating: ["Putting the finishing touches on your report...", "Making the results easy to understand...", "Your report is taking shape..."] },
};

const DEFAULT_STAGES: EvaluationStage[] = [
  ["connecting", "Connecting"], ["connection", "Checking connection"], ["preparing", "Preparing tests"],
  ["running", "Running tests"], ["reasoning", "Testing reasoning"], ["tools", "Checking tools"],
  ["analyzing", "Analyzing responses"], ["reliability", "Checking reliability"], ["scoring", "Calculating scores"],
  ["report", "Generating report"],
].map(([id, title]) => ({ id, title, status: "pending" }));

const DEMO_MESSAGES = Object.values(STAGE_COPY).flatMap((copy) => [copy.message, ...copy.rotating.slice(0, 2)]);

export function AgentEvaluationProgress({ mode = "demo", stages = DEFAULT_STAGES }: { mode?: "demo" | "live"; stages?: EvaluationStage[] }) {
  const [demoStage, setDemoStage] = useState(0);
  const [messageIndex, setMessageIndex] = useState(0);
  const [detailsOpen, setDetailsOpen] = useState(false);

  const currentStages = useMemo(() => {
    if (mode === "live") return stages;
    return stages.map((stage, index) => ({
      ...stage,
      status: index < demoStage ? "complete" : index === demoStage ? "active" : "pending",
      detail: "Demo simulation — live technical details will appear here when the backend provides them.",
    }));
  }, [demoStage, mode, stages]);

  const activeStage = currentStages.find((stage) => stage.status === "active");
  const finished = currentStages.length > 0 && currentStages.every((stage) => stage.status === "complete");
  const liveCopy = activeStage ? STAGE_COPY[activeStage.id] ?? STAGE_COPY.running : STAGE_COPY.running;
  const messages = mode === "demo" ? DEMO_MESSAGES : [liveCopy.message, ...liveCopy.rotating];
  const currentMessage = messages[messageIndex % messages.length];
  const technicalDetail = activeStage?.detail;

  useEffect(() => {
    if (mode !== "demo" || finished) return;
    const timer = window.setInterval(() => setDemoStage((current) => Math.min(current + 1, currentStages.length)), 5200);
    return () => window.clearInterval(timer);
  }, [currentStages.length, finished, mode]);

  useEffect(() => {
    if (finished) return;
    const timer = window.setInterval(() => setMessageIndex((current) => current + 1), 4800);
    return () => window.clearInterval(timer);
  }, [finished]);

  useEffect(() => {
    if (mode === "live") setMessageIndex(0);
  }, [activeStage?.id, mode]);

  return (
    <section className="relative overflow-hidden rounded-3xl border border-border bg-card p-6 sm:p-8" aria-live="polite">
      {finished && <Celebration />}
      <div className="relative z-10 flex flex-col gap-5">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <div className="mb-2 flex items-center gap-2 text-sm font-semibold text-accent-text">
              <span className="inline-block h-2 w-2 rounded-full bg-accent progress-live-dot" aria-hidden="true" />
              {mode === "demo" ? "Demo evaluation" : "Live evaluation"}
            </div>
            <h2 className="font-display text-[28px] font-bold tracking-[-0.02em]">Working on it...</h2>
            <p className="mt-1 text-muted">We&apos;re checking how well your agent can understand and act on the website.</p>
          </div>
          {mode === "demo" && <span className="rounded-full bg-accent-soft px-3 py-1 text-xs font-semibold text-accent-text">Simulated progress</span>}
        </div>

        {finished ? (
          <div className="rounded-2xl border border-good/30 bg-good-bg p-5">
            <p className="text-xl font-semibold">Mission accomplished! Your results are ready.</p>
          </div>
        ) : (
          <div className="rounded-2xl border border-accent/30 bg-accent-soft p-5">
            <div className="flex items-start gap-3">
              <span className="text-2xl progress-icon" aria-hidden="true">✦</span>
              <div className="min-w-0 flex-1">
                <p key={`${mode}-${messageIndex}`} className="text-xl font-semibold progress-message">{currentMessage}</p>
                <p className="mt-2 text-sm text-muted">
                  {mode === "demo" ? "Demo activity is being simulated while the backend connection is unavailable." : "We'll show the results as soon as the evaluation is complete."}
                </p>
              </div>
            </div>
          </div>
        )}

        {technicalDetail && (
          <div>
            <button type="button" className="text-sm text-muted underline-offset-4 hover:text-foreground hover:underline" aria-expanded={detailsOpen} onClick={() => setDetailsOpen((open) => !open)}>
              {detailsOpen ? "Hide technical details" : "View technical details"}
            </button>
            {detailsOpen && <div className="mt-3 rounded-xl bg-band p-4 font-mono text-xs leading-relaxed text-muted">{technicalDetail}</div>}
          </div>
        )}
      </div>
    </section>
  );
}

function Celebration() {
  return <div className="pointer-events-none absolute inset-0 overflow-hidden" aria-hidden="true">{Array.from({ length: 12 }, (_, index) => <span key={index} className="celebration-piece" style={{ left: `${8 + index * 8}%`, animationDelay: `${index * 90}ms` }} />)}</div>;
}
