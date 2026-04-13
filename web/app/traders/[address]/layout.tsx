import type { Metadata } from "next";

const SITE = "https://polyscope.gudman.xyz";
const API_BASE =
  process.env.INTERNAL_API_URL || process.env.NEXT_PUBLIC_API_BASE || SITE;

function shortAddr(addr: string) {
  return `${addr.slice(0, 6)}…${addr.slice(-4)}`;
}

export async function generateMetadata({
  params,
}: {
  params: { address: string };
}): Promise<Metadata> {
  const title = `${shortAddr(params.address)} — PolyScope trader profile`;
  let description = "Predictive accuracy for this Polymarket trader.";

  try {
    const r = await fetch(`${API_BASE}/api/traders/${params.address}`, {
      cache: "no-store",
    });
    if (r.ok) {
      const d = await r.json();
      if (d && !d.error) {
        const acc = d.accuracy_pct;
        const total = d.total_divergent_signals || 0;
        if (acc !== null && acc !== undefined) {
          description = `${acc.toFixed(0)}% accuracy across ${total} divergent signals on Polymarket. Per-trader scoring based on resolved outcomes.`;
        }
      }
    }
  } catch {
    // defaults
  }

  const ogUrl = `${SITE}/og/trader/${params.address}`;
  const pageUrl = `${SITE}/traders/${params.address}`;

  return {
    title,
    description,
    openGraph: {
      title,
      description,
      url: pageUrl,
      siteName: "PolyScope",
      images: [{ url: ogUrl, width: 1200, height: 630 }],
      type: "profile",
    },
    twitter: {
      card: "summary_large_image",
      title,
      description,
      images: [ogUrl],
    },
  };
}

export default function TraderLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return <>{children}</>;
}
