"use client";

import { useEffect } from "react";

/**
 * Asks /api/agent to record a blocked site for the leaderboard (no score; the server re-checks
 * the block itself). Like the agent run, it starts from the browser, so the report page never saves.
 */
export function RecordBlocked({ url }: { url: string }) {
  useEffect(() => {
    fetch("/api/agent", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ url, blocked: true }),
    }).catch(() => {
      // Best effort: the report is already on screen, and the leaderboard can miss one row.
    });
  }, [url]);
  return null;
}
