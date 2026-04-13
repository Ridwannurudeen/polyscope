"use client";

import { usePathname, useSearchParams } from "next/navigation";
import { useEffect } from "react";
import { trackPageView } from "@/lib/analytics";

/**
 * Mounts once at the root layout; re-fires on every route change so we
 * get accurate page-view counts on an SPA-style Next app.
 */
export function PageViewTracker() {
  const pathname = usePathname();
  const searchParams = useSearchParams();

  useEffect(() => {
    trackPageView();
    // Re-track when route changes (pathname or search params)
  }, [pathname, searchParams]);

  return null;
}
