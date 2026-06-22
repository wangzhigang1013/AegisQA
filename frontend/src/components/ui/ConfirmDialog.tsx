/**
 * 确认对话框组件
 *
 * 用法:
 *   import { useConfirm } from '../components/ui/ConfirmDialog';
 *   const confirm = useConfirm();
 *   const ok = await confirm({ title: '确认删除?', description: '此操作不可撤销' });
 *   if (ok) { ... }
 */

import { useCallback, useState } from 'react';
import { AlertTriangle, Trash2, Archive, Ban } from 'lucide-react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from './Dialog';
import { Button } from './Button';

interface ConfirmOptions {
  title: string;
  description?: string;
  confirmText?: string;
  cancelText?: string;
  variant?: 'danger' | 'warning' | 'default';
}

export function useConfirm() {
  const [options, setOptions] = useState<ConfirmOptions | null>(null);
  const [resolve, setResolve] = useState<((value: boolean) => void) | null>(null);

  const confirm = useCallback((opts: ConfirmOptions): Promise<boolean> => {
    return new Promise<boolean>((res) => {
      setOptions(opts);
      setResolve(() => res);
    });
  }, []);

  const handleClose = useCallback((result: boolean) => {
    setOptions(null);
    resolve?.(result);
  }, [resolve]);

  const ConfirmModal = options ? (
    <Dialog open onOpenChange={() => handleClose(false)}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            {options.variant === 'danger' && <Trash2 className="w-5 h-5 text-red-500" />}
            {options.variant === 'warning' && <AlertTriangle className="w-5 h-5 text-amber-500" />}
            {options.title}
          </DialogTitle>
        </DialogHeader>
        {options.description && (
          <p className="text-sm text-slate-500 py-2">{options.description}</p>
        )}
        <DialogFooter>
          <Button variant="ghost" onClick={() => handleClose(false)}>
            {options.cancelText ?? '取消'}
          </Button>
          <Button
            variant={options.variant === 'danger' ? 'destructive' : 'default'}
            onClick={() => handleClose(true)}
          >
            {options.confirmText ?? '确认'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  ) : null;

  return { confirm, ConfirmModal };
}
