"use client";

import Link from "next/link";
import { useEffect } from "react";
import { MarkCrosshair } from "@/components/logo";

/**
 * Runtime error boundary. Replaces Next.js default red-on-white error
 * page. Logs the digest so we can correlate with server logs but
 * shows the user a clean recovery surface.
 */
export default function Error({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    if (typeof window !== "undefined") {
      // eslint-disable-next-line no-console
      console.error("[polyscope] runtime error", error);
    }
  }, [error]);

  return (
    <div className="min-h-[60vh] flex flex-col items-center justify-center text-center px-4 py-16">
      <div className="opacity-60 mb-8">
        <MarkCrosshair size={56} accent="var(--alert)" />
      </div>
      <div className="eyebrow mb-3 text-alert-500">runtime error</div>
      <h1 className="text-h1 text-ink-100 tracking-tightest leading-tight mb-4">
        something blew up
      </h1>
      <p className="text-body-lg text-ink-300 max-w-md mb-2 leading-relaxed">
        A page on PolyScope hit an unhandled exception. Reload usually
        clears it; if not, the terminal feed is always live.
      </p>
      {error.digest && (
        <p className="text-caption font-mono text-ink-500 mb-6">
          ref · {error.digest}
        </p>
      )}
      <div className="flex flex-wrap items-center justify-center gap-3">
        <button onClick={reset} className="btn-primary btn-md">
          try again
        </button>
        <Link href="/" className="btn-secondary btn-md">
          back to terminal
        </Link>
      </div>
    </div>
  );
}
