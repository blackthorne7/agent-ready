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

type StageCopy = {
  icon: string;
  message: string;
  rotating: string[];
};

const STAGE_COPY: Record<string, StageCopy> = {
  connecting: {
    icon: "ðŸ”Œ",
    message: "Waking up your AI agent...",
    rotating: ["Booting up the brain...", "Getting things ready...", "Your agent is almost online..."],
  },
  connection: {
    icon: "ðŸ‘€",
    message: "Knock knock! Anybody home?",
    rotating: ["Checking the front door...", "Seeing if the website answers...", "Making contact..."],
  },
  preparing: {
    icon: "ðŸ§ ",
    message: "Cooking up some brain teasers...",
    rotating: ["Planning a few challenges...", "Setting the test bench...", "Preparing the questions..."],
  },
  running: {
    icon: "ðŸš€",
    message: "Let's see what you've got!",
    rotating: [
      "Time for some brain gymnastics!",
      "Giving your agent a little challenge...",
      "Let's see how clever this agent really is...",
      "Putting its skills to the test!",
    ],
  },
  reasoning: {
    icon: "ðŸ•µï¸",
    message: "Putting those brain cells to work...",
    rotating: ["Following the logic...", "Checking how it thinks...", "Looking for clever answers..."],
  },
  tools: {
    icon: "ðŸ› ï¸",
    message: "Testing your agent's superpowers...",
    rotating: ["Trying its tools...", "Checking what it can actually do...", "Seeing if it can take action..."],
  },
  analyzing: {
    icon: "ðŸ”¬",
    message: "Looking under the hood...",
    rotating: ["Reading between the lines...", "Comparing the answers...", "Spotting strengths and gaps..."],
  },
  reliability: {
    icon: "ðŸ’ª",
    message: "Can your agent handle the pressure?",
    rotating: ["Trying a few curveballs...", "Checking consistency...", "Making sure it doesn't panic..."],
  },
  scoring: {
    icon: "ðŸ“Š",
    message: "Crunching the numbers...",
    rotating: ["Adding everything up...", "Turning answers into insights...", "Finalizing the evaluation..."],
  },
  report: {
    icon: "âœ¨",
    message: "The verdict is almost ready!",
    rotating: ["Putting the finishing touches on your report...", "Making the results easy to understand...", "Your report is taking shape..."],
  },
};

const DEFAULT_STAGES: EvaluationStage[] = [
  ["connecting", "Connecting"],
  ["connection", "Checking connection"],
  ["preparing", "Preparing tests"],
  ["running", "Running tests"],
  ["reasoning", "Testing reasoning"],
  ["tools", "Checking tools"],
  ["analyzing", "Analyzing responses"],
  ["reliability", "Checking reliability"],
  ["scoring", "Calculating scores"],
  ["report", "Generating report"],
].map(([id, title]) => ({ id, title, status: "pending" }));

