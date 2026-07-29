import { Button, Center, Stack, Text, Title } from "@mantine/core";
import i18n from "i18next";
import { Component, type ErrorInfo, type ReactNode } from "react";

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
        <Center role="alert" p="xl" mih={240}>
          <Stack align="center" gap="xs">
            <Title order={2} size="h3" c="red" ta="center">
              {i18n.t("common:errors.somethingWentWrong", { defaultValue: "Something went wrong" })}
            </Title>
            <Text size="sm" c="dimmed" ta="center">
            {this.getSafeMessage()}
            </Text>
            <Button type="button" onClick={this.handleReload} mt="sm">
              {i18n.t("common:action.reloadPage", { defaultValue: "Reload page" })}
            </Button>
          </Stack>
        </Center>
      );
    }
    return this.props.children;
  }
}
