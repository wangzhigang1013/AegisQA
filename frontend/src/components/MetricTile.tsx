import type { ReactNode } from 'react';
import { motion } from 'framer-motion';

import { Card } from './ui/Card';

type MetricTileProps = {
  title: string;
  value: string | number;
  suffix?: string;
  icon: ReactNode;
  tone: 'blue' | 'green' | 'amber' | 'violet' | 'red';
  note: string;
  className?: string;
};

export function MetricTile({ title, value, suffix, icon, tone, note, className }: MetricTileProps) {
  const toneMap: Record<string, string> = {
    blue: 'text-blue-600 bg-blue-50',
    green: 'text-green-600 bg-green-50',
    amber: 'text-amber-600 bg-amber-50',
    violet: 'text-violet-600 bg-violet-50',
    red: 'text-red-600 bg-red-50',
  };
  
  return (
    <motion.div
      whileHover={{ y: -4, scale: 1.01 }}
      whileTap={{ scale: 0.98 }}
      transition={{ type: 'spring', stiffness: 400, damping: 25 }}
      className="h-full"
    >
      <Card className={`h-full flex flex-col p-6 liquid-glass ${className ?? ''}`}>
        <div className="mb-4 flex justify-between items-center">
          <motion.div 
            className={`w-12 h-12 rounded-2xl flex items-center justify-center ${toneMap[tone]} relative overflow-hidden`}
            whileHover={{ rotate: 5, scale: 1.1 }}
            transition={{ type: 'spring', stiffness: 300 }}
          >
            {icon}
            {/* Infinite Shimmer */}
            <motion.div
              className="absolute inset-0 bg-gradient-to-r from-transparent via-white/40 to-transparent"
              animate={{ x: ['-150%', '150%'] }}
              transition={{ repeat: Infinity, duration: 2, ease: "linear", repeatDelay: 1 }}
            />
          </motion.div>
          <div className="px-3 py-1 rounded-full bg-slate-100 text-slate-500 text-xs font-semibold uppercase tracking-wider shadow-sm">
            {note}
          </div>
        </div>
        <div className="mt-auto">
          <div className="text-sm font-semibold text-slate-500 mb-1 tracking-tight">{title}</div>
          <div className="text-[40px] font-bold tracking-tight text-slate-900 leading-none font-mono">
            {value}
            {suffix && <span className="text-xl text-slate-400 ml-1 font-sans">{suffix}</span>}
          </div>
        </div>
      </Card>
    </motion.div>
  );
}
