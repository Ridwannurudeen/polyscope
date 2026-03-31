interface LastUpdatedProps {
  lastUpdated: Date | null;
  error: string | null;
  retry: () => void;
}

export function LastUpdated({ lastUpdated, error, retry }: LastUpdatedProps) {
  if (error) {
    return (
      <div className="flex items-center gap-2 text-sm">
        <span className="w-2 h-2 rounded-full bg-red-500" />
        <span className="text-red-400">Failed to load</span>
        <button
          onClick={retry}
          className="text-xs text-gray-400 hover:text-white underline ml-1"
        >
          Retry
        </button>
      </div>
    );
  }

  if (!lastUpdated) return null;

  return (
    <div className="flex items-center gap-2 text-sm">
      <span className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse" />
      <span className="text-gray-500">
        Updated {lastUpdated.toLocaleTimeString()}
      </span>
    </div>
  );
}
