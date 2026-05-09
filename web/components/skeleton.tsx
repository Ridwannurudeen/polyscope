/**
 * Skeleton primitives. Each block uses the .shimmer utility (defined in
 * globals.css) — a moving highlight band over a flat fill. Replaces the
 * earlier opacity-pulse, which reads as "loading bar" rather than
 * "content arriving."
 *
 * Reduced-motion users see a flat fill (animation gated globally).
 */

function Bar({ className = "" }: { className?: string }) {
  return <div className={`shimmer rounded-sm ${className}`} />;
}

export function SkeletonCard() {
  return (
    <div className="surface rounded-lg p-5">
      <Bar className="h-2.5 w-20 mb-3" />
      <Bar className="h-7 w-16" />
    </div>
  );
}

export function SkeletonRow() {
  return (
    <div className="surface rounded-lg p-4">
      <div className="flex items-center justify-between gap-4">
        <div className="flex-1">
          <Bar className="h-3.5 w-3/4 mb-2" />
          <Bar className="h-2.5 w-1/2 opacity-70" />
        </div>
        <Bar className="h-6 w-12" />
      </div>
    </div>
  );
}

export function DashboardSkeleton() {
  return (
    <div className="mb-14">
      <div className="flex items-end justify-between mb-5 pb-2 border-b border-ink-800">
        <div>
          <Bar className="h-5 w-36 mb-2" />
          <Bar className="h-3 w-64 opacity-70" />
        </div>
        <Bar className="h-3 w-14 opacity-70" />
      </div>
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {Array.from({ length: 2 }).map((_, group) => (
          <div key={group} className="surface rounded-lg overflow-hidden">
            <div className="px-4 py-3 border-b border-ink-800">
              <Bar className="h-2.5 w-32 mb-3" />
              <Bar className="h-3 w-44 opacity-70" />
            </div>
            {Array.from({ length: 5 }).map((_, i) => (
              <div
                key={i}
                className="px-4 py-3 border-b border-ink-800/60 last:border-0"
              >
                <div className="flex items-center justify-between gap-4">
                  <div className="flex-1 min-w-0">
                    <Bar className="h-3 w-3/4 mb-2" />
                    <Bar className="h-1 w-1/2 opacity-70" />
                  </div>
                  <Bar className="h-4 w-12" />
                </div>
              </div>
            ))}
          </div>
        ))}
      </div>
    </div>
  );
}

export function TableSkeleton({ rows = 10 }: { rows?: number }) {
  return (
    <div className="surface rounded-lg overflow-hidden">
      <div className="border-b border-ink-800 p-3 flex gap-8">
        {Array.from({ length: 4 }).map((_, i) => (
          <Bar key={i} className="h-2.5 w-16" />
        ))}
      </div>
      {Array.from({ length: rows }).map((_, i) => (
        <div
          key={i}
          className="border-b border-ink-800/50 p-3 flex items-center gap-8 last:border-0"
        >
          <Bar className="h-3 w-8 opacity-70" />
          <Bar className="h-3 w-48 opacity-70 flex-1" />
          <Bar className="h-3 w-16 opacity-70" />
          <Bar className="h-3 w-16 opacity-70" />
        </div>
      ))}
    </div>
  );
}
