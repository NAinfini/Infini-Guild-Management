import { Component, type ErrorInfo, type ReactNode } from "react";
import { Button } from "@mantine/core";
import i18n from "i18next";

const INTERNAL_ERROR_PATTERN = /D1_ERROR|SQLITE|no such table|no such column|ECONNREFUSED|chunk|module|import|Cannot read prop/i;

interface ErrorBoundaryProps {
  children: ReactNode;
  fallback?: ReactNode;
}

interface ErrorBoundaryState {
  hasError: boolean;
  error: Error | null;
}

export class ErrorBoundary extends Component<ErrorBoundaryProps, ErrorBoundaryState> {
  constructor(props: ErrorBoundaryProps) {
    super(props);
    this.state = { hasError: false, error: null };
  }

  static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, errorInfo: ErrorInfo): void {
    console.error("[ErrorBoundary] Caught error:", error, errorInfo);
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
        <div role="alert" className="flex flex-col items-center justify-center p-8 text-center">
          <h2 className="text-lg font-semibold text-red-600 dark:text-red-400">{i18n.t("common:errors.somethingWentWrong", { defaultValue: "Something went wrong" })}</h2>
          <p className="mt-2 text-sm text-gray-500 dark:text-gray-400">
            {this.getSafeMessage()}
          </p>
          <Button
            type="button"
            onClick={this.handleReload}
            mt="md"
          >
            {i18n.t("common:action.reloadPage", { defaultValue: "Reload page" })}
          </Button>
        </div>
      );
    }
    return this.props.children;
  }
}
