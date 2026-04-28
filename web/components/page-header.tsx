import type { ReactNode } from "react";

/**
 * Inner-page header. Tighter than the landing hero on purpose — inner
 * pages are tools, not pitches. Same structural posture across every
 * page so the site feels like one product, not seven.
 *
 *   <PageHeader title="leaderboard" sub="Top-100, ranked by accuracy." />
 *
 * Right slot accepts arbitrary content (count, action, ViewToggle).
 */
export function PageHeader({
  title,
  sub,
  right,
  className = "",
}: {
  title: string;
  sub?: string;
  right?: ReactNode;
  className?: string;
}) {
  return (
    <header
      className={`mb-8 pb-5 border-b border-ink-800 flex items-end justify-between gap-6 flex-wrap ${className}`}
    >
      <div className="min-w-0">
        <h1 className="text-h1 text-ink-100 tracking-tightest leading-tight">
          {title}
        </h1>
        {sub && (
          <p className="text-body-sm text-ink-400 mt-2 max-w-2xl leading-relaxed text-pretty">
            {sub}
          </p>
        )}
      </div>
      {right && <div className="shrink-0 flex items-center gap-2">{right}</div>}
    </header>
  );
}
