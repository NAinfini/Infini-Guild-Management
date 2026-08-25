import i18n from "i18next";
import { Component, type ErrorInfo, type ReactNode } from "react";
import { Button } from "@portal/components/ui/button";

const INTERNAL_ERROR_PATTERN = /D1_ERROR|SQLITE|no such table|no such column|ECONNREFUSED|chunk|module|import|Cannot read prop/i;

interface ErrorBoundaryProps {
  children: ReactNode;
  fallback?: ReactNode;
}

interface ErrorBoundaryState {
  hasError: boolean;
  error: Error | null;
  pathname: string;
}

export class ErrorBoundary extends Component<ErrorBoundaryProps, ErrorBoundaryState> {
  constructor(props: ErrorBoundaryProps) {
    super(props);
    this.state = { hasError: false, error: null, pathname: window.location.pathname };
  }

  static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    return { hasError: true, error, pathname: window.location.pathname };
  }

  componentDidCatch(error: Error, errorInfo: ErrorInfo): void {
    console.error("[ErrorBoundary] Caught error:", error, errorInfo);
  }

  componentDidUpdate(): void {
    if (this.state.hasError && window.location.pathname !== this.state.pathname) {
      this.setState({ hasError: false, error: null, pathname: window.location.pathname });
    }
  }

  private handleReload = () => {
    window.location.reload();
  };

  private getSafeMessage(): string {
    const message = this.state.error?.message;
    if (!message || INTERNAL_ERROR_PATTERN.test(message)) {
      return i18n.t("common:errors.unexpectedError", { defaultValue: "An unexpected error occurred." });
    }
    return message;
  }

  render(): ReactNode {
    if (this.state.hasError) {
      if (this.props.fallback) return this.props.fallback;
      return (
        <div role="alert" className="flex min-h-60 items-center justify-center p-[var(--space-xl)]">
          <div className="flex max-w-lg flex-col items-center gap-[var(--space-xs)] text-center">
            <h2 className="m-0 text-xl font-semibold text-[var(--status-danger)]">
              {i18n.t("common:errors.somethingWentWrong", { defaultValue: "Something went wrong" })}
            </h2>
            <p className="m-0 text-sm text-[var(--text-secondary)]">{this.getSafeMessage()}</p>
            <Button type="button" onClick={this.handleReload} className="mt-[var(--space-sm)]">
              {i18n.t("common:action.reloadPage", { defaultValue: "Reload page" })}
            </Button>
          </div>
        </div>
      );
    }
    return this.props.children;
  }
}
