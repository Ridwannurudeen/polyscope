import type { Metadata } from "next";

const SITE = "https://polyscope.gudman.xyz";
const API_BASE =
  process.env.INTERNAL_API_URL || process.env.NEXT_PUBLIC_API_BASE || SITE;

export async function generateMetadata({
  params,
}: {
  params: { id: string };
}): Promise<Metadata> {
  let title = "Market — PolyScope";
  let description =
    "Counter-consensus signal with full evidence trail on PolyScope.";

  // Note: title and description are intentionally `let` because they
  // get conditionally reassigned below from the fetched signal.

  try {
    const r = await fetch(`${API_BASE}/api/signals/evidence/${params.id}`, {
      cache: "no-store",
    });
    if (r.ok) {
      const d = await r.json();
      if (d && !d.error && d.signal?.question) {
        title = `${d.signal.question} — PolyScope`;
        const dir = d.signal.sm_direction;
        const divPct = Math.round((d.signal.divergence_pct || 0) * 100);
        description = `PolyScope view: ${dir}. Crowd vs PolyScope ${divPct}% divergence on this Polymarket market.`;
      }
    }
  } catch {
    // Use defaults
  }

  const ogUrl = `${SITE}/og/signal/${params.id}`;
  const pageUrl = `${SITE}/market/${params.id}`;

  return {
    title,
    description,
    openGraph: {
      title,
      description,
      url: pageUrl,
      siteName: "PolyScope",
      images: [{ url: ogUrl, width: 1200, height: 630 }],
      type: "website",
    },
    twitter: {
      card: "summary_large_image",
      title,
      description,
      images: [ogUrl],
    },
  };
}

export default function MarketLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return <>{children}</>;
}
