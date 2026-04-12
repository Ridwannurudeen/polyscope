/**
 * Anonymous client ID for portfolio / watchlist features.
 *
 * Generates a UUID on first visit and persists it in localStorage.
 * No auth, no account — just convenience continuity across visits on
 * the same browser.
 */

const STORAGE_KEY = "polyscope_client_id";

function generateId(): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }
  // Fallback: timestamp + random hex
  return (
    Date.now().toString(36) +
    Math.random().toString(36).slice(2, 10) +
    Math.random().toString(36).slice(2, 10)
  );
}

export function getClientId(): string {
  if (typeof window === "undefined") return "";
  try {
    const existing = window.localStorage.getItem(STORAGE_KEY);
    if (existing && existing.length >= 8) return existing;
    const fresh = generateId();
    window.localStorage.setItem(STORAGE_KEY, fresh);
    return fresh;
  } catch {
    // Private mode / storage blocked — ephemeral
    return generateId();
  }
}
