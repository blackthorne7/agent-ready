import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";

// Only /api/agent saves a score (docs/one-final-score.md). These point the app at a fake Supabase and
// record what reaches it. Set before ./supabase is first imported: it reads the address once, when it loads.
const FAKE_SUPABASE = "https://test-project.supabase.co";
process.env.SUPABASE_URL = FAKE_SUPABASE;
process.env.NEXT_PUBLIC_SUPABASE_URL = FAKE_SUPABASE;
process.env.SUPABASE_SERVICE_ROLE_KEY = "test-service-key";

// A public IP literal, so the SSRF guard doesn't need DNS; the fetch below never leaves the process.
const SITE = "http://93.184.216.34/";

const realFetch = globalThis.fetch;
let supabaseRequests: string[] = [];

before(() => {
  globalThis.fetch = (async (input: Request | string | URL, init?: RequestInit) => {
    const url = input instanceof Request ? input.url : String(input);
    if (url.startsWith(FAKE_SUPABASE)) {
      supabaseRequests.push(`${init?.method ?? "GET"} ${url}`);
      return Response.json({ id: "business-1" });
    }
    return new Response("<html><head><title>Test Cafe</title></head><body><h1>Test Cafe</h1><p>Open daily 9-5.</p></body></html>", {
      status: 200,
      headers: { "content-type": "text/html" },
    });
  }) as typeof fetch;
});
after(() => {
  globalThis.fetch = realFetch;
});

const headersFor = (ip: string) => ({ "content-type": "application/json", "x-forwarded-for": ip });

describe("checklist audits aren't saved to the leaderboard", () => {
  it("control: saving a scored report does reach Supabase, so the checks below can fail", async () => {
    const { runAudit } = await import("./audit");
    const { saveAudit } = await import("./audit/save");
    const report = await runAudit(SITE);
    assert.notEqual(report.score, null, "the test site should get a checklist score");
    supabaseRequests = [];
    await saveAudit(report);
    assert.ok(supabaseRequests.length > 0, "saveAudit should have written to the fake Supabase");
  });

  it("GET /api/audit returns the report without saving it", async () => {
    const { GET } = await import("../app/api/audit/route");
    supabaseRequests = [];
    const res = await GET(new Request(`http://localhost/api/audit?url=${SITE}`, { headers: headersFor("192.0.2.81") }));
    assert.equal(res.status, 200);
    assert.notEqual((await res.json()).score, null);
    assert.deepEqual(supabaseRequests, []);
  });

  it("POST /api/audit returns the report without saving it", async () => {
    const { POST } = await import("../app/api/audit/route");
    supabaseRequests = [];
    const res = await POST(new Request("http://localhost/api/audit", { method: "POST", headers: headersFor("192.0.2.82"), body: JSON.stringify({ url: SITE }) }));
    assert.equal(res.status, 200);
    assert.notEqual((await res.json()).score, null);
    assert.deepEqual(supabaseRequests, []);
  });

  it("the MCP audit_site tool returns the report without saving it", async () => {
    const { POST } = await import("../app/api/mcp/route");
    supabaseRequests = [];
    const res = await POST(
      new Request("http://localhost/api/mcp", {
        method: "POST",
        headers: { ...headersFor("192.0.2.83"), accept: "application/json, text/event-stream" },
        body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/call", params: { name: "audit_site", arguments: { url: SITE } } }),
      }),
    );
    const text = await res.text();
    assert.equal(res.status, 200);
    assert.match(text, /rubricVersion/, "the tool should have returned a report");
    assert.deepEqual(supabaseRequests, []);
  });
});
