import type { MetadataRoute } from "next";

const SITE = "https://polyscope.gudman.xyz";
const API_BASE = process.env.INTERNAL_API_URL || SITE;

export const dynamic = "force-dynamic";
export const revalidate = 3600;

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const now = new Date();

  const staticEntries: MetadataRoute.Sitemap = [
    { url: `${SITE}/`, lastModified: now, changeFrequency: "hourly", priority: 1.0 },
    { url: `${SITE}/smart-money`, lastModified: now, changeFrequency: "hourly", priority: 0.9 },
    { url: `${SITE}/compare`, lastModified: now, changeFrequency: "hourly", priority: 0.9 },
    { url: `${SITE}/traders`, lastModified: now, changeFrequency: "hourly", priority: 0.9 },
    { url: `${SITE}/methodology`, lastModified: now, changeFrequency: "weekly", priority: 0.8 },
    { url: `${SITE}/markets`, lastModified: now, changeFrequency: "hourly", priority: 0.7 },
    { url: `${SITE}/calibration`, lastModified: now, changeFrequency: "daily", priority: 0.6 },
    { url: `${SITE}/portfolio`, lastModified: now, changeFrequency: "weekly", priority: 0.4 },
  ];

  const dynamicEntries: MetadataRoute.Sitemap = [];

  // Top traders by accuracy (publicly worth indexing)
  try {
    const r = await fetch(
      `${API_BASE}/api/traders/leaderboard?order=predictive&limit=50&min_signals=5`,
      { cache: "no-store" }
    );
    if (r.ok) {
      const d = await r.json();
      for (const t of d.traders || []) {
        dynamicEntries.push({
          url: `${SITE}/traders/${t.trader_address}`,
          lastModified: now,
          changeFrequency: "daily",
          priority: 0.5,
        });
      }
    }
  } catch {
    // skip dynamic if unreachable
  }

  return [...staticEntries, ...dynamicEntries];
}
