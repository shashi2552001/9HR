import React from 'react';

interface BrandLogoProps {
  size?: 'sm' | 'md' | 'lg';
  showWordmark?: boolean;
  subtitle?: string;
}

export function BrandLogo({ size = 'md', showWordmark = true, subtitle }: BrandLogoProps) {
  const dim = size === 'sm' ? 'w-9 h-9' : size === 'lg' ? 'w-16 h-16' : 'w-11 h-11';

  return (
    <div className="flex items-center gap-3 shrink-0">
      <div
        className={`${dim} rounded-full bg-white p-0.5 shadow-sm border border-slate-200/80 dark:border-slate-700/80 flex items-center justify-center shrink-0 overflow-hidden`}
      >
        <img
          src="/assets/aistudio/image_0ecd2493.png"
          alt="9HR India Private Limited Logo"
          referrerPolicy="no-referrer"
          className="w-full h-full object-contain"
        />
      </div>
      {showWordmark && (
        <div className="min-w-0">
          <p className="font-display font-bold text-slate-900 dark:text-white tracking-tight leading-tight whitespace-nowrap text-base">
            9HR India
          </p>
          {subtitle && (
            <p className="text-xs text-slate-500 dark:text-slate-400 whitespace-nowrap truncate">
              {subtitle}
            </p>
          )}
        </div>
      )}
    </div>
  );
}
