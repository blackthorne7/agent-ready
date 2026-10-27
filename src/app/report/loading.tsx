import { AgentEvaluationProgress } from "./AgentEvaluationProgress";
import { SiteFooter, SiteHeader } from "../ui";

/** Shown while the server runs the checklist (page.tsx), before the agent starts. */
export default function Loading() {
  return (
    <div className="text-[17px] leading-[1.55]">
      <SiteHeader />
      <main className="mx-auto flex max-w-[1040px] flex-col gap-10 px-6 py-12">
        <AgentEvaluationProgress stage="checklist" />
      </main>
      <SiteFooter />
    </div>
  );
}
