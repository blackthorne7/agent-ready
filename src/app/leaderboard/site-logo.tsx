"use client";

import { useState } from "react";

/** A site's logo from Context.dev Logo Link; renders nothing if there's no logo. */
export function SiteLogo({ src }: { src: string | null }) {
  const [failed, setFailed] = useState(false);
  if (!src || failed) return null;
  return (
    // Plain <img>: next/image would download and re-serve the logo, which Logo Link's terms don't allow.
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src={src}
      alt=""
      width={32}
      height={32}
      loading="lazy"
      onError={() => setFailed(true)}
      className="h-8 w-8 flex-none rounded-lg bg-white object-contain p-0.5"
    />
  );
}
