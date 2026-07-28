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

  const [warInfo, setWarInfo] = useState<ConcludeWarInfo>(() => ({
    enemyName: "",
    result: "",
    durationMinutes: null,
    ownStats: Object.fromEntries(TEAM_OBJECTIVE_FIELDS.map((o) => [o.key, null])),
    enemyStats: Object.fromEntries(TEAM_OBJECTIVE_FIELDS.map((o) => [o.key, null])),
  }));

  const [memberStatsMap, setMemberStatsMap] = useState<Map<string, Record<string, number>>>(() => {
    const map = new Map<string, Record<string, number>>();
    for (const m of members) {
      map.set(m.userId, { ...m.stats });
    }
    return map;
  });

  useEffect(() => {
    const map = new Map<string, Record<string, number>>();
    for (const m of members) {
      map.set(m.userId, { ...m.stats });
    }
    setMemberStatsMap(map);
  }, [members]);

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
      onClose={onClose}
      title={t("conclude.title", { warName })}
      size="xl"
      centered
      closeOnClickOutside={false}
    >
      <Stack gap={16}>
        {/* Section 1: War-level info */}
        <Text size="sm" fw={600} tt="uppercase" c="dimmed">
          {t("conclude.section.warInfo")}
        </Text>
        <Group gap={10} wrap="wrap" grow>
          <TextInput
            label={t("conclude.field.enemyName")}
            value={warInfo.enemyName}
            onChange={(e) => updateWarInfoField("enemyName", e.currentTarget.value)}
            style={{ flex: "1 1 180px" }}
          />
          <Select
            label={t("conclude.field.result")}
            data={resultOptions}
            value={warInfo.result || null}
            onChange={(v) => updateWarInfoField("result", v ?? "")}
            clearable
            style={{ flex: "0 1 140px" }}
          />
          <NumberInput
            label={t("conclude.field.duration")}
            value={warInfo.durationMinutes ?? ""}
            onChange={(v) => updateWarInfoField("durationMinutes", typeof v === "number" ? v : null)}
            min={0}
            hideControls
            suffix=" min"
            style={{ flex: "0 1 130px" }}
          />
        </Group>

        {/* Own vs Enemy stats — driven by teamObjectives */}
        {TEAM_OBJECTIVE_FIELDS.length > 0 ? (
          <Group gap={10} wrap="wrap" grow>
            {TEAM_OBJECTIVE_FIELDS.map((obj, rowIndex) => (
              <Group key={obj.key} gap={10} wrap="wrap" grow style={{ flex: "1 1 200px" }}>
                <MetricGridInput
                  label={t(`conclude.field.own_${obj.key}`, { defaultValue: `Own ${obj.key}` })}
                  aria-label={t("conclude.aria.objectiveMetric", {
                    metric: t(`conclude.field.own_${obj.key}`, { defaultValue: `Own ${obj.key}` }),
                  })}
                  gridId="conclude-war-objectives"
                  rowIndex={rowIndex}
                  columnIndex={0}
                  rowCount={TEAM_OBJECTIVE_FIELDS.length}
                  columnCount={2}
                  value={warInfo.ownStats[obj.key] ?? ""}
                  onChange={(v) => updateOwnStat(obj.key, typeof v === "number" ? v : null)}
                  min={0}
                  hideControls
                  style={{ flex: "1 1 100px" }}
                />
                <MetricGridInput
                  label={t(`conclude.field.enemy_${obj.key}`, { defaultValue: `Enemy ${obj.key}` })}
                  aria-label={t("conclude.aria.objectiveMetric", {
                    metric: t(`conclude.field.enemy_${obj.key}`, { defaultValue: `Enemy ${obj.key}` }),
                  })}
                  gridId="conclude-war-objectives"
                  rowIndex={rowIndex}
                  columnIndex={1}
                  rowCount={TEAM_OBJECTIVE_FIELDS.length}
                  columnCount={2}
                  value={warInfo.enemyStats[obj.key] ?? ""}
                  onChange={(v) => updateEnemyStat(obj.key, typeof v === "number" ? v : null)}
                  min={0}
                  hideControls
                  style={{ flex: "1 1 100px" }}
                />
              </Group>
            ))}
          </Group>
        ) : null}

        {/* Section 2: Member stats table */}
        {members.length > 0 ? (
          <>
            <Text size="sm" fw={600} tt="uppercase" c="dimmed">
              {t("conclude.section.memberStats")}
            </Text>
            <Text size="xs" c="dimmed">
              {t("conclude.keyboardHint")}
            </Text>
            <ScrollArea h={Math.min(members.length * 48 + 48, 360)} type="auto">
              <Table striped highlightOnHover withTableBorder withColumnBorders style={{ fontSize: "0.8rem" }}>
                <Table.Thead>
                  <Table.Tr>
                    <Table.Th className="conclude-war-modal__sticky-col">
                      {t("conclude.col.member")}
                    </Table.Th>
                    {MEMBER_STAT_FIELDS.map((f) => (
                      <Table.Th key={f.key} style={{ minWidth: 70, textAlign: "center" }}>
                        {t(`conclude.col.${f.key}`)}
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
                        {MEMBER_STAT_FIELDS.map((f, columnIndex) => (
                          <Table.Td key={f.key} style={{ padding: "2px 4px" }}>
                            <MetricGridInput
                              aria-label={t("conclude.aria.memberMetric", {
                                member: member.username,
                                metric: t(`conclude.col.${f.key}`),
                              })}
                              gridId="conclude-war-member-stats"
                              rowIndex={rowIndex}
                              columnIndex={columnIndex}
                              rowCount={members.length}
                              columnCount={MEMBER_STAT_FIELDS.length}
                              size="xs"
                              variant="unstyled"
                              hideControls
                              value={stats[f.apiKey] ?? 0}
                              onChange={(v) => updateMemberStat(member.userId, f.apiKey, typeof v === "number" ? v : 0)}
                              min={0}
                              styles={{ input: { textAlign: "center", padding: "2px 4px" } }}
                            />
                          </Table.Td>
                        ))}
                      </Table.Tr>
                    );
                  })}
                </Table.Tbody>
              </Table>
            </ScrollArea>
          </>
        ) : null}

        {/* Actions */}
        <Group justify="flex-end" gap={8}>
          <Button variant="default" onClick={onClose} disabled={pending}>
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
