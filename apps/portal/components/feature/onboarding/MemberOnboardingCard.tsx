import type { MemberOnboardingResponse } from "@guild/shared";
import { Alert, Button, Checkbox, Group, Stack, Text } from "@mantine/core";
import { TipTapEditor } from "@portal/components/shared/TipTapEditor";
import { useTranslation } from "react-i18next";

type MemberOnboardingCardProps = {
  onboarding: MemberOnboardingResponse | null;
  loading: boolean;
  updating: boolean;
  acknowledging: boolean;
  onProgressChange: (completedItemIds: string[]) => void;
  onAcknowledge: () => void;
};

export function MemberOnboardingCard({
  onboarding,
  loading,
  updating,
  acknowledging,
  onProgressChange,
  onAcknowledge,
}: MemberOnboardingCardProps) {
  const { t } = useTranslation("profile");

  if (loading) {
    return <Text c="dimmed">{t("common:loading")}</Text>;
  }

  if (!onboarding) {
    return <Alert color="gray">{t("onboarding.empty")}</Alert>;
  }

  const completed = new Set(onboarding.state.completed_item_ids);
  const requiredChecklistComplete = onboarding.config.checklist.every((item) => !item.required || completed.has(item.id));
  const toggleItem = (id: string, checked: boolean) => {
    const next = new Set(completed);
    if (checked) next.add(id);
    else next.delete(id);
    onProgressChange([...next]);
  };

  return (
    <Stack gap={16}>
      <Group justify="space-between" align="flex-start">
        <div>
          <Text fw={700}>{onboarding.config.title}</Text>
        </div>
        {onboarding.is_complete ? <Text size="sm" c="teal">{t("onboarding.complete")}</Text> : null}
      </Group>

      <TipTapEditor value={onboarding.config.body_json} onChange={() => undefined} readOnly />

      {onboarding.config.checklist.length > 0 ? (
        <Stack gap={8}>
          <Text size="sm" fw={600}>{t("onboarding.checklist")}</Text>
          {onboarding.config.checklist.map((item) => (
            <Checkbox
              key={item.id}
              checked={completed.has(item.id)}
              disabled={updating}
              onChange={(event) => toggleItem(item.id, event.currentTarget.checked)}
              label={
                <span>
                  <Text span size="sm">{item.label}</Text>
                  {item.description ? <Text size="xs" c="dimmed">{item.description}</Text> : null}
                </span>
              }
            />
          ))}
        </Stack>
      ) : null}

      {onboarding.config.require_ack ? (
        <Group justify="flex-end">
          <Button disabled={onboarding.state.acknowledged_at !== null || !requiredChecklistComplete} loading={acknowledging} onClick={onAcknowledge}>
            {onboarding.state.acknowledged_at ? t("onboarding.acknowledged") : t("onboarding.acknowledge")}
          </Button>
        </Group>
      ) : null}
    </Stack>
  );
}
