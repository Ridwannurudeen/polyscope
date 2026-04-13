import type { Metadata } from "next";

const SITE = "https://polyscope.gudman.xyz";
const OG = `${SITE}/og/methodology`;
const URL = `${SITE}/methodology`;

export const metadata: Metadata = {
  title: "Methodology — PolyScope",
  description:
    "How PolyScope generates signals, the honest dataset breakdown, and why a 95% headline doesn't mean tradeable alpha.",
  openGraph: {
    title: "PolyScope Methodology — the honest version",
    description:
      "The 95% headline win-rate is mostly a composition effect. The breakdown by market skew shows where real edge would have to live.",
    url: URL,
    siteName: "PolyScope",
    images: [{ url: OG, width: 1200, height: 630 }],
    type: "article",
  },
  twitter: {
    card: "summary_large_image",
    title: "PolyScope Methodology — the honest version",
    description:
      "Why a 95% headline win-rate doesn't mean tradeable alpha.",
    images: [OG],
  },
};

export default function MethodologyLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return <>{children}</>;
}
