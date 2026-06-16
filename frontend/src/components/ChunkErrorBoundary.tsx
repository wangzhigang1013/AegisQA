import { Component, type ErrorInfo, type ReactNode } from 'react';
import { Button } from './ui/Button';

interface Props {
  children: ReactNode;
  chunkName?: string;
}

interface State {
  hasError: boolean;
  error: Error | null;
  retryCount: number;
}

export class ChunkErrorBoundary extends Component<Props, State> {
  constructor(props: Props) {
    super(props);
    this.state = { hasError: false, error: null, retryCount: 0 };
  }

  static getDerivedStateFromError(error: Error): State {
    const isChunkError = error.name === 'ChunkLoadError' ||
      error.message.includes('Loading chunk') ||
      error.message.includes('Failed to fetch dynamically imported module');

    return {
      hasError: isChunkError,
      error: isChunkError ? error : null,
      retryCount: 0,
    };
  }

  componentDidCatch(error: Error, errorInfo: ErrorInfo) {
    if (error.name === 'ChunkLoadError' || error.message.includes('Loading chunk')) {
      console.warn('Chunk loading failed:', error.message);
    }
  }

  handleRetry = () => {
    this.setState(prevState => ({
      hasError: false,
      error: null,
      retryCount: prevState.retryCount + 1,
    }));
  };

  handleReload = () => {
    window.location.reload();
  };

  render() {
    if (this.state.hasError && this.state.error) {
      return (
        <div className="flex flex-col items-center justify-center py-20 text-center">
          <div className="w-16 h-16 rounded-full bg-amber-100 flex items-center justify-center text-amber-500 mb-6 text-2xl font-bold">!</div>
          <h2 className="text-2xl font-bold text-slate-800 mb-2">页面加载失败</h2>
          <p className="text-slate-500 mb-8 max-w-md">
            {this.state.retryCount < 3
              ? `页面资源加载失败（已重试 ${this.state.retryCount} 次）。可能是网络问题，请稍后重试。`
              : '页面资源加载多次失败，请刷新页面重试。'}
          </p>
          <div className="flex gap-4">
            {this.state.retryCount < 3 && (
              <Button variant="outline" onClick={this.handleRetry}>重试</Button>
            )}
            <Button onClick={this.handleReload}>刷新页面</Button>
          </div>
        </div>
      );
    }

    return this.props.children;
  }
}
