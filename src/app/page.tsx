import { headers } from "next/headers";
import { AuditForm } from "./audit-form";

const pillars = [
  { title: "Can agents get in?", body: "robots.txt rules for AI agents, bot walls and CAPTCHAs, server-rendered content, llms.txt, sitemap." },
  { title: "Can agents understand it?", body: "schema.org data for your business, hours, location, menu, products, prices and contact details." },
  { title: "Can agents take action?", body: "MCP, A2A or OpenAPI endpoints, declared order/reserve actions, and labeled forms agents can fill in." },
];

export default async function Home() {
  const host = (await headers()).get("host") ?? "localhost:3000";
  const origin = `${host.startsWith("localhost") ? "http" : "https"}://${host}`;
  return (
    <main className="mx-auto flex min-h-screen max-w-3xl flex-col gap-12 px-4 py-16 sm:py-24">
      <header className="flex flex-col gap-4">
        <p className="font-mono text-sm text-emerald-600">agent ready</p>
        <h1 className="text-4xl font-semibold tracking-tight sm:text-5xl">Is your website ready for AI agents?</h1>
        <p className="text-lg text-muted">
          People are starting to ask Claude and ChatGPT to check opening hours, read menus and place orders. Find out whether agents can actually do that on
          your site, and get the fixes.
        </p>
        <AuditForm />
      </header>

      <section className="grid gap-4 sm:grid-cols-3">
        {pillars.map((p) => (
          <div key={p.title} className="rounded-xl border border-border bg-card p-5">
            <h2 className="font-medium">{p.title}</h2>
            <p className="mt-2 text-sm text-muted">{p.body}</p>
          </div>
        ))}
      </section>

      <section className="rounded-xl border border-border bg-card p-5">
        <h2 className="font-medium">Use it from Claude (MCP)</h2>
        <p className="mt-2 text-sm text-muted">
          Add this server to any MCP client to get the <code className="font-mono">audit_site</code> and{" "}
          <code className="font-mono">generate_fixes</code> tools:
        </p>
        <pre className="mt-3 overflow-x-auto rounded-lg bg-background p-3 font-mono text-sm">claude mcp add --transport http agent-ready {origin}/api/mcp</pre>
      </section>
    </main>
  );
}
