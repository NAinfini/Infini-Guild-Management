import type { Event, MemberProfile, User } from "@guild/shared";
import { Button, Group, Stack, Text } from "@mantine/core";
import { GiftIcon } from "@portal/components/icons";
import { MemberRoleAvatar } from "@portal/components/shared/MemberRoleAvatar";
import { useConfirmDialog } from "@portal/hooks/useConfirmDialog";
import { useTranslation } from "react-i18next";

type MemberEntry = { user: User; profile: MemberProfile };

type EventDetailRaffleProps = {
  event: Event;
  members: MemberEntry[];
  allUsers: MemberEntry[];
  canManage: boolean;
  onDrawRaffle?: (eventId: string) => void;
  drawRafflePending?: boolean;
};

/* 详情弹窗右栏的抽奖区：开奖前报名池，开奖后中奖名单。 */
export function EventDetailRaffle({
  event,
  members,
  allUsers,
  canManage,
  onDrawRaffle,
  drawRafflePending,
}: EventDetailRaffleProps) {
  const { t } = useTranslation("events");
  const confirm = useConfirmDialog();
  const winners = event.raffle_winners ?? [];
  const hasDrawn = winners.length > 0;

  const handleDraw = async () => {
    if (!onDrawRaffle) {
      return;
    }
    const confirmed = await confirm({
      title: t("raffle.confirm.draw.title"),
      description: (
        <Text size="sm">
          {t("raffle.confirm.draw.description", { count: event.winner_count ?? 0, pool: members.length })}
        </Text>
      ),
      confirmLabel: t("raffle.detail.drawNow"),
      cancelLabel: t("button.cancel"),
      intent: "warning",
    });
    if (confirmed) {
      onDrawRaffle(event.id);
    }
  };

  return (
    <section className="event-detail-modal__section event-detail-modal__section--raffle">
      <Group justify="space-between" gap={12} mb={12} wrap="nowrap">
        <Group gap={8}>
          <GiftIcon size={20} />
          <Text size="md" fw={800}>{t("raffle.detail.title")}</Text>
        </Group>
        {hasDrawn ? (
          <Text size="xs" fw={700} c="dimmed">{t("raffle.status.drawn")}</Text>
        ) : canManage && onDrawRaffle && members.length > 0 ? (
          <Button
            variant="light"
            color="pink"
            size="xs"
            loading={drawRafflePending}
            disabled={Boolean(event.archived_at)}
            leftSection={<GiftIcon size={14} />}
            onClick={() => void handleDraw()}
          >
            {t("raffle.detail.drawNow")}
          </Button>
        ) : (
          <Text size="xs" fw={700} c="dimmed">{t("raffle.status.pendingDraw")}</Text>
        )}
      </Group>
      {hasDrawn ? (
        <Stack gap={8}>
          <Text size="sm" fw={600} c="dimmed">{t("raffle.detail.winnersLabel")}</Text>
          {winners.map((winner) => {
            const entry = allUsers.find((candidate) => candidate.user.id === winner.user_id);
            return (
              <Group key={winner.id} gap={10} wrap="nowrap">
                {entry ? (
                  <>
                    <MemberRoleAvatar user={entry.user} profile={entry.profile} size={36} withTooltip={false} />
                    <Text size="sm" fw={700}>{entry.user.username}</Text>
                  </>
                ) : (
                  <Text size="sm" c="dimmed">{winner.user_id}</Text>
                )}
              </Group>
            );
          })}
        </Stack>
      ) : (
        <Stack gap={4}>
          <Text size="sm" c="dimmed">{t("raffle.detail.winnerCount", { count: event.winner_count ?? 0 })}</Text>
          <Text size="sm" c="dimmed">{t("raffle.detail.pool", { count: members.length })}</Text>
          {!canManage ? <Text size="xs" c="dimmed">{t("raffle.detail.pendingDraw")}</Text> : null}
        </Stack>
      )}
    </section>
  );
}
