import type { Metadata } from "next";
import localFont from "next/font/local";
import Link from "next/link";
import { Suspense } from "react";
import "./globals.css";
import { ConnectWallet } from "@/components/connect-wallet";
import { Wordmark } from "@/components/logo";
import { MobileNav } from "@/components/mobile-nav";
import { PageViewTracker } from "@/components/page-view-tracker";
import { SearchBar } from "@/components/search-bar";
import { ThemeToggle } from "@/components/theme-toggle";
import { Web3Provider } from "@/lib/web3-provider";

/**
 * Pre-paint theme script — runs synchronously in <head> before any
 * stylesheet or component, so users with a saved light preference
 * never see a dark→light flash. Mirrors the logic in ThemeToggle.
 */
const themePrePaintScript = `
(function() {
  try {
    var t = localStorage.getItem('polyscope.theme');
    if (t === 'light' || t === 'dark') {
      document.documentElement.setAttribute('data-theme', t);
    }
  } catch (e) {}
})();
`;

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
  { href: "/", label: "terminal" },
  { href: "/smart-money", label: "signals" },
  { href: "/traders", label: "traders" },
  { href: "/markets", label: "markets" },
  { href: "/portfolio", label: "portfolio" },
  { href: "/calibration", label: "calibration" },
  { href: "/methodology", label: "methodology" },
  { href: "/api/docs", label: "api", external: true },
];

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        <script
          dangerouslySetInnerHTML={{ __html: themePrePaintScript }}
        />
      </head>
      <body
        className={`${geistSans.variable} ${geistMono.variable} antialiased min-h-screen`}
      >
        <Web3Provider>
          <Suspense fallback={null}>
            <PageViewTracker />
          </Suspense>

          <header className="border-b border-ink-700 bg-background/85 backdrop-blur-md sticky top-0 z-50">
            <div className="max-w-[1440px] mx-auto px-4 sm:px-6 lg:px-10">
              <div className="flex items-center justify-between h-14">
                <Link href="/" className="flex items-center gap-2 group">
                  <Wordmark variant="crosshair" size={18} />
                  <span className="eyebrow text-scope-500 ml-1.5 border border-scope-500/35 px-1.5 py-[1px] rounded-sm bg-scope-500/8">
                    beta
                  </span>
                </Link>

                <nav className="hidden lg:flex items-center gap-0.5 flex-1 justify-center">
                  {NAV_ITEMS.map((item) =>
                    item.external ? (
                      <a
                        key={item.href}
                        href={item.href}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="px-2.5 py-1.5 text-body-sm text-ink-400 hover:text-ink-100 font-mono transition-colors duration-120"
                      >
                        {item.label}
                      </a>
                    ) : (
                      <Link
                        key={item.href}
                        href={item.href}
                        className="px-2.5 py-1.5 text-body-sm text-ink-400 hover:text-ink-100 font-mono transition-colors duration-120"
                      >
                        {item.label}
                      </Link>
                    ),
                  )}
                </nav>

                <div className="hidden lg:flex items-center gap-2">
                  <SearchBar />
                  <ThemeToggle />
                  <ConnectWallet />
                </div>
                <div className="lg:hidden flex items-center gap-1">
                  <ThemeToggle />
                  <MobileNav items={NAV_ITEMS} />
                </div>
              </div>
            </div>
          </header>

          <main className="max-w-[1440px] mx-auto px-4 sm:px-6 lg:px-10 py-8">
            {children}
          </main>

          <footer className="border-t border-ink-700 mt-20">
            <div className="max-w-[1440px] mx-auto px-4 sm:px-6 lg:px-10 py-8">
              <div className="flex flex-col md:flex-row md:items-start md:justify-between gap-6">
                <div className="max-w-md">
                  <Wordmark variant="crosshair" size={16} />
                  <p className="text-micro text-ink-400 mt-3 leading-relaxed">
                    Non-custodial interface for Polymarket. Orders you submit
                    are signed by your own wallet and sent directly to
                    Polymarket&apos;s CLOB. We never hold your keys or funds.
                  </p>
                </div>
                <div className="grid grid-cols-2 md:grid-cols-3 gap-x-10 gap-y-2 text-body-sm font-mono">
                  <Link href="/methodology" className="text-ink-400 hover:text-ink-100 transition-colors">
                    methodology
                  </Link>
                  <Link href="/calibration" className="text-ink-400 hover:text-ink-100 transition-colors">
                    calibration
                  </Link>
                  <Link href="/builder" className="text-ink-400 hover:text-ink-100 transition-colors">
                    builder
                  </Link>
                  <a
                    href="/api/docs"
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-ink-400 hover:text-ink-100 transition-colors"
                  >
                    api
                  </a>
                  <Link href="/terms" className="text-ink-400 hover:text-ink-100 transition-colors">
                    terms
                  </Link>
                </div>
              </div>
              <div className="mt-6 pt-6 border-t border-ink-800 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2">
                <p className="text-micro text-ink-500 font-mono">
                  polyscope · intelligence layer for prediction markets
                </p>
                <p className="text-micro text-ink-500 font-mono">
                  polymarket-v2 · clob · polygon
                </p>
              </div>
            </div>
          </footer>
        </Web3Provider>
      </body>
    </html>
  );
}
