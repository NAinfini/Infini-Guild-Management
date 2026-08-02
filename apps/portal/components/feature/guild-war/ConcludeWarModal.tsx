import {
  Button,
  Group,
  Modal,
  NumberInput,
  ScrollArea,
  Select,
  Stack,
  Table,
  Text,
  TextInput,
} from "@mantine/core";
import { FlagIcon } from "@portal/components/icons";
import { MetricGridInput } from "@portal/components/shared/MetricGridInput";
import { SectionHeader } from "@portal/components/shared/SectionHeader";
import { activeGame } from "@guild/shared/games";
import { useCallback, useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";

// --- Types ---

export type ConcludeWarMember = {
  userId: string;
  username: string;
  teamName: string;
  stats: Record<string, number>;
};

export type ConcludeWarInfo = {
  enemyName: string;
  result: string;
  durationMinutes: number | null;
  ownStats: Record<string, number | null>;
  enemyStats: Record<string, number | null>;
};

export type ConcludeWarSubmitData = {
  warInfo: ConcludeWarInfo;
  memberStats: Array<{
    user_id: string;
    stats: Record<string, number>;
  }>;
};

type ConcludeWarModalProps = {
  opened: boolean;
  onClose: () => void;
  onSubmit: (data: ConcludeWarSubmitData) => void;
  members: ConcludeWarMember[];
  pending: boolean;
  warName: string;
};

const MEMBER_STAT_FIELDS = activeGame.war.memberStats.map((s) => ({
  key: s.key,
  apiKey: s.key,
}));

const TEAM_OBJECTIVE_FIELDS = activeGame.war.teamObjectives.filter((o) => o.hasBothSides);

function createInitialWarInfo(): ConcludeWarInfo {
  return {
    enemyName: "",
    result: "",
    durationMinutes: null,
    ownStats: Object.fromEntries(TEAM_OBJECTIVE_FIELDS.map((objective) => [objective.key, null])),
    enemyStats: Object.fromEntries(TEAM_OBJECTIVE_FIELDS.map((objective) => [objective.key, null])),
  };
}

function createInitialMemberStats(
  members: ConcludeWarMember[],
): Map<string, Record<string, number>> {
  return new Map(members.map((member) => [member.userId, { ...member.stats }]));
}

// --- Component ---

export function ConcludeWarModal({
  opened,
  onClose,
  onSubmit,
  members,
  pending,
  warName,
}: ConcludeWarModalProps) {
  const { t } = useTranslation("guild-war");

  const [warInfo, setWarInfo] = useState<ConcludeWarInfo>(createInitialWarInfo);
  const [memberStatsMap, setMemberStatsMap] = useState<Map<string, Record<string, number>>>(
    () => createInitialMemberStats(members),
  );

  useEffect(() => {
    setMemberStatsMap(createInitialMemberStats(members));
    if (!opened) {
      setWarInfo(createInitialWarInfo());
    }
  }, [members, opened]);

  const handleClose = useCallback(() => {
    if (!pending) {
      onClose();
    }
  }, [onClose, pending]);

  const updateWarInfoField = useCallback(
    <K extends keyof ConcludeWarInfo>(key: K, value: ConcludeWarInfo[K]) => {
      setWarInfo((prev) => ({ ...prev, [key]: value }));
    },
    [],
  );

  const updateOwnStat = useCallback((key: string, value: number | null) => {
    setWarInfo((prev) => ({ ...prev, ownStats: { ...prev.ownStats, [key]: value } }));
  }, []);

  const updateEnemyStat = useCallback((key: string, value: number | null) => {
    setWarInfo((prev) => ({ ...prev, enemyStats: { ...prev.enemyStats, [key]: value } }));
  }, []);

  const updateMemberStat = useCallback(
    (userId: string, field: string, value: number) => {
      setMemberStatsMap((prev) => {
        const next = new Map(prev);
        const current = next.get(userId) ?? {};
        next.set(userId, { ...current, [field]: value });
        return next;
      });
    },
    [],
  );

  const handleSubmit = useCallback(() => {
    const memberStats = members.map((m) => {
      const stats = memberStatsMap.get(m.userId) ?? {};
      return { user_id: m.userId, stats };
    });
    onSubmit({ warInfo, memberStats });
  }, [members, memberStatsMap, onSubmit, warInfo]);

  const resultOptions = useMemo(
    () =>
      activeGame.war.resultOptions.map((value) => ({
        value,
        label: t(`conclude.result.${value}`),
      })),
    [t],
  );

  return (
    <Modal
      opened={opened}
      onClose={handleClose}
      title={t("conclude.title", { warName })}
      size="min(960px, calc(100vw - 2rem))"
      centered
      closeOnClickOutside={false}
      closeOnEscape={!pending}
      closeButtonProps={{
        disabled: pending,
        "aria-label": t("common:action.close"),
      }}
      classNames={{
        content: "conclude-war-modal",
        body: "conclude-war-modal__body",
      }}
    >
      <Stack gap={0} className="conclude-war-modal__layout">
        <ScrollArea.Autosize
          mah="calc(100dvh - 11rem)"
          type="auto"
          offsetScrollbars
        >
          <Stack gap={16} className="conclude-war-modal__content">
            <section className="conclude-war-modal__section">
              <SectionHeader title={t("conclude.section.warInfo")} className="section-header--flush" />
              <div className="conclude-war-modal__war-fields">
                <TextInput
                  className="conclude-war-modal__enemy"
                  label={t("conclude.field.enemyName")}
                  value={warInfo.enemyName}
                  onChange={(event) => updateWarInfoField("enemyName", event.currentTarget.value)}
                />
                <Select
                  label={t("conclude.field.result")}
                  data={resultOptions}
                  value={warInfo.result || null}
                  onChange={(value) => updateWarInfoField("result", value ?? "")}
                  clearable
                />
                <NumberInput
                  label={t("conclude.field.duration")}
                  value={warInfo.durationMinutes ?? ""}
                  onChange={(value) => updateWarInfoField("durationMinutes", typeof value === "number" ? value : null)}
                  min={0}
                  hideControls
                  suffix=" min"
                />
              </div>

              {TEAM_OBJECTIVE_FIELDS.length > 0 ? (
                <table
                  aria-label={t("conclude.section.objectives")}
                  className="conclude-war-modal__objective-ledger"
                >
                  <thead>
                    <tr>
                      <th scope="col">{t("conclude.section.objectives")}</th>
                      <th scope="col">{t("history.compare.us")}</th>
                      <th scope="col">{t("history.compare.enemy")}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {TEAM_OBJECTIVE_FIELDS.map((objective, rowIndex) => {
                      const objectiveLabel = t(objective.label.replace(/^guild-war:/, ""));
                      return (
                        <tr key={objective.key}>
                          <th scope="row">{objectiveLabel}</th>
                          <td>
                            <MetricGridInput
                              className="conclude-war-modal__objective-input"
                              aria-label={t("conclude.aria.objectiveMetric", {
                                metric: t(`conclude.field.own_${objective.key}`, { defaultValue: `Own ${objective.key}` }),
                              })}
                              gridId="conclude-war-objectives"
                              rowIndex={rowIndex}
                              columnIndex={0}
                              rowCount={TEAM_OBJECTIVE_FIELDS.length}
                              columnCount={2}
                              value={warInfo.ownStats[objective.key] ?? ""}
                              onChange={(value) => updateOwnStat(objective.key, typeof value === "number" ? value : null)}
                              min={0}
                              size="xs"
                              variant="unstyled"
                              hideControls
                            />
                          </td>
                          <td>
                            <MetricGridInput
                              className="conclude-war-modal__objective-input"
                              aria-label={t("conclude.aria.objectiveMetric", {
                                metric: t(`conclude.field.enemy_${objective.key}`, { defaultValue: `Enemy ${objective.key}` }),
                              })}
                              gridId="conclude-war-objectives"
                              rowIndex={rowIndex}
                              columnIndex={1}
                              rowCount={TEAM_OBJECTIVE_FIELDS.length}
                              columnCount={2}
                              value={warInfo.enemyStats[objective.key] ?? ""}
                              onChange={(value) => updateEnemyStat(objective.key, typeof value === "number" ? value : null)}
                              min={0}
                              size="xs"
                              variant="unstyled"
                              hideControls
                            />
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              ) : null}
            </section>

            {members.length > 0 ? (
              <section className="conclude-war-modal__section">
                <div className="conclude-war-modal__section-heading">
                  <SectionHeader title={t("conclude.section.memberStats")} className="section-header--flush" />
                  <Text size="xs" c="dimmed">
                    {t("conclude.keyboardHint")}
                  </Text>
                </div>
                <ScrollArea
                  h={Math.min(members.length * 42 + 42, 252)}
                  type="auto"
                  className="conclude-war-modal__table-scroll"
                >
                  <Table
                    striped
                    highlightOnHover
                    withTableBorder
                    withColumnBorders
                    className="conclude-war-modal__table"
                  >
                    <Table.Thead>
                      <Table.Tr>
                        <Table.Th className="conclude-war-modal__sticky-col">
                          {t("conclude.col.member")}
                        </Table.Th>
                        {MEMBER_STAT_FIELDS.map((field) => (
                          <Table.Th key={field.key} className="conclude-war-modal__metric-heading">
                            {t(`conclude.col.${field.key}`)}
                          </Table.Th>
                        ))}
                      </Table.Tr>
                    </Table.Thead>
                    <Table.Tbody>
                      {members.map((member, rowIndex) => {
                        const stats = memberStatsMap.get(member.userId) ?? {};
                        return (
                          <Table.Tr key={member.userId}>
                            <Table.Td className="conclude-war-modal__sticky-col conclude-war-modal__sticky-col--cell">
                              <Text size="xs" fw={500} lineClamp={1}>{member.username}</Text>
                              <Text size="xs" c="dimmed">{member.teamName}</Text>
                            </Table.Td>
                            {MEMBER_STAT_FIELDS.map((field, columnIndex) => (
                              <Table.Td key={field.key} className="conclude-war-modal__metric-cell">
                                <MetricGridInput
                                  className="conclude-war-modal__metric-input"
                                  aria-label={t("conclude.aria.memberMetric", {
                                    member: member.username,
                                    metric: t(`conclude.col.${field.key}`),
                                  })}
                                  gridId="conclude-war-member-stats"
                                  rowIndex={rowIndex}
                                  columnIndex={columnIndex}
                                  rowCount={members.length}
                                  columnCount={MEMBER_STAT_FIELDS.length}
                                  size="xs"
                                  variant="unstyled"
                                  hideControls
                                  value={stats[field.apiKey] ?? 0}
                                  onChange={(value) => updateMemberStat(member.userId, field.apiKey, typeof value === "number" ? value : 0)}
                                  min={0}
                                />
                              </Table.Td>
                            ))}
                          </Table.Tr>
                        );
                      })}
                    </Table.Tbody>
                  </Table>
                </ScrollArea>
              </section>
            ) : null}
          </Stack>
        </ScrollArea.Autosize>

        <Group justify="flex-end" gap={8} className="conclude-war-modal__footer">
          <Button data-autofocus variant="default" onClick={handleClose} disabled={pending}>
            {t("common:action.cancel")}
          </Button>
          <Button
            color="red"
            leftSection={<FlagIcon size={16} />}
            onClick={handleSubmit}
            loading={pending}
            disabled={!warInfo.result}
          >
            {t("conclude.submit")}
          </Button>
        </Group>
      </Stack>
    </Modal>
  );
}
