import type { ReactNode } from 'react';
import { Card } from './AntdShims';

function joinClassNames(...items: Array<string | undefined>) {
  return items.filter(Boolean).join(' ');
}

type PageSectionProps = {
  title?: ReactNode;
  extra?: ReactNode;
  children: ReactNode;
  className?: string;
  testId?: string;
};

export function PageSection({ children, className, testId, title, extra, ...props }: PageSectionProps) {
  return (
    <Card className={joinClassNames('page-section', className)} title={title} extra={extra} data-testid={testId} {...props}>
      {children}
    </Card>
  );
}

type ActionToolbarProps = {
  children: ReactNode;
  className?: string;
  testId?: string;
  wrap?: boolean;
};

export function ActionToolbar({ children, className, testId, wrap = true, ...props }: ActionToolbarProps) {
  return (
    <div 
      className={joinClassNames('flex items-center gap-2', wrap ? 'flex-wrap' : '', className)} 
      data-testid={testId} 
      {...props}
    >
      {children}
    </div>
  );
}

type DataTableShellProps = {
  children: ReactNode;
  className?: string;
  testId?: string;
};

export function DataTableShell({ children, className, testId }: DataTableShellProps) {
  return (
    <div className={joinClassNames('data-table-shell', className)} data-testid={testId}>
      {children}
    </div>
  );
}
