"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { ConnectWallet } from "@/components/connect-wallet";
import { SearchBar } from "@/components/search-bar";

interface NavItem {
  href: string;
  label: string;
  external?: boolean;
}

/**
 * Mobile drawer. Distinct from a hamburger that drops a generic list:
 *   - 44+ px touch targets per nav item (WCAG / iOS HIG)
 *   - Search + Connect Wallet inside the drawer (otherwise mobile users
 *     have no path to either since they're hidden in the desktop bar)
 *   - Closes on route change, Esc, and outside tap
 *   - body scroll locked while open
 */
export function MobileNav({ items }: { items: NavItem[] }) {
  const [open, setOpen] = useState(false);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("keydown", onKey);
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = "";
    };
  }, [open]);

  return (
    <div className="lg:hidden">
      <button
        onClick={() => setOpen(!open)}
        className="w-10 h-10 inline-flex items-center justify-center text-ink-300 hover:text-ink-100 transition-colors"
        aria-label={open ? "Close menu" : "Open menu"}
        aria-expanded={open}
      >
        <svg
          className="w-5 h-5"
          fill="none"
          viewBox="0 0 24 24"
          stroke="currentColor"
        >
          {open ? (
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={1.75}
              d="M6 18L18 6M6 6l12 12"
            />
          ) : (
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={1.75}
              d="M4 6h16M4 12h16M4 18h16"
            />
          )}
        </svg>
      </button>

      {open && (
        <>
          {/* backdrop */}
          <div
            className="fixed inset-0 top-14 bg-background/80 backdrop-blur-sm z-40 animate-fade-in"
            onClick={() => setOpen(false)}
          />
          {/* sheet */}
          <div
            className="fixed top-14 left-0 right-0 max-h-[calc(100vh-3.5rem)] overflow-y-auto bg-background border-b border-ink-700 z-50 animate-fade-up"
            role="dialog"
            aria-label="Site navigation"
          >
            <div className="px-4 py-4 space-y-4">
              {/* Search */}
              <div>
                <div className="eyebrow mb-2">search</div>
                <SearchBar onAfterNavigate={() => setOpen(false)} />
              </div>

              {/* Nav items */}
              <div>
                <div className="eyebrow mb-2">terminal</div>
                <div className="space-y-0.5">
                  {items.map((item) =>
                    item.external ? (
                      <a
                        key={item.href}
                        href={item.href}
                        target="_blank"
                        rel="noopener noreferrer"
                        onClick={() => setOpen(false)}
                        className="flex items-center justify-between px-3 h-12 text-body font-mono text-ink-200 hover:text-ink-100 hover:bg-ink-800 rounded-md transition-colors"
                      >
                        <span>{item.label}</span>
                        <span className="text-ink-500 text-micro">↗</span>
                      </a>
                    ) : (
                      <Link
                        key={item.href}
                        href={item.href}
                        onClick={() => setOpen(false)}
                        className="flex items-center px-3 h-12 text-body font-mono text-ink-200 hover:text-ink-100 hover:bg-ink-800 rounded-md transition-colors"
                      >
                        {item.label}
                      </Link>
                    ),
                  )}
                </div>
              </div>

              {/* Connect wallet */}
              <div>
                <div className="eyebrow mb-2">identity</div>
                <ConnectWallet />
              </div>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
