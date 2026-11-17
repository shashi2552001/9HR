import React from 'react';

export function MetricsSkeleton() {
  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
      {[1, 2, 3, 4].map((i) => (
        <div
          key={i}
          className="rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-[#101820] p-5 animate-pulse"
        >
          <div className="h-3 w-24 bg-slate-200 dark:bg-slate-800 rounded mb-3" />
          <div className="h-8 w-16 bg-slate-200 dark:bg-slate-800 rounded mb-2" />
          <div className="h-3 w-32 bg-slate-100 dark:bg-slate-800/60 rounded" />
        </div>
      ))}
    </div>
  );
}

export function TableSkeleton({ rows = 5, cols = 6 }: { rows?: number; cols?: number }) {
  return (
    <div className="rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-[#101820] overflow-hidden">
      <div className="p-4 border-b border-slate-200 dark:border-slate-800 flex gap-4 animate-pulse">
        {Array.from({ length: cols }).map((_, idx) => (
          <div key={idx} className="h-3.5 flex-1 bg-slate-200 dark:bg-slate-800 rounded" />
        ))}
      </div>
      <div className="divide-y divide-slate-100 dark:divide-slate-800/70">
        {Array.from({ length: rows }).map((_, r) => (
          <div key={r} className="p-4 flex gap-4 animate-pulse">
            {Array.from({ length: cols }).map((__, c) => (
              <div key={c} className="h-3.5 flex-1 bg-slate-100 dark:bg-slate-800/50 rounded" />
            ))}
          </div>
        ))}
      </div>
    </div>
  );
}
