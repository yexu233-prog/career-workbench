import { Component, type ErrorInfo, type ReactNode } from "react";

interface Props {
  children: ReactNode;
}

interface State {
  hasError: boolean;
}

export class AppErrorBoundary extends Component<Props, State> {
  override state: State = { hasError: false };

  static getDerivedStateFromError(): State {
    return { hasError: true };
  }

  override componentDidCatch(error: Error, errorInfo: ErrorInfo): void {
    console.error("应用页面发生错误", error, errorInfo);
  }

  override render(): ReactNode {
    if (this.state.hasError) {
      return (
        <main className="fatal-error">
          <p className="eyebrow">页面暂时无法显示</p>
          <h1>你的本机数据仍然保留</h1>
          <p>请重新加载页面。如果问题持续出现，可以前往故障诊断查看错误信息。</p>
          <button type="button" onClick={() => window.location.reload()}>
            重新加载
          </button>
        </main>
      );
    }

    return this.props.children;
  }
}