export function AgentEvaluationProgress({ mode = "demo", stages = DEFAULT_STAGES }: { mode?: "demo" | "live"; stages?: EvaluationStage[] }) {
  const [demoStage, setDemoStage] = useState(0);
  const [messageIndex, setMessageIndex] = useState(0);
  const [expanded, setExpanded] = useState<string | null>(null);

  const visibleStages = useMemo(() => {
    if (mode === "live") return stages;
    return stages.map((stage, index) => {
      const status: EvaluationStageStatus = index < demoStage ? "complete" : index === demoStage ? "active" : "pending";
      return {
        ...stage,
        status,
        detail: "Demo simulation â€” live technical details will appear here when the backend provides them.",
      };
    });
  }, [demoStage, mode, stages]);

  const activeIndex = visibleStages.findIndex((stage) => stage.status === "active");
  const activeStage = activeIndex >= 0 ? visibleStages[activeIndex] : undefined;
  const activeCopy = activeStage ? STAGE_COPY[activeStage.id] ?? STAGE_COPY.running : undefined;
  const finished = visibleStages.length > 0 && visibleStages.every((stage) => stage.status === "complete");
  const displayStart = Math.max(0, (activeIndex >= 0 ? activeIndex : visibleStages.length) - 2);
  const displayStages = visibleStages.slice(displayStart, displayStart + 3);

  useEffect(() => {
    if (mode !== "demo" || finished) return;
    const timer = window.setInterval(() => setDemoStage((current) => Math.min(current + 1, visibleStages.length)), 5200);
    return () => window.clearInterval(timer);
  }, [finished, mode, visibleStages.length]);

  useEffect(() => {
    setMessageIndex(0);
  }, [activeStage?.id]);

  useEffect(() => {
    if (!activeCopy || activeCopy.rotating.length < 2) return;
    const timer = window.setInterval(() => setMessageIndex((current) => (current + 1) % activeCopy.rotating.length), 4800);
    return () => window.clearInterval(timer);
  }, [activeCopy]);

  return (
    <section className="relative overflow-hidden rounded-3xl border border-border bg-card p-6 sm:p-8" aria-live="polite">
      {finished && <Celebration />}
      <div className="relative z-10 flex flex-col gap-6">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <div className="mb-2 flex items-center gap-2 text-sm font-semibold text-accent-text">
              <span className="inline-block h-2 w-2 rounded-full bg-accent progress-live-dot" aria-hidden="true" />
              {mode === "demo" ? "Demo evaluation" : "Live evaluation"}
            </div>
            <h2 className="font-display text-[28px] font-bold tracking-[-0.02em]">Your agent is getting ready</h2>
            <p className="mt-1 text-muted">We&apos;re checking how well it can understand and act on your website.</p>
          </div>
          {mode === "demo" && <span className="rounded-full bg-accent-soft px-3 py-1 text-xs font-semibold text-accent-text">Simulated progress</span>}
        </div>

        {activeStage && activeCopy && !finished && (
          <div className="rounded-2xl border border-accent/30 bg-accent-soft p-5">
            <div className="flex items-start gap-3">
              <span className="text-2xl progress-icon" aria-hidden="true">{activeCopy.icon}</span>
              <div className="min-w-0">
                <p className="text-sm text-accent-text">{activeStage.title}</p>
                <p key={`${activeStage.id}-${messageIndex}`} className="mt-1 text-xl font-semibold progress-message">
                  {messageIndex === 0 ? activeCopy.message : activeCopy.rotating[messageIndex]}
                </p>
                <p className="mt-2 text-sm text-muted">{mode === "demo" ? "Demo activity is being simulated while the backend connection is unavailable." : "Waiting for the next confirmed backend update."}</p>
              </div>
            </div>
          </div>
        )}

        {finished && (
          <div className="rounded-2xl border border-good/30 bg-good-bg p-5">
            <p className="text-xl font-semibold">ðŸŽ‰ Mission accomplished! Your results are ready.</p>
          </div>
        )}

        <div className="flex flex-col gap-2" role="list" aria-label="Evaluation stages">
          {displayStages.map((stage) => {
            const copy = STAGE_COPY[stage.id] ?? STAGE_COPY.running;
            const hasDetails = Boolean(stage.detail);
            return (
              <div key={stage.id} role="listitem" className={`rounded-2xl border transition-all ${stage.status === "active" ? "border-accent/40 bg-accent-soft/50" : stage.status === "complete" ? "border-border bg-band/40 opacity-50 grayscale" : "border-border bg-band/40"}`}>
                <div className="flex items-center gap-3 px-4 py-3">
                  <StatusIcon status={stage.status} icon={copy.icon} />
                  <span className={`min-w-0 flex-1 font-medium ${stage.status === "pending" ? "text-muted" : "text-foreground"}`}>{stage.title}</span>
                  {hasDetails && (
                    <button type="button" className="rounded-lg px-2 py-1 text-sm text-muted hover:bg-card hover:text-foreground" aria-expanded={expanded === stage.id} onClick={() => setExpanded((current) => (current === stage.id ? null : stage.id))}>
                      {expanded === stage.id ? "Hide details" : "Details"}
                    </button>
                  )}
                </div>
                {expanded === stage.id && stage.detail && <div className="border-t border-border px-4 py-3 font-mono text-xs leading-relaxed text-muted">{stage.detail}</div>}
              </div>
            );
          })}
        </div>
      </div>
    </section>
  );
}

function StatusIcon({ status, icon }: { status: EvaluationStageStatus; icon: string }) {
  if (status === "complete") return <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-good-bg text-good" aria-label="Complete">âœ“</span>;
  if (status === "error") return <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-bad-bg text-bad" aria-label="Error">!</span>;
  return <span className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-full ${status === "active" ? "bg-accent text-white progress-icon" : "bg-card text-muted"}`} aria-label={status === "active" ? "In progress" : "Not started"}>{status === "active" ? icon : "Â·"}</span>;
}

function Celebration() {
  return <div className="pointer-events-none absolute inset-0 overflow-hidden" aria-hidden="true">{Array.from({ length: 12 }, (_, index) => <span key={index} className="celebration-piece" style={{ left: `${8 + index * 8}%`, animationDelay: `${index * 90}ms` }} />)}</div>;
}


