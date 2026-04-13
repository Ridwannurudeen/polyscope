import type { Metadata } from "next";
import localFont from "next/font/local";
import Link from "next/link";
import { Suspense } from "react";
import "./globals.css";
import { MobileNav } from "@/components/mobile-nav";
import { PageViewTracker } from "@/components/page-view-tracker";
import { SearchBar } from "@/components/search-bar";

const geistSans = localFont({
  src: "./fonts/GeistVF.woff",
  variable: "--font-geist-sans",
  weight: "100 900",
});
const geistMono = localFont({
  src: "./fonts/GeistMonoVF.woff",
  variable: "--font-geist-mono",
  weight: "100 900",
});

export const metadata: Metadata = {
  title: "PolyScope — Intelligence terminal for Polymarket",
  description:
    "Divergence scanner, trader accuracy leaderboard, and evidence-backed decision cards for Polymarket. We measure who's actually predictive, not just profitable.",
  openGraph: {
    title: "PolyScope — Intelligence terminal for Polymarket",
    description:
      "Divergence scanner, trader accuracy leaderboard, and evidence-backed decision cards for Polymarket.",
    url: "https://polyscope.gudman.xyz",
    siteName: "PolyScope",
    type: "website",
  },
  twitter: {
    card: "summary_large_image",
    title: "PolyScope — Intelligence terminal for Polymarket",
    description:
      "We measure which Polymarket traders are actually predictive, not just profitable.",
  },
};

const NAV_ITEMS = [
  { href: "/", label: "Dashboard" },
  { href: "/markets", label: "Markets" },
  { href: "/smart-money", label: "Smart Money" },
  { href: "/traders", label: "Traders" },
  { href: "/compare", label: "Compare" },
  { href: "/portfolio", label: "Portfolio" },
  { href: "/calibration", label: "Calibration" },
  { href: "/methodology", label: "Methodology" },
  { href: "/api/docs", label: "API", external: true },
];

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" className="dark">
      <body
        className={`${geistSans.variable} ${geistMono.variable} antialiased bg-gray-950 text-gray-100 min-h-screen`}
      >
        <Suspense fallback={null}>
          <PageViewTracker />
        </Suspense>
        <nav className="border-b border-gray-800 bg-gray-950/80 backdrop-blur-sm sticky top-0 z-50">
          <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
            <div className="flex items-center justify-between h-16">
              <Link href="/" className="flex items-center gap-2">
                <span className="text-xl font-bold text-white">PolyScope</span>
                <span className="text-xs bg-emerald-500/20 text-emerald-400 px-2 py-0.5 rounded-full">
                  BETA
                </span>
              </Link>
              <div className="hidden md:flex items-center gap-1 flex-1 justify-center">
                {NAV_ITEMS.map((item) =>
                  item.external ? (
                    <a
                      key={item.href}
                      href={item.href}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="px-2 py-2 text-sm text-gray-400 hover:text-white hover:bg-gray-800 rounded-lg transition-colors"
                    >
                      {item.label}
                    </a>
                  ) : (
                    <Link
                      key={item.href}
                      href={item.href}
                      className="px-2 py-2 text-sm text-gray-400 hover:text-white hover:bg-gray-800 rounded-lg transition-colors"
                    >
                      {item.label}
                    </Link>
                  )
                )}
              </div>
              <div className="hidden md:block">
                <SearchBar />
              </div>
              <MobileNav items={NAV_ITEMS} />
            </div>
          </div>
        </nav>
        <main className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
          {children}
        </main>
        <footer className="border-t border-gray-800 mt-16 py-8">
          <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
            <p className="text-xs text-gray-500 text-center">
              PolyScope provides market intelligence only. It does not
              facilitate, recommend, or enable participation in prediction
              markets.
            </p>
          </div>
        </footer>
      </body>
    </html>
  );
}
