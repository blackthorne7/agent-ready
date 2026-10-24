import { AgentEvaluationProgress } from "./AgentEvaluationProgress";
import { SiteFooter, SiteHeader } from "../ui";

/** Shown while the existing report and graph are being generated. */
export default function Loading() {
  return (
    <div className="text-[17px] leading-[1.55]">
      <SiteHeader />
      <main className="mx-auto flex max-w-[1040px] flex-col gap-10 px-6 py-12">
        <AgentEvaluationProgress mode="demo" />
      </main>
      <SiteFooter />
    </div>
  );
}
