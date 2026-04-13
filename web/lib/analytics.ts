/**
 * Lightweight self-hosted analytics.
 *
 * All events are fire-and-forget POSTs to /api/events. No third-party
 * scripts, no cookies beyond our own localStorage client_id, no PII.
 */

import { getClientId } from "@/lib/client-id";

type EventProperties = Record<string, string | number | boolean | null>;

export function trackEvent(eventType: string, properties?: EventProperties) {
  if (typeof window === "undefined") return;

  const body = JSON.stringify({
    event_type: eventType,
    client_id: getClientId() || null,
    properties: properties || null,
    path: window.location.pathname + window.location.search,
    referrer: document.referrer || null,
  });

  // Prefer sendBeacon so events still fire on navigation away.
  try {
    if (navigator.sendBeacon) {
      const blob = new Blob([body], { type: "application/json" });
      navigator.sendBeacon("/api/events", blob);
      return;
    }
  } catch {
    // fall through to fetch
  }

  // Fetch fallback with keepalive for the same navigation-safe behavior.
  fetch("/api/events", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body,
    keepalive: true,
  }).catch(() => {});
}

/**
 * Hook-friendly page view tracking. Call once on mount of a page.
 */
export function trackPageView(extra?: EventProperties) {
  trackEvent("page_view", extra);
}
