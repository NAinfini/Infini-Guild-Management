import { PortalCard } from "../../shared/PortalCard";
import { Alert, Skeleton, Stack, Text, UnstyledButton } from "@mantine/core";
import type { ReactNode } from "react";
import { EmptyState } from "../../shared/EmptyState";

type DataNode = {
  key: string;
  title: ReactNode;
  children?: DataNode[];
  disabled?: boolean;
};

type WikiCategoryTreeCardProps = {
  title: ReactNode;
  treeData: DataNode[];
  selectedCategoryId?: string;
  isLoading: boolean;
  isError: boolean;
  warningMessage: ReactNode;
  emptyTitle: ReactNode;
  onSelectCategory: (categoryId: string) => void;
};

export function WikiCategoryTreeCard({
  title,
  treeData,
  selectedCategoryId,
  isLoading,
  isError,
  warningMessage,
  emptyTitle,
  onSelectCategory,
}: WikiCategoryTreeCardProps) {
  const renderNodes = (nodes: DataNode[], depth: number): ReactNode =>
    nodes.map((node) => {
      const isSelected = selectedCategoryId === node.key;
      return (
        <li key={node.key} style={{ listStyle: "none", marginLeft: depth * 12 }}>
          <UnstyledButton
            disabled={node.disabled}
            onClick={() => onSelectCategory(node.key)}
            style={{
              display: "block",
              width: "100%",
              textAlign: "left",
              padding: "4px 0",
              cursor: node.disabled ? "not-allowed" : "pointer",
              color: isSelected ? "var(--mantine-color-blue-6)" : "inherit",
            }}
          >
            {node.title}
          </UnstyledButton>
          {node.children && node.children.length > 0 ? (
            <ul style={{ margin: 0, padding: 0 }}>{renderNodes(node.children, depth + 1)}</ul>
          ) : null}
        </li>
      );
    });

  return (
    <PortalCard className="wiki-category-tree-card" interactive={false}>
      <div style={{ padding: "1.2rem" }}>
        <Stack gap={10}>
          {title ? <Text fw={600}>{title}</Text> : null}
          {isLoading ? (
            <Stack gap={8}>
              {Array.from({ length: 4 }).map((_, index) => (
                <Skeleton key={index} height={12} />
              ))}
            </Stack>
          ) : null}
          {isError ? <Alert color="infini-warning" title={warningMessage} /> : null}
        {!isLoading && !isError && treeData.length > 0 ? (
          <ul style={{ margin: 0, padding: 0 }}>{renderNodes(treeData, 0)}</ul>
        ) : null}
        {!isLoading && !isError && treeData.length === 0 ? <EmptyState title={emptyTitle} /> : null}
        </Stack>
      </div>
    </PortalCard>
  );
}

