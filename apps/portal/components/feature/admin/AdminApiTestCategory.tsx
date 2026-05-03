import { Badge, Group, Stack, Text } from "@mantine/core";
import { ProgressButton } from "@portal/components/effects";
import { PlayIcon } from "@portal/components/icons";
import { useTranslation } from "react-i18next";
import { type CategoryDef, type EndpointDef, type EndpointResult, methodColor, statusColor } from "./AdminApiTestEngine";

function EndpointRow({
  endpoint,
  running,
  result,
}: {
  endpoint: EndpointDef;
  running: boolean;
  result: EndpointResult | null;
}) {
  const { t } = useTranslation("admin");
  return (
    <Group gap={8} wrap="nowrap" justify="space-between">
      <Group gap={8} wrap="nowrap" style={{ flex: 1, minWidth: 0 }}>
        <Badge size="xs" variant="light" color={methodColor(endpoint.method)} style={{ flexShrink: 0 }}>
          {endpoint.method}
        </Badge>
        <Text size="sm" fw={500} truncate style={{ flex: 1 }}>
          {endpoint.label}
        </Text>
        <Text size="xs" c="dimmed" truncate style={{ maxWidth: 260 }}>
          {endpoint.path}
        </Text>
      </Group>
      <Group gap={4} wrap="nowrap" style={{ flexShrink: 0 }}>
        {result ? (
          <>
            <Badge size="xs" variant="filled" color={statusColor(result.status)}>
              {result.status ?? "ERR"}
            </Badge>
            <Text size="xs" c="dimmed">{result.latencyMs}ms</Text>
          </>
        ) : null}
        {running ? (
          <Badge size="xs" variant="light" color="blue">{t("status.api.running")}</Badge>
        ) : null}
      </Group>
    </Group>
  );
}

export function ApiTestCategory({
  category,
  onRunCategory,
  runningSet,
  resultMap,
  runLabel,
}: {
  category: CategoryDef;
  onRunCategory: (cat: CategoryDef) => Promise<void>;
  runningSet: Set<string>;
  resultMap: Map<string, EndpointResult>;
  runLabel: string;
}) {
  const catRunning = category.endpoints.some((ep) => runningSet.has(`${ep.method}-${ep.path}`));

  return (
    <Stack gap={6}>
      <Group justify="flex-end" mb={4}>
        <ProgressButton
          onPress={() => onRunCategory(category)}
          loadingLabel={runLabel}
          successLabel={runLabel}
          errorLabel={runLabel}
          disabled={catRunning}
        >
          <span style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
            <PlayIcon size={14} />
            <span>{runLabel}</span>
          </span>
        </ProgressButton>
      </Group>
      {category.endpoints.map((ep) => {
        const key = `${ep.method}-${ep.path}`;
        return (
          <EndpointRow
            key={key}
            endpoint={ep}
            running={runningSet.has(key)}
            result={resultMap.get(key) ?? null}
          />
        );
      })}
    </Stack>
  );
}
