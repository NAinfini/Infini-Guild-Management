import { Box, Stack } from "@mantine/core";
import { Children, type ReactNode } from "react";

interface StaggerListProps {
  children: ReactNode;
  className?: string;
  staggerMs?: number;
}

export function StaggerList({ children, className, staggerMs = 60 }: StaggerListProps) {
  return (
    <Stack gap={0} className={className}>
      {Children.map(children, (child, i) => (
        <Box
          style={{
            animation: "fadeInUp 0.4s ease-out both",
            animationDelay: `${i * staggerMs}ms`,
          }}
        >
          {child}
        </Box>
      ))}
    </Stack>
  );
}
