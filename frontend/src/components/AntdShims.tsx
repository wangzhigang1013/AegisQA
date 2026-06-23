import React from 'react';
import { createPortal } from 'react-dom';
import { motion, usePresence } from 'framer-motion';
import { Info, AlertCircle, AlertTriangle, CheckCircle2 } from 'lucide-react';
import { Card as UICard, CardTitle as UICardTitle } from './ui/Card';
import { Button as UIButton } from './ui/Button';

// 1. Alert
export function Alert({ type = 'info', message, description, showIcon }: any) {
  let bg = 'bg-blue-50/80 border-blue-200/60 text-blue-800';
  let Icon = Info;
  if (type === 'error') { bg = 'bg-red-50/80 border-red-200/60 text-red-800'; Icon = AlertCircle; }
  else if (type === 'warning') { bg = 'bg-yellow-50/80 border-yellow-200/60 text-yellow-800'; Icon = AlertTriangle; }
  else if (type === 'success') { bg = 'bg-green-50/80 border-green-200/60 text-green-800'; Icon = CheckCircle2; }
  return (
    <div className={`p-4 rounded-2xl border backdrop-blur-md shadow-sm flex gap-3 ${bg} mb-4`}>
      {showIcon && <Icon className="w-5 h-5 shrink-0 mt-0.5" />}
      <div className="flex flex-col flex-1">
        {message && <span className="font-semibold text-sm">{message}</span>}
        {description && <span className="text-sm mt-1 opacity-90">{description}</span>}
      </div>
    </div>
  );
}

// 2. Col & Row
export function Row({ children, gutter, className = '' }: any) {
  // Simplistic grid
  return <div className={`flex flex-wrap -mx-2 ${className}`}>{children}</div>;
}
export function Col({ children, span, xs, sm, md, lg, xl, className = '' }: any) {
  // Simplistic column
  const width = xl ? `${(xl / 24) * 100}%` : lg ? `${(lg / 24) * 100}%` : span ? `${(span / 24) * 100}%` : '100%';
  return <div className={`px-2 w-full ${className}`} style={{ width: width !== '100%' ? width : undefined, flex: width !== '100%' ? `0 0 ${width}` : 1 }}>{children}</div>;
}

// 3. Empty
export function Empty({ description }: any) {
  return (
    <div className="flex flex-col items-center justify-center p-20 w-full my-4 liquid-glass rounded-[2rem]">
      <div className="w-16 h-16 mb-6 rounded-2xl bg-slate-50 border border-slate-100 shadow-sm flex items-center justify-center">
        <svg className="w-8 h-8 text-slate-300" fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M20 13V6a2 2 0 00-2-2H6a2 2 0 00-2 2v7m16 0v5a2 2 0 01-2 2H6a2 2 0 01-2-2v-5m16 0h-2.586a1 1 0 00-.707.293l-2.414 2.414a1 1 0 01-.707.293h-3.172a1 1 0 01-.707-.293l-2.414-2.414A1 1 0 006.586 13H4" />
        </svg>
      </div>
      <span className="text-slate-400 font-medium tracking-wide text-sm">{description || '此区域暂无数据'}</span>
    </div>
  );
}

// 4. Input (Simple forward)
export function Input(props: any) {
  return <input className="flex h-10 w-full rounded-md border border-slate-300 bg-transparent px-3 py-2 text-sm placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-blue-500 disabled:cursor-not-allowed disabled:opacity-50" {...props} />;
}
Input.TextArea = function TextArea(props: any) {
  return <textarea className="flex min-h-[80px] w-full rounded-md border border-slate-300 bg-transparent px-3 py-2 text-sm placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-blue-500 disabled:cursor-not-allowed disabled:opacity-50" {...props} />;
}

// 5. List
export const List: any = function List({ dataSource, renderItem, className = '' }: any) {
  if (!dataSource || dataSource.length === 0) return <Empty />;
  return (
    <ul className={`divide-y divide-slate-100 ${className}`}>
      {dataSource.map((item: any, index: number) => (
        <React.Fragment key={index}>{renderItem(item, index)}</React.Fragment>
      ))}
    </ul>
  );
}
List.Item = function ListItem({ children }: any) {
  return <li className="py-3">{children}</li>;
}
List.Item.Meta = function ListItemMeta({ title, description }: any) {
  return (
    <div className="flex flex-col gap-1">
      {title && <div className="text-sm font-medium text-slate-900">{title}</div>}
      {description && <div className="text-xs text-slate-500">{description}</div>}
    </div>
  );
}

