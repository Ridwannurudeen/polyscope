export function SkeletonCard() {
  return (
    <div className="surface rounded-lg p-5 animate-pulse-subtle">
      <div className="h-2.5 w-20 bg-ink-800 rounded-sm mb-3" />
      <div className="h-7 w-16 bg-ink-800 rounded-sm" />
    </div>
  );
}

export function SkeletonRow() {
  return (
    <div className="surface rounded-lg p-4 animate-pulse-subtle">
      <div className="flex items-center justify-between gap-4">
        <div className="flex-1">
          <div className="h-3.5 w-3/4 bg-ink-800 rounded-sm mb-2" />
          <div className="h-2.5 w-1/2 bg-ink-800/70 rounded-sm" />
        </div>
        <div className="h-6 w-12 bg-ink-800 rounded-sm" />
      </div>
    </div>
  );
}

export function DashboardSkeleton() {
  return (
    <div>
      <div className="mb-10 pb-10 border-b border-ink-800">
        <div className="h-3 w-24 bg-ink-800 rounded-sm animate-pulse-subtle mb-5" />
        <div className="h-12 w-80 bg-ink-800 rounded-sm animate-pulse-subtle mb-3" />
        <div className="h-10 w-96 bg-ink-800/70 rounded-sm animate-pulse-subtle mb-8" />
        <div className="grid grid-cols-1 md:grid-cols-4 gap-x-10 gap-y-6 pt-8 border-t border-ink-800">
          {Array.from({ length: 4 }).map((_, i) => (
            <div key={i}>
              <div className="h-2.5 w-20 bg-ink-800 rounded-sm mb-2 animate-pulse-subtle" />
              <div className="h-7 w-24 bg-ink-800 rounded-sm animate-pulse-subtle" />
            </div>
          ))}
        </div>
      </div>

      <div className="mb-12">
        <div className="h-5 w-52 bg-ink-800 rounded-sm animate-pulse-subtle mb-4" />
        <div className="surface rounded-lg p-6 h-60 animate-pulse-subtle" />
      </div>

      <div className="mb-12">
        <div className="h-5 w-48 bg-ink-800 rounded-sm animate-pulse-subtle mb-5" />
        <div className="space-y-2">
          {Array.from({ length: 5 }).map((_, i) => (
            <SkeletonRow key={i} />
          ))}
        </div>
      </div>
    </div>
  );
}

export function TableSkeleton({ rows = 10 }: { rows?: number }) {
  return (
    <div className="surface rounded-lg overflow-hidden animate-pulse-subtle">
      <div className="border-b border-ink-800 p-3 flex gap-8">
        {Array.from({ length: 4 }).map((_, i) => (
          <div key={i} className="h-2.5 w-16 bg-ink-800 rounded-sm" />
        ))}
      </div>
      {Array.from({ length: rows }).map((_, i) => (
        <div
          key={i}
          className="border-b border-ink-800/50 p-3 flex items-center gap-8 last:border-0"
        >
          <div className="h-3 w-8 bg-ink-800/70 rounded-sm" />
          <div className="h-3 w-48 bg-ink-800/70 rounded-sm flex-1" />
          <div className="h-3 w-16 bg-ink-800/70 rounded-sm" />
          <div className="h-3 w-16 bg-ink-800/70 rounded-sm" />
        </div>
      ))}
    </div>
  );
}
