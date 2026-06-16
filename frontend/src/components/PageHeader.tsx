import type { ReactNode } from 'react';
import { Button } from './ui/Button';

type ThemeColor = 'blue' | 'purple' | 'teal' | 'emerald' | 'orange' | 'slate';

type PageHeaderProps = {
  eyebrow: string;
  title: string;
  description: string;
  primaryAction?: ReactNode;
  themeColor?: ThemeColor;
  icon?: ReactNode;
};

const themeGradients: Record<ThemeColor, { bg: string, glow1: string, glow2: string, text: string, iconBg: string }> = {
  blue: { bg: 'from-slate-800 via-blue-900 to-indigo-900', glow1: 'bg-blue-500/20', glow2: 'bg-indigo-500/20', text: 'text-blue-400', iconBg: 'bg-blue-500/20 border-blue-500/30' },
  purple: { bg: 'from-slate-800 via-purple-900 to-fuchsia-900', glow1: 'bg-purple-500/20', glow2: 'bg-fuchsia-500/20', text: 'text-purple-400', iconBg: 'bg-purple-500/20 border-purple-500/30' },
  teal: { bg: 'from-slate-800 via-teal-900 to-cyan-900', glow1: 'bg-teal-500/20', glow2: 'bg-cyan-500/20', text: 'text-teal-400', iconBg: 'bg-teal-500/20 border-teal-500/30' },
  emerald: { bg: 'from-slate-800 via-emerald-900 to-green-900', glow1: 'bg-emerald-500/20', glow2: 'bg-green-500/20', text: 'text-emerald-400', iconBg: 'bg-emerald-500/20 border-emerald-500/30' },
  orange: { bg: 'from-slate-800 via-orange-900 to-amber-900', glow1: 'bg-orange-500/20', glow2: 'bg-amber-500/20', text: 'text-orange-400', iconBg: 'bg-orange-500/20 border-orange-500/30' },
  slate: { bg: 'from-slate-800 via-slate-900 to-slate-900', glow1: 'bg-blue-500/10', glow2: 'bg-slate-500/20', text: 'text-slate-400', iconBg: 'bg-slate-700/50 border-slate-600/50' },
};

export function PageHeader({ eyebrow, title, description, primaryAction, themeColor = 'slate', icon }: PageHeaderProps) {
  const theme = themeGradients[themeColor];
  
  return (
    <div className={`bg-gradient-to-br ${theme.bg} rounded-3xl shadow-[0_20px_40px_-15px_rgba(0,0,0,0.3)] p-8 mb-8 relative overflow-hidden`}>
      {/* 动态光晕 */}
      <div className={`absolute -top-32 -right-32 w-80 h-80 ${theme.glow1} rounded-full blur-3xl pointer-events-none`}></div>
      <div className={`absolute -bottom-24 -left-24 w-64 h-64 ${theme.glow2} rounded-full blur-3xl pointer-events-none`}></div>

      <div className="relative z-10 flex flex-col md:flex-row justify-between items-start md:items-center gap-6">
        <div className="flex items-start gap-5 max-w-4xl">
          <div className={`p-4 rounded-2xl ${theme.iconBg} ${theme.text} shadow-inner border mt-1 hidden sm:block`}>
            {icon || <div className="w-8 h-8 flex items-center justify-center text-2xl font-bold opacity-80">{title.charAt(0)}</div>}
          </div>
          <div>
            <span className={`text-xs font-bold uppercase tracking-wider mb-1 block ${theme.text}`}>{eyebrow}</span>
            <h2 className="m-0 text-white font-bold tracking-tight mb-2 text-3xl">{title}</h2>
            <p className="text-slate-300 text-sm leading-relaxed block m-0">{description}</p>
          </div>
        </div>
        
        {primaryAction && (
          <div className="flex-shrink-0 w-full md:w-auto mt-4 md:mt-0 flex gap-3">
             {primaryAction}
          </div>
        )}
      </div>
    </div>
  );
}
