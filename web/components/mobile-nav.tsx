"use client";

import Link from "next/link";
import { useState } from "react";

interface NavItem {
  href: string;
  label: string;
  external?: boolean;
}

export function MobileNav({ items }: { items: NavItem[] }) {
  const [open, setOpen] = useState(false);

  return (
    <div className="lg:hidden">
      <button
        onClick={() => setOpen(!open)}
        className="p-2 text-ink-300 hover:text-ink-100 transition-colors"
        aria-label="Toggle menu"
      >
        <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
          {open ? (
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.75} d="M6 18L18 6M6 6l12 12" />
          ) : (
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.75} d="M4 6h16M4 12h16M4 18h16" />
          )}
        </svg>
      </button>
      {open && (
        <div className="absolute top-14 left-0 right-0 bg-background/95 backdrop-blur-md border-b border-ink-700 z-50">
          <div className="px-4 py-3 space-y-0.5">
            {items.map((item) =>
              item.external ? (
                <a
                  key={item.href}
                  href={item.href}
                  target="_blank"
                  rel="noopener noreferrer"
                  onClick={() => setOpen(false)}
                  className="block px-3 py-2 text-body-sm font-mono text-ink-300 hover:text-ink-100 hover:bg-ink-800 rounded-md transition-colors"
                >
                  {item.label}
                </a>
              ) : (
                <Link
                  key={item.href}
                  href={item.href}
                  onClick={() => setOpen(false)}
                  className="block px-3 py-2 text-body-sm font-mono text-ink-300 hover:text-ink-100 hover:bg-ink-800 rounded-md transition-colors"
                >
                  {item.label}
                </Link>
              ),
            )}
          </div>
        </div>
      )}
    </div>
  );
}
