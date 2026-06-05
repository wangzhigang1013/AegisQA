import { Card, Space } from 'antd';
import type { CardProps, SpaceProps } from 'antd';
import type { ReactNode } from 'react';

function joinClassNames(...items: Array<string | undefined>) {
  return items.filter(Boolean).join(' ');
}

type PageSectionProps = CardProps & {
  testId?: string;
};

export function PageSection({ children, className, testId, ...props }: PageSectionProps) {
  return (
    <Card className={joinClassNames('flat-card', 'page-section', className)} data-testid={testId} {...props}>
      {children}
    </Card>
  );
}

type ActionToolbarProps = SpaceProps & {
  children: ReactNode;
  testId?: string;
};

export function ActionToolbar({ children, className, testId, wrap, ...props }: ActionToolbarProps) {
  return (
    <Space wrap={wrap ?? true} className={joinClassNames('action-toolbar', className)} data-testid={testId} {...props}>
      {children}
    </Space>
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
