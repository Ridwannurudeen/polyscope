import Link from "next/link";
import type { Metadata } from "next";
import { MarkCrosshair } from "@/components/logo";

export const metadata: Metadata = {
  title: "Not found — PolyScope",
  description: "The page you tried to load doesn't exist on PolyScope.",
};

export default function NotFound() {
  return (
    <div className="min-h-[60vh] flex flex-col items-center justify-center text-center px-4 py-16">
      <div className="opacity-60 mb-8">
        <MarkCrosshair size={56} />
      </div>
      <div className="eyebrow mb-3 text-fade-500">404 · signal not found</div>
      <h1 className="text-display text-ink-100 tracking-tightest leading-none mb-4">
        404
      </h1>
      <p className="text-body-lg text-ink-300 max-w-md mb-2 leading-relaxed">
        This URL doesn&apos;t resolve to a market, trader, or page on PolyScope.
      </p>
      <p className="text-caption font-mono text-ink-500 max-w-md mb-8">
        Stale link · typo · or a market that resolved and was archived. Try one
        of the live feeds below.
      </p>
      <div className="flex flex-wrap items-center justify-center gap-3">
        <Link href="/" className="btn-primary btn-md">
          terminal →
        </Link>
        <Link href="/traders" className="btn-secondary btn-md">
          leaderboard
        </Link>
        <Link href="/smart-money" className="btn-secondary btn-md">
          signals
        </Link>
        <Link href="/methodology" className="btn-ghost btn-md">
          methodology
        </Link>
      </div>
    </div>
  );
}
