import { Button, Typography } from 'antd';
import type { ReactNode } from 'react';

type PageHeaderProps = {
  eyebrow: string;
  title: string;
  description: string;
  primaryAction?: ReactNode;
};

export function PageHeader({ eyebrow, title, description, primaryAction }: PageHeaderProps) {
  return (
    <header className="page-header">
      <div>
        <Typography.Text className="eyebrow">{eyebrow}</Typography.Text>
        <Typography.Title level={1}>{title}</Typography.Title>
        <Typography.Paragraph>{description}</Typography.Paragraph>
      </div>
      {primaryAction ? <div className="page-header-actions">{primaryAction}</div> : null}
    </header>
  );
}

export function HeaderButton({ children, ...props }: Parameters<typeof Button>[0]) {
  return (
    <Button type="primary" size="large" {...props}>
      {children}
    </Button>
  );
}
