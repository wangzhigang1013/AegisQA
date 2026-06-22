/**
 * 全局 Toast 通知组件
 *
 * 用法:
 *   import { toast } from '../components/ui/Toast';
 *   toast.success('操作成功');
 *   toast.error('操作失败');
 *   toast.warning('警告信息');
 *   toast.info('提示信息');
 */

import { useCallback, useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { motion, AnimatePresence } from 'framer-motion';
import { CheckCircle, AlertCircle, AlertTriangle, Info, X } from 'lucide-react';

type ToastType = 'success' | 'error' | 'warning' | 'info';

interface ToastItem {
  id: number;
  type: ToastType;
  message: string;
  description?: string;
}

let _addToast: ((type: ToastType, message: string, description?: string) => void) | null = null;

export const toast = {
  success: (message: string, description?: string) => _addToast?.('success', message, description),
  error: (message: string, description?: string) => _addToast?.('error', message, description),
  warning: (message: string, description?: string) => _addToast?.('warning', message, description),
  info: (message: string, description?: string) => _addToast?.('info', message, description),
};

const TOAST_CONFIG: Record<ToastType, { bg: string; border: string; icon: typeof CheckCircle; iconColor: string }> = {
  success: { bg: 'bg-emerald-50', border: 'border-emerald-200', icon: CheckCircle, iconColor: 'text-emerald-600' },
  error: { bg: 'bg-red-50', border: 'border-red-200', icon: AlertCircle, iconColor: 'text-red-600' },
  warning: { bg: 'bg-amber-50', border: 'border-amber-200', icon: AlertTriangle, iconColor: 'text-amber-600' },
  info: { bg: 'bg-blue-50', border: 'border-blue-200', icon: Info, iconColor: 'text-blue-600' },
};

export function ToastContainer() {
  const [toasts, setToasts] = useState<ToastItem[]>([]);

  const addToast = useCallback((type: ToastType, message: string, description?: string) => {
    const id = Date.now();
    setToasts(prev => [...prev.slice(-4), { id, type, message, description }]);
    setTimeout(() => setToasts(prev => prev.filter(t => t.id !== id)), 5000);
  }, []);

  useEffect(() => {
    _addToast = addToast;
    return () => { _addToast = null; };
  }, [addToast]);

  return createPortal(
    <div className="fixed top-4 right-4 z-[9999] flex flex-col gap-2 pointer-events-none" style={{ maxWidth: 400 }}>
      <AnimatePresence>
        {toasts.map(t => {
          const config = TOAST_CONFIG[t.type];
          const Icon = config.icon;
          return (
            <motion.div
              key={t.id}
              initial={{ opacity: 0, x: 50, scale: 0.95 }}
              animate={{ opacity: 1, x: 0, scale: 1 }}
              exit={{ opacity: 0, x: 50, scale: 0.95 }}
              transition={{ type: 'spring', stiffness: 400, damping: 30 }}
              className={`${config.bg} ${config.border} border rounded-lg p-4 shadow-lg pointer-events-auto flex items-start gap-3`}
            >
              <Icon className={`w-5 h-5 ${config.iconColor} flex-shrink-0 mt-0.5`} />
              <div className="flex-1 min-w-0">
                <div className="text-sm font-medium text-slate-900">{t.message}</div>
                {t.description && <div className="text-xs text-slate-500 mt-1">{t.description}</div>}
              </div>
              <button
                onClick={() => setToasts(prev => prev.filter(x => x.id !== t.id))}
                className="text-slate-400 hover:text-slate-600 flex-shrink-0"
              >
                <X className="w-4 h-4" />
              </button>
            </motion.div>
          );
        })}
      </AnimatePresence>
    </div>,
    document.body
  );
}
