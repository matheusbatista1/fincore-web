"use client";

import { useEffect, useState } from "react";

/** Tracks the prototype's mobile breakpoint (≤820px, matching mobile.css). */
export function useIsMobile(query = "(max-width: 820px)"): boolean {
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
