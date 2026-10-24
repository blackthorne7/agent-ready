"use client";

import { useState } from "react";

/** A site's logo from Context.dev Logo Link; renders nothing if there's no logo. */
export function SiteLogo({ src, size = 32 }: { src: string | null; size?: number }) {
  const [failed, setFailed] = useState(false);
  if (!src || failed) return null;
  return (
    // Plain <img>: next/image would download and re-serve the logo, which Logo Link's terms don't allow.
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src={src}
      alt=""
      width={size}
      height={size}
      loading="lazy"
      onError={() => setFailed(true)}
      style={{ width: size, height: size }}
      className="flex-none rounded-lg bg-white object-contain p-0.5"
    />
  );
}
