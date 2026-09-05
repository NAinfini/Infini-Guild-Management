import type { MemberDirectoryEntry } from "@guild/shared";
import { Button } from "@portal/components/ui/button";
import { GiftIcon } from "@portal/components/icons";
import { useConfirmDialog } from "@portal/hooks/useConfirmDialog";
import { useTranslation } from "react-i18next";
import { EventMemberIdentity } from "./EventMemberIdentity";
import type { EventDetailResponse } from "@portal/services/EventService";

type MemberEntry = MemberDirectoryEntry;

type EventDetailRaffleProps = {
  event: EventDetailResponse;
  allUsers: MemberEntry[];
  canManage: boolean;
  onDrawRaffle?: (eventId: string) => void;
  drawRafflePending?: boolean;
};

/* 详情弹窗右栏的抽奖区：开奖前报名池，开奖后中奖名单。 */
export function EventDetailRaffle({
  event,
  allUsers,
  canManage,
  onDrawRaffle,
  drawRafflePending,
}: EventDetailRaffleProps) {
  const { t } = useTranslation("events");
  const confirm = useConfirmDialog();
  const winners = event.raffle_winners ?? [];
  const hasDrawn = winners.length > 0;
  const participantCount = event.participants.length;

  const handleDraw = async () => {
    if (!onDrawRaffle) {
      return;
    }
    const confirmed = await confirm({
      title: t("raffle.confirm.draw.title"),
      description: <p>{t("raffle.confirm.draw.description", { count: event.winner_count ?? 0, pool: participantCount })}</p>,
      confirmLabel: t("raffle.detail.drawNow"),
      cancelLabel: t("button.cancel"),
      intent: "warning",
    });
    if (confirmed) {
      onDrawRaffle(event.id);
    }
  };

  return (
    <section className="event-detail-content__section event-detail-content__section--raffle">
      <div className="event-detail-content__raffle-header">
        <div className="event-detail-content__raffle-heading">
          <GiftIcon size={20} />
          <h2>{t("raffle.detail.title")}</h2>
        </div>
        {hasDrawn ? (
          <strong className="event-detail-content__raffle-status">{t("raffle.status.drawn")}</strong>
        ) : canManage && onDrawRaffle && participantCount > 0 ? (
          <Button
            variant="secondary"
            size="xs"
            loading={drawRafflePending}
            disabled={Boolean(event.archived_at)}
            onClick={() => void handleDraw()}
          >
            <GiftIcon size={14} />
            {t("raffle.detail.drawNow")}
          </Button>
        ) : (
          <strong className="event-detail-content__raffle-status">{t("raffle.status.pendingDraw")}</strong>
        )}
      </div>
      {hasDrawn ? (
        <div className="event-detail-content__raffle-stack">
          <p className="event-detail-content__raffle-copy">{t("raffle.detail.winnersLabel")}</p>
          {winners.map((winner) => {
            const entry = allUsers.find((candidate) => candidate.user.id === winner.user_id);
            return (
              /* 跟下面报名名单同一种行：同一个弹窗里同一批人不该有两种长相。 */
              <div
                key={winner.id}
                className="event-detail-content__member-row"
              >
                {entry ? (
                  <EventMemberIdentity entry={entry} />
                ) : (
                  <span className="event-detail-content__raffle-copy">{winner.user_id}</span>
                )}
              </div>
            );
          })}
        </div>
      ) : (
        <div className="event-detail-content__raffle-stack">
          <p className="event-detail-content__raffle-copy">{t("raffle.detail.winnerCount", { count: event.winner_count ?? 0 })}</p>
          <p className="event-detail-content__raffle-copy">{t("raffle.detail.pool", { count: participantCount })}</p>
          {!canManage ? <p className="event-detail-content__raffle-copy">{t("raffle.detail.pendingDraw")}</p> : null}
        </div>
      )}
    </section>
  );
}
