import { Badge, Group, Modal, Stack, Text } from "@mantine/core";
import { useMemo } from "react";
import { useTranslation } from "react-i18next";
import { BoltIcon } from "@portal/components/icons";
import { ClassIcon } from "@portal/components/shared/ClassIcon";
import { resolveClassCatalogItem, useClassCatalogStore } from "@portal/stores/class-catalog";
import { sanitizeTitleHtml } from "../../../utils/sanitize";

type ActiveMemberDetail = {
  username: string;
  power: number;
  classes: string[];
  titleHtml: string | null;
  teamName: string;
  roleTag: string | null;
  kills: number;
  deaths: number;
  assists: number;
  damage: number;
  healing: number;
  buildingDamage: number;
  credits: number;
};

type WarMemberDetailModalProps = {
  open: boolean;
  activeDetailUserId: string | null;
  activeDetail: ActiveMemberDetail | null;
  onClose: () => void;
};

export function WarMemberDetailModal({
  open,
  activeDetailUserId,
  activeDetail,
  onClose,
}: WarMemberDetailModalProps) {
  const { t } = useTranslation("guild-war");
  const classCatalog = useClassCatalogStore((state) => state.items);
  const safeTitleHtml = useMemo(
    () => (activeDetail?.titleHtml ? sanitizeTitleHtml(activeDetail.titleHtml) : ""),
    [activeDetail?.titleHtml],
  );
  return (
    <Modal
      opened={open}
      title={activeDetail?.username ?? activeDetailUserId ?? ""}
      onClose={onClose}
      withCloseButton
      centered
      size="md"
      classNames={{
        content: "guild-war-member-detail",
        body: "guild-war-member-detail__body",
      }}
    >
      {activeDetail ? (
        <Stack gap={16}>
          <div className="guild-war-member-detail__identity">
            <div>
              {safeTitleHtml ? (
                <Text size="sm" c="dimmed" dangerouslySetInnerHTML={{ __html: safeTitleHtml }} />
              ) : (
                <Text size="sm" c="dimmed">{t("memberDetail.titleFallback")}</Text>
              )}
              <Group gap={8} wrap="wrap" mt={8}>
                {activeDetail.classes.map((classId) => {
                  const item = resolveClassCatalogItem(classId, classCatalog);
                  return (
                    <Badge
                      key={classId}
                      variant="light"
                      size="sm"
                      color={item.color}
                      leftSection={<ClassIcon item={item} size={16} framed={false} />}
                    >
                      {item.label}
                    </Badge>
                  );
                })}
              </Group>
            </div>
            <div className="guild-war-member-detail__power">
              <BoltIcon size={16} aria-hidden="true" />
              <Text component="strong" className="tabular-nums">
                {activeDetail.power.toLocaleString()}
              </Text>
            </div>
          </div>

          <div className="guild-war-member-detail__assignment">
            <div>
              <Text size="xs" c="dimmed">{t("memberDetail.team")}</Text>
              <Text size="sm" fw={600}>{activeDetail.teamName}</Text>
            </div>
            <div>
              <Text size="xs" c="dimmed">{t("memberDetail.roleTag")}</Text>
              <Text size="sm" fw={600}>{activeDetail.roleTag ?? "-"}</Text>
            </div>
          </div>

          <section className="guild-war-member-detail__stats">
            <Text size="xs" fw={600} c="dimmed">{t("memberDetail.statsHeader")}</Text>
            <div className="guild-war-member-detail__stat-grid">
              <MemberStat label={t("memberDetail.kda")} value={`${activeDetail.kills}/${activeDetail.deaths}/${activeDetail.assists}`} />
              <MemberStat label={t("memberDetail.damage")} value={activeDetail.damage.toLocaleString()} />
              <MemberStat label={t("memberDetail.healing")} value={activeDetail.healing.toLocaleString()} />
              <MemberStat label={t("memberDetail.building")} value={activeDetail.buildingDamage.toLocaleString()} />
              <MemberStat label={t("memberDetail.credits")} value={activeDetail.credits.toLocaleString()} />
            </div>
          </section>
        </Stack>
      ) : null}
    </Modal>
  );
}

function MemberStat({ label, value }: { label: string; value: string }) {
  return (
    <div className="guild-war-member-detail__stat">
      <Text size="xs" c="dimmed">{label}</Text>
      <Text fw={700} className="tabular-nums">{value}</Text>
    </div>
  );
}
