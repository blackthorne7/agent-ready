// Usage: pnpm agent <url> "<task>" [maxSteps]
// AGENT_STUB=1 pnpm agent https://example.com "find pricing"

import { runAgent } from "./run";

try {
  process.loadEnvFile(); // optional .env in the project root
} catch {
  // no .env, fine
}

async function main() {
  const [url, task, maxStepsArg] = process.argv.slice(2);
  if (!url || !task) {
    console.error('Usage: pnpm agent <url> "<task>" [maxSteps]');
    process.exit(1);
  }

  const { runId, result } = await runAgent({
    url,
    task,
    maxSteps: maxStepsArg ? Number(maxStepsArg) : undefined,
    onStep: (s) => {
      console.log(`\n#${s.n} ${s.action} ${JSON.stringify(s.args)}`);
      console.log(`   ${s.outcome.toUpperCase()}  ${s.observationSummary}`);
    },
  });

  console.log(`\n=== ${result.status.toUpperCase()} (run ${runId}) ===`);
  console.log(`reason: ${result.reason}`);
  if (result.suggestedFix) console.log(`fix:    ${result.suggestedFix}`);
  process.exit(result.status === "error" ? 1 : 0);
}

void main();
