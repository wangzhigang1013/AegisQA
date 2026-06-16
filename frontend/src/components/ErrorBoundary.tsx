import { Component, type ErrorInfo, type ReactNode } from 'react';
import { Button } from './ui/Button';

interface Props {
  children: ReactNode;
  fallback?: ReactNode;
}

interface State {
  hasError: boolean;
  error: Error | null;
  errorInfo: ErrorInfo | null;
}

export class ErrorBoundary extends Component<Props, State> {
  constructor(props: Props) {
    super(props);
    this.state = { hasError: false, error: null, errorInfo: null };
  }

  static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error, errorInfo: null };
  }

  componentDidCatch(error: Error, errorInfo: ErrorInfo) {
    console.error('ErrorBoundary caught an error:', error, errorInfo);
    this.setState({ errorInfo });
  }

  handleReset = () => {
    this.setState({ hasError: false, error: null, errorInfo: null });
  };

  handleReload = () => {
    window.location.reload();
  };

  render() {
    if (this.state.hasError) {
      if (this.props.fallback) {
        return this.props.fallback;
      }

      return (
        <div className="flex flex-col items-center justify-center py-20 px-4 text-center">
          <div className="w-16 h-16 rounded-full bg-red-100 flex items-center justify-center text-red-500 mb-6 text-2xl font-bold">!</div>
          <h2 className="text-2xl font-bold text-slate-800 mb-2">页面渲染出错</h2>
          <p className="text-slate-500 mb-8 max-w-md">抱歉，页面发生了意外错误。您可以尝试重试组件或刷新整个页面。</p>
          <div className="flex gap-4 mb-8">
            <Button variant="outline" onClick={this.handleReset}>重试组件</Button>
            <Button onClick={this.handleReload}>刷新页面</Button>
          </div>
          {import.meta.env.DEV && this.state.error && (
            <div className="text-left w-full max-w-3xl bg-slate-50 p-6 rounded-2xl overflow-auto border border-slate-200">
              <details>
                <summary className="font-medium text-slate-700 cursor-pointer mb-4">错误详情（开发模式）</summary>
                <p className="font-mono text-xs text-red-600 mb-4">{this.state.error.toString()}</p>
                <pre className="font-mono text-xs text-slate-600">{this.state.errorInfo?.componentStack}</pre>
              </details>
            </div>
          )}
        </div>
      );
    }

    return this.props.children;
  }
}
