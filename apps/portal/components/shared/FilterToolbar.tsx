import { Group } from "@mantine/core";
import { InfiniCard } from "@infini-dev-kit/frontend/components";
import type { ReactNode } from "react";

type FilterToolbarProps = {
  children: ReactNode;
  className?: string;
  contentClassName?: string;
};

function joinClassNames(...parts: Array<string | undefined>): string | undefined {
  const className = parts.filter(Boolean).join(" ");
  return className.length > 0 ? className : undefined;
}

export function FilterToolbar({ children, className, contentClassName }: FilterToolbarProps) {
  return (
    <InfiniCard className={className} interactive={false}>
      <div style={{ padding: "1.2rem" }}>
        <Group wrap="wrap" gap={8} align="center" className={joinClassNames(contentClassName)}>
          {children}
        </Group>
      </div>
    </InfiniCard>
  );
}

