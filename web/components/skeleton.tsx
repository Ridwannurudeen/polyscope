export function SkeletonCard() {
  return (
    <div className="bg-gray-900 border border-gray-800 rounded-xl p-5 animate-pulse">
      <div className="h-3 w-20 bg-gray-800 rounded mb-3" />
      <div className="h-7 w-16 bg-gray-800 rounded" />
    </div>
  );
}

export function SkeletonRow() {
  return (
    <div className="bg-gray-900 border border-gray-800 rounded-xl p-4 animate-pulse">
      <div className="flex items-center justify-between">
        <div className="flex-1">
          <div className="h-4 w-3/4 bg-gray-800 rounded mb-2" />
          <div className="h-3 w-1/2 bg-gray-800 rounded" />
        </div>
        <div className="h-8 w-12 bg-gray-800 rounded" />
      </div>
    </div>
  );
}

export function DashboardSkeleton() {
  return (
    <div>
      <div className="mb-8">
        <div className="h-8 w-80 bg-gray-800 rounded animate-pulse mb-2" />
        <div className="h-4 w-96 bg-gray-800/60 rounded animate-pulse" />
      </div>

      <div className="grid grid-cols-1 md:grid-cols-4 gap-4 mb-8">
        {Array.from({ length: 4 }).map((_, i) => (
          <SkeletonCard key={i} />
        ))}
      </div>

      <div className="mb-10">
        <div className="h-6 w-52 bg-gray-800 rounded animate-pulse mb-4" />
        <div className="space-y-3">
          {Array.from({ length: 5 }).map((_, i) => (
            <SkeletonRow key={i} />
          ))}
        </div>
      </div>

      <div>
        <div className="h-6 w-44 bg-gray-800 rounded animate-pulse mb-4" />
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          {Array.from({ length: 4 }).map((_, i) => (
            <SkeletonRow key={i} />
          ))}
        </div>
      </div>
    </div>
  );
}

export function TableSkeleton({ rows = 10 }: { rows?: number }) {
  return (
    <div className="bg-gray-900 border border-gray-800 rounded-xl overflow-hidden animate-pulse">
      <div className="border-b border-gray-800 p-3 flex gap-8">
        {Array.from({ length: 4 }).map((_, i) => (
          <div key={i} className="h-3 w-16 bg-gray-800 rounded" />
        ))}
      </div>
      {Array.from({ length: rows }).map((_, i) => (
        <div key={i} className="border-b border-gray-800/50 p-3 flex items-center gap-8">
          <div className="h-3 w-8 bg-gray-800/60 rounded" />
          <div className="h-3 w-48 bg-gray-800/60 rounded flex-1" />
          <div className="h-3 w-16 bg-gray-800/60 rounded" />
          <div className="h-3 w-16 bg-gray-800/60 rounded" />
        </div>
      ))}
    </div>
  );
}
