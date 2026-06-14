"use client";

import { useEffect, useState } from "react";

/** Tracks the compact-layout breakpoint (≤1024px: phones + tablets), matching prototype.css. */
export function useIsMobile(query = "(max-width: 1024px)"): boolean {
  const [mobile, setMobile] = useState(false);
  useEffect(() => {
    const mq = window.matchMedia(query);
    const update = () => setMobile(mq.matches);
    update();
    mq.addEventListener("change", update);
    return () => mq.removeEventListener("change", update);
  }, [query]);
  return mobile;
}
