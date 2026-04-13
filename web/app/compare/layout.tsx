import type { Metadata } from "next";

const SITE = "https://polyscope.gudman.xyz";
const OG = `${SITE}/og/compare`;
const URL = `${SITE}/compare`;

export const metadata: Metadata = {
  title: "P&L vs Accuracy — PolyScope",
  description:
    "Polymarket ranks traders by profit. PolyScope ranks them by predictive accuracy when they diverge from the crowd. Side-by-side comparison of the two leaderboards.",
  openGraph: {
    title: "Polymarket P&L vs PolyScope Accuracy",
    description:
      "P&L is not predictive accuracy. See which leaderboard leaders are actually right when they diverge from the market.",
    url: URL,
    siteName: "PolyScope",
    images: [{ url: OG, width: 1200, height: 630 }],
    type: "website",
  },
  twitter: {
    card: "summary_large_image",
    title: "Polymarket P&L vs PolyScope Accuracy",
    description:
      "P&L is not predictive accuracy. See the side-by-side.",
    images: [OG],
  },
};

export default function CompareLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return <>{children}</>;
}
