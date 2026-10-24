"use client";

import { useState } from "react";

/** Copies `text` (or the current page URL when `text` is omitted) to the clipboard. */
export function CopyButton({ text, label, primary = false }: { text?: string; label: string; primary?: boolean }) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      type="button"
      onClick={async () => {
        try {
          await navigator.clipboard.writeText(text ?? window.location.href);
          setCopied(true);
          setTimeout(() => setCopied(false), 2000);
        } catch {
          // Clipboard blocked (e.g. insecure context); the text stays selectable on the page.
        }
      }}
      className={
        primary
          ? "rounded-[10px] bg-accent px-[18px] py-2.5 font-semibold text-white hover:opacity-90"
          : "rounded-[10px] border border-border-strong px-3.5 py-1.5 text-sm font-semibold text-foreground hover:bg-band"
      }
    >
      {copied ? "Copied" : label}
    </button>
  );
}
