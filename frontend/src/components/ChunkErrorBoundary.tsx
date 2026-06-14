import { Component, type ErrorInfo, type ReactNode } from 'react';
import { Button, Result } from 'antd';

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
    // 检查是否是 chunk 加载错误
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
        <Result
          status="warning"
          title="页面加载失败"
          subTitle={
            this.state.retryCount < 3
              ? `页面资源加载失败（已重试 ${this.state.retryCount} 次）。可能是网络问题，请稍后重试。`
              : '页面资源加载多次失败，请刷新页面重试。'
          }
          extra={[
            this.state.retryCount < 3 && (
              <Button key="retry" onClick={this.handleRetry}>
                重试
              </Button>
            ),
            <Button key="reload" type="primary" onClick={this.handleReload}>
              刷新页面
            </Button>,
          ].filter(Boolean)}
        />
      );
    }

    return this.props.children;
  }
}