// 6. Select
export function Select({ value, onChange, options, placeholder, className = '' }: any) {
  return (
    <div className={`relative ${className}`}>
      <select
        value={value ?? ''}
        onChange={(e) => onChange?.(e.target.value)}
        className="w-full flex h-10 items-center justify-between rounded-md border border-slate-300 bg-white px-3 py-2 text-sm text-slate-800 placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-blue-500 appearance-none"
      >
        <option value="" disabled>{placeholder || '请选择'}</option>
        {options?.map((opt: any) => (
          <option key={opt.value} value={opt.value}>{opt.label}</option>
        ))}
      </select>
    </div>
  );
}
Select.Option = function SelectOption() { return null; }; // not used if options prop is passed

// 7. Space
export function Space({ children, direction = 'horizontal', className = '' }: any) {
  return (
    <div className={`flex gap-2 ${direction === 'vertical' ? 'flex-col' : 'flex-wrap items-center'} ${className}`}>
      {children}
    </div>
  );
}

// 11. Table (Premium Styling)
export function Table<T = any>({ columns, dataSource, rowKey = 'id', loading, pagination, onChange, expandedRowRender, className = '' }: any) {
  return (
    <div className={`flex flex-col gap-4 w-full ${className}`}>
      <div className="overflow-x-auto border border-slate-200/60 rounded-2xl relative w-full bg-white/40 backdrop-blur-md shadow-sm">
        {loading && (
          <div className="absolute inset-0 bg-white/60 backdrop-blur-md z-10 flex items-center justify-center">
            <div className="w-8 h-8 border-2 border-blue-500 border-t-transparent rounded-full animate-spin"></div>
          </div>
        )}
        <table className="w-full text-sm text-left whitespace-nowrap">
          <thead className="bg-slate-50/50 text-slate-500 font-semibold border-b border-slate-200/60">
            <tr>
              {columns?.map((col: any, i: number) => <th key={i} className="px-5 py-4">{col.title}</th>)}
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100/60">
            {dataSource?.length ? dataSource.map((record: any, index: number) => {
              const key = typeof rowKey === 'function' ? rowKey(record) : (rowKey ? record[rowKey] : index);
              return (
                <motion.tr 
                  key={key || index} 
                  initial={{ opacity: 0, y: 10 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ delay: index * 0.03, type: "spring", stiffness: 300, damping: 24 }}
                  className="hover:bg-slate-50/80 transition-colors relative group"
                >
                  {columns?.map((col: any, i: number) => (
                    <td key={i} className="px-5 py-4 text-slate-700">
                      {col.render ? col.render(record[col.dataIndex], record, index) : record[col.dataIndex]}
                    </td>
                  ))}
                </motion.tr>
              )
            }) : (
              <tr>
                <td colSpan={columns?.length || 1} className="px-5 py-12 text-center text-slate-500">
                  <Empty />
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

// 9. Tag & Badge
export function Tag({ color, children, className = '' }: any) {
  let colorClass = 'bg-slate-100 text-slate-700 border-slate-200';
  if (color === 'red' || color === 'error') colorClass = 'bg-red-100 text-red-700 border-red-200';
  if (color === 'green' || color === 'success') colorClass = 'bg-green-100 text-green-700 border-green-200';
  if (color === 'orange' || color === 'gold' || color === 'warning') colorClass = 'bg-orange-100 text-orange-700 border-orange-200';
  if (color === 'blue' || color === 'processing') colorClass = 'bg-blue-100 text-blue-700 border-blue-200';
  if (color === 'purple') colorClass = 'bg-purple-100 text-purple-700 border-purple-200';
  
  return <span className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-medium border ${colorClass} ${className}`}>{children}</span>;
}
export const Badge = Tag;

// 10. Tooltip
export function Tooltip({ title, children }: any) {
  return <span title={typeof title === 'string' ? title : ''} className="cursor-help">{children}</span>;
}

// 11. Typography
export const Typography = {
  Title: function Title({ level, children, className = '' }: any) {
    if (level === 4) return <h4 className={`text-base font-semibold text-slate-800 ${className}`}>{children}</h4>;
    if (level === 5) return <h5 className={`text-sm font-semibold text-slate-800 ${className}`}>{children}</h5>;
    return <h2 className={`text-xl font-bold text-slate-800 ${className}`}>{children}</h2>;
  },
  Text: function Text({ type, strong, children, className = '' }: any) {
    return <span className={`${type === 'secondary' ? 'text-slate-500' : 'text-slate-800'} ${strong ? 'font-semibold' : ''} ${className}`}>{children}</span>;
  },
  Paragraph: function Paragraph({ children, className = '' }: any) {
    return <p className={`text-sm text-slate-700 mb-2 ${className}`}>{children}</p>;
  }
};

// 12. Modal
export function Modal({ open, title, onCancel, onOk, children, width, footer }: any) {
  const [isPresent, safeToRemove] = usePresence();
  
  React.useEffect(() => {
    if (!isPresent && safeToRemove) {
      safeToRemove();
    }
  }, [isPresent, safeToRemove]);

  if (!open || !isPresent) return null;
  return createPortal(
    <div className="fixed inset-0 z-[100] bg-black/40 backdrop-blur-sm flex items-center justify-center p-4">
      <div className="bg-white rounded-2xl shadow-xl w-full flex flex-col" style={{ maxWidth: width || 520 }}>
        <div className="p-6 pb-4 border-b border-slate-100 flex justify-between items-center">
          <h2 className="text-lg font-bold text-slate-800">{title}</h2>
          <button onClick={onCancel} className="text-slate-400 hover:text-slate-600">&times;</button>
        </div>
        <div className="p-6 overflow-y-auto max-h-[70vh]">
          {children}
        </div>
        {footer ? (
          <div className="p-6 pt-4 border-t border-slate-100 flex justify-end gap-2">
            {footer}
          </div>
        ) : null}
      </div>
    </div>,
    document.body
  );
}

// 13. Steps
export function Steps({ current, items }: any) {
  return (
    <div className="flex w-full gap-2 mb-6">
      {items?.map((item: any, idx: number) => {
        const isActive = idx === current;
        const isPast = idx < current;
        return (
          <div key={idx} className="flex-1 flex flex-col gap-2">
            <div className={`h-2 rounded-full w-full ${isActive ? 'bg-blue-500' : isPast ? 'bg-blue-200' : 'bg-slate-200'}`} />
            <span className={`text-xs font-medium ${isActive ? 'text-blue-700' : isPast ? 'text-slate-500' : 'text-slate-400'}`}>{item.title}</span>
          </div>
        );
      })}
    </div>
  );
}

// 14. Descriptions
export function Descriptions({ title, children, column = 3 }: any) {
  return (
    <div className="mb-6 w-full">
      {title && <h3 className="text-base font-semibold mb-3">{title}</h3>}
      <div className="grid gap-4" style={{ gridTemplateColumns: `repeat(${column}, minmax(0, 1fr))` }}>
        {children}
      </div>
    </div>
  );
}
Descriptions.Item = function DescItem({ label, children }: any) {
  return (
    <div className="flex flex-col gap-1">
      <span className="text-xs text-slate-500">{label}</span>
      <span className="text-sm font-medium text-slate-800">{children}</span>
    </div>
  );
}

// 15. Progress
export function Progress({ percent, status }: any) {
  const color = status === 'exception' ? 'bg-red-500' : status === 'success' ? 'bg-green-500' : 'bg-blue-500';
  return (
    <div className="flex items-center gap-2 w-full">
      <div className="flex-1 h-2 bg-slate-100 rounded-full overflow-hidden">
        <div className={`h-full ${color} transition-all`} style={{ width: `${percent}%` }} />
      </div>
      <span className="text-xs text-slate-500 w-8">{percent}%</span>
    </div>
  );
}

// 16. Card (Shim to map title and extra)
export function Card({ title, extra, children, className = '', loading }: any) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.4, ease: "easeOut" }}
      className="h-full"
    >
      <UICard className={`flex flex-col relative h-full overflow-hidden hover:-translate-y-1 ${className}`}>
        {loading && (
          <div className="absolute inset-0 bg-white/50 backdrop-blur-sm z-50 flex items-center justify-center">
            <div className="w-8 h-8 border-2 border-blue-500 border-t-transparent rounded-full animate-spin"></div>
          </div>
        )}
        {(title || extra) && (
          <div className="px-6 py-5 border-b border-slate-100/50 flex items-center justify-between z-10 relative bg-white/40">
            <UICardTitle className="text-lg font-bold text-slate-800 tracking-tight">{title}</UICardTitle>
            {extra && <div>{extra}</div>}
          </div>
        )}
        <div className="p-6 flex-1 flex flex-col z-10 relative">{children}</div>
      </UICard>
    </motion.div>
  );
}

// Button needs prop mapping (type -> variant, danger -> variant=destructive)
export function Button({ type, danger, block, children, ...props }: any) {
  let variant = 'default';
  if (type === 'primary') variant = 'default';
  if (type === 'default' || !type) variant = 'outline';
  if (type === 'text' || type === 'link') variant = 'ghost';
  if (danger) variant = 'destructive';
  
  return (
    <UIButton variant={variant as any} className={block ? 'w-full' : ''} {...props}>
      {children}
    </UIButton>
  );
}
